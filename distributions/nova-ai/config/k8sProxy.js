const http = require('http');
const https = require('https');
const { URL } = require('url');

const PROXY_PREFIX = '/k8s-proxy';

const requestK8s = (target, method, headers, bodyStream) =>
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

/**
 * Forwards `/k8s-proxy/*` to the cluster URL provided in `X-Cluster-Url`.
 * The browser cannot talk to the Kubernetes API directly (CORS + self-signed certs),
 * so the webpack dev server proxies the request and injects the bearer token.
 */
const k8sProxyMiddleware = (req, res, next) => {
  const url = req.url || '';
  const pathWithQuery = url.split('?')[0];
  if (pathWithQuery !== PROXY_PREFIX && !pathWithQuery.startsWith(`${PROXY_PREFIX}/`)) {
    next();
    return;
  }

  const clusterUrl = req.headers['x-cluster-url'];
  if (typeof clusterUrl !== 'string' || clusterUrl.trim() === '') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Missing X-Cluster-Url header' }));
    return;
  }

  let target;
  try {
    const suffix = url.slice(PROXY_PREFIX.length) || '/';
    target = new URL(suffix, clusterUrl.endsWith('/') ? clusterUrl : `${clusterUrl}/`);
  } catch {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Invalid cluster URL' }));
    return;
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ message: 'Cluster URL must use http or https' }));
    return;
  }

  const method = req.method || 'GET';
  const hasBody = method !== 'GET' && method !== 'HEAD';
  const headers = {
    accept: req.headers.accept || 'application/json',
  };
  if (req.headers.authorization) {
    headers.authorization = req.headers.authorization;
  }
  if (req.headers['content-type']) {
    headers['content-type'] = req.headers['content-type'];
  }
  if (hasBody && req.headers['content-length']) {
    headers['content-length'] = req.headers['content-length'];
  }

  requestK8s(target, method, headers, hasBody ? req : undefined)
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
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ message: error instanceof Error ? error.message : String(error) }));
    });
};

module.exports = k8sProxyMiddleware;
