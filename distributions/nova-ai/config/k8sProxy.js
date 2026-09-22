const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const PROXY_PREFIX = '/k8s-proxy';
const SESSION_PATH = '/k8s-session';

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

const createSession = (body) => {
  const apiServer = typeof body.apiServer === 'string' ? body.apiServer.trim() : '';
  if (!apiServer) {
    throw new Error('apiServer is required');
  }
  const token = typeof body.token === 'string' && body.token.trim() !== '' ? body.token.trim() : undefined;
  const cert = decodePem(body.clientCertificateData);
  const key = decodePem(body.clientKeyData);
  const ca = decodePem(body.certificateAuthorityData);
  if (!token && !(cert && key)) {
    throw new Error('A bearer token or a client certificate and key is required');
  }
  const sessionId = crypto.randomUUID();
  sessions.set(sessionId, { apiServer, token, cert, key, ca });
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
    .then((body) => {
      const sessionId = createSession(body);
      sendJson(res, 200, { sessionId });
    })
    .catch((error) => {
      sendJson(res, 400, {
        message: error instanceof Error ? error.message : 'Invalid session payload',
      });
    });
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
