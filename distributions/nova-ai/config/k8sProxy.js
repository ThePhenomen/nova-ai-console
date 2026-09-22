const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const { kubeconfigFromEnv } = require('./loadEnv');

const PROXY_PREFIX = '/k8s-proxy';
const SESSION_PATH = '/k8s-session';
const OIDC_FORWARD_PATH = '/oidc-forward';
const OIDC_PKCE_PATH = '/oidc-pkce';

/** @type {Map<string, { apiServer: string, token?: string, cert?: Buffer, key?: Buffer, ca?: Buffer }>} */
const sessions = new Map();

const sendJson = (res, statusCode, body) => {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
};

const readJsonBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });

const decodePem = (value) => {
  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }
  try {
    return Buffer.from(value.trim(), 'base64');
  } catch {
    return undefined;
  }
};

const envClusterSession = (() => {
  if (!kubeconfigFromEnv?.apiServer) {
    return null;
  }
  const token =
    typeof kubeconfigFromEnv.token === 'string' && kubeconfigFromEnv.token.trim() !== ''
      ? kubeconfigFromEnv.token.trim()
      : undefined;
  const cert = decodePem(kubeconfigFromEnv.clientCertificateData);
  const key = decodePem(kubeconfigFromEnv.clientKeyData);
  const ca = decodePem(kubeconfigFromEnv.certificateAuthorityData);
  if (!token && !(cert && key)) {
    return null;
  }
  return {
    apiServer: kubeconfigFromEnv.apiServer,
    token,
    cert,
    key,
    ca,
  };
})();

if (kubeconfigFromEnv?.apiServer && !envClusterSession) {
  // eslint-disable-next-line no-console
  console.warn(
    '[k8s-proxy] KUBECONFIG_BASE64 has a cluster URL but no token or client-certificate-data and client-key-data.',
  );
}

const createSession = () => {
  if (!envClusterSession) {
    throw new Error('KUBECONFIG_BASE64 is not set or is not a valid kubeconfig.');
  }
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, envClusterSession);
  return sessionId;
};

const requestK8s = (target, method, headers, bodyStream, tls) =>
  new Promise((resolve, reject) => {
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    const proxyReq = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        rejectUnauthorized: false,
        cert: tls.cert,
        key: tls.key,
        ca: tls.ca,
      },
      (proxyRes) => resolve({ proxyReq, proxyRes }),
    );
    proxyReq.on('error', reject);
    if (bodyStream) {
      bodyStream.pipe(proxyReq);
    } else {
      proxyReq.end();
    }
  });

const handleSession = (req, res) => {
  if (req.method === 'DELETE') {
    const sessionId = req.headers['x-cluster-session'];
    if (typeof sessionId === 'string') {
      sessions.delete(sessionId);
    }
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Method not allowed' });
    return;
  }
  readJsonBody(req)
    .then(() => {
      const sessionId = createSession();
      sendJson(res, 200, { sessionId });
    })
    .catch((error) => {
      sendJson(res, 400, {
        message: error instanceof Error ? error.message : 'Invalid session payload',
      });
    });
};

const readRawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const applyStarvaultClientSecret = (headers, bodyBuf) => {
  const secret = process.env.STARVAULT_OIDC_CLIENT_SECRET;
  const clientId = process.env.STARVAULT_OIDC_CLIENT_ID;
  if (!secret || !bodyBuf || bodyBuf.length === 0) {
    return bodyBuf;
  }
  const contentType = String(headers['content-type'] || '');
  if (!contentType.includes('application/x-www-form-urlencoded')) {
    return bodyBuf;
  }
  const params = new URLSearchParams(bodyBuf.toString('utf8'));
  if (!params.has('grant_type')) {
    return bodyBuf;
  }
  if (!params.has('client_secret')) {
    params.set('client_secret', secret);
  }
  if (clientId && !headers.authorization) {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`;
  }
  const nextBody = Buffer.from(params.toString(), 'utf8');
  headers['content-length'] = String(nextBody.length);
  return nextBody;
};

const handleOidcPkce = (req, res) => {
  if (req.method !== 'POST') {
    sendJson(res, 405, { message: 'Method not allowed' });
    return;
  }
  readJsonBody(req)
    .then((body) => {
      const verifier =
        typeof body.verifier === 'string' && body.verifier.length >= 43
          ? body.verifier
          : crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      sendJson(res, 200, { verifier, challenge });
    })
    .catch((error) => {
      sendJson(res, 400, {
        message: error instanceof Error ? error.message : 'Invalid PKCE payload',
      });
    });
};

/**
 * Browser cannot call StarVault (CORS, self-signed TLS), so discovery and the
 * token exchange are forwarded with `X-Target-Url`. Authorization is a top-level
 * redirect and does not use this proxy.
 */
const handleOidcForward = (req, res) => {
  const targetHeader = req.headers['x-target-url'];
  if (typeof targetHeader !== 'string' || targetHeader.trim() === '') {
    sendJson(res, 400, { message: 'X-Target-Url is required' });
    return;
  }

  let target;
  try {
    target = new URL(targetHeader);
  } catch {
    sendJson(res, 400, { message: 'Invalid X-Target-Url' });
    return;
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    sendJson(res, 400, { message: 'OIDC URL must use http or https' });
    return;
  }

  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const headers = {
    accept: req.headers.accept || 'application/json',
  };
  if (req.headers['content-type']) {
    headers['content-type'] = req.headers['content-type'];
  }
  if (req.headers.authorization) {
    headers.authorization = req.headers.authorization;
  }

  const sendUpstream = (bodyBuf) => {
    const payload = applyStarvaultClientSecret(headers, bodyBuf);
    if (hasBody && payload && payload.length > 0) {
      headers['content-length'] = String(payload.length);
    }
    const isHttps = target.protocol === 'https:';
    const lib = isHttps ? https : http;
    const proxyReq = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (isHttps ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method,
        headers,
        rejectUnauthorized: false,
      },
      (proxyRes) => {
        res.statusCode = proxyRes.statusCode || 502;
        const contentType = proxyRes.headers['content-type'];
        if (contentType) {
          res.setHeader('Content-Type', contentType);
        }
        proxyRes.pipe(res);
      },
    );
    proxyReq.on('error', (error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, 502, { message: error instanceof Error ? error.message : String(error) });
    });
    if (hasBody && payload && payload.length > 0) {
      proxyReq.end(payload);
    } else {
      proxyReq.end();
    }
  };

  if (hasBody) {
    readRawBody(req)
      .then((bodyBuf) => sendUpstream(bodyBuf))
      .catch((error) => {
        sendJson(res, 400, {
          message: error instanceof Error ? error.message : 'Invalid OIDC request body',
        });
      });
    return;
  }
  sendUpstream();
};

/**
 * Browser cannot speak Kubernetes mTLS or skip CORS, so the webpack dev server
 * holds credentials in a short-lived session and forwards `/k8s-proxy/*`.
 */
const k8sProxyMiddleware = (req, res, next) => {
  const url = req.url || '';
  const pathWithQuery = url.split('?')[0];

  if (pathWithQuery === SESSION_PATH) {
    handleSession(req, res);
    return;
  }

  if (pathWithQuery === OIDC_PKCE_PATH) {
    handleOidcPkce(req, res);
    return;
  }

  if (pathWithQuery === OIDC_FORWARD_PATH) {
    handleOidcForward(req, res);
    return;
  }

  if (pathWithQuery !== PROXY_PREFIX && !pathWithQuery.startsWith(`${PROXY_PREFIX}/`)) {
    next();
    return;
  }

  const sessionId = req.headers['x-cluster-session'];
  const session = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined;
  if (!session) {
    sendJson(res, 401, { message: 'Cluster session is missing or expired. Connect to the cluster again.' });
    return;
  }

  let target;
  try {
    const suffix = url.slice(PROXY_PREFIX.length) || '/';
    const clusterUrl = session.apiServer.endsWith('/') ? session.apiServer : `${session.apiServer}/`;
    target = new URL(suffix, clusterUrl);
  } catch {
    sendJson(res, 400, { message: 'Invalid cluster URL' });
    return;
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    sendJson(res, 400, { message: 'Cluster URL must use http or https' });
    return;
  }

  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const headers = {
    accept: req.headers.accept || 'application/json',
  };
  if (session.token) {
    headers.authorization = `Bearer ${session.token}`;
  }
  if (req.headers['content-type']) {
    headers['content-type'] = req.headers['content-type'];
  }
  if (hasBody && req.headers['content-length']) {
    headers['content-length'] = req.headers['content-length'];
  }

  requestK8s(target, method, headers, hasBody ? req : undefined, session)
    .then(({ proxyRes }) => {
      res.statusCode = proxyRes.statusCode || 502;
      const contentType = proxyRes.headers['content-type'];
      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      proxyRes.pipe(res);
    })
    .catch((error) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      sendJson(res, 502, { message: error instanceof Error ? error.message : String(error) });
    });
};

module.exports = k8sProxyMiddleware;
