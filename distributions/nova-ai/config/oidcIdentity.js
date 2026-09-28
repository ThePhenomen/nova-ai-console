const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');

const CLOCK_SKEW_SECONDS = 60;
const JWKS_TTL_MS = 10 * 60 * 1000;

/** @type {{ url: string, keys: Array<Record<string, unknown>>, fetchedAt: number }} */
let jwksCache = { url: '', keys: [], fetchedAt: 0 };

const issuer = () => (process.env.STARVAULT_OIDC_ISSUER || '').trim().replace(/\/$/, '');

const clientId = () => (process.env.STARVAULT_OIDC_CLIENT_ID || '').trim();

const requestJson = (targetUrl) =>
  new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(targetUrl);
    } catch (error) {
      reject(error);
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers: { accept: 'application/json' },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          if ((res.statusCode || 500) >= 400) {
            reject(new Error(`OIDC discovery failed with status ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
          } catch (error) {
            reject(error);
          }
        });
      },
    );
    req.on('error', reject);
    req.end();
  });

const loadJwks = async (force) => {
  const base = issuer();
  if (!base) {
    throw new Error('STARVAULT_OIDC_ISSUER is not set.');
  }
  if (!force && jwksCache.keys.length > 0 && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.keys;
  }
  const discovery = await requestJson(`${base}/.well-known/openid-configuration`);
  const jwksUri = typeof discovery.jwks_uri === 'string' ? discovery.jwks_uri : '';
  if (!jwksUri) {
    throw new Error('OIDC discovery has no jwks_uri.');
  }
  const jwks = await requestJson(jwksUri);
  const keys = Array.isArray(jwks.keys) ? jwks.keys : [];
  jwksCache = { url: jwksUri, keys, fetchedAt: Date.now() };
  return keys;
};

const decodePart = (part) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

const headerValue = (value) => String(value).replace(/[\r\n]/g, '').trim();

const claimString = (claims, keys) => {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
};

const claimGroups = (claims) => {
  const raw = claims.groups ?? claims.nova_groups ?? claims['https://kubernetes.io/groups'];
  const values = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw : [];
  return values
    .filter((item) => typeof item === 'string')
    .map((item) => headerValue(item))
    .filter((item) => item !== '');
};

const audienceMatches = (aud) => {
  const expected = clientId();
  if (!expected || aud === undefined) {
    return true;
  }
  const values = Array.isArray(aud) ? aud : [aud];
  return values.some((value) => value === expected);
};

const verifySignature = (alg, data, signature, jwk) => {
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  if (alg === 'RS256') {
    return crypto.verify('RSA-SHA256', Buffer.from(data), key, signature);
  }
  if (alg === 'ES256') {
    return crypto.verify('sha256', Buffer.from(data), key, signature);
  }
  throw new Error(`Unsupported OIDC token algorithm ${alg}.`);
};

/**
 * Verifies an OIDC ID token before it is forwarded to the API server as
 * Authorization: Bearer. The apiserver authenticates that token itself.
 * @param {string} token
 * @returns {Promise<{ username: string, groups: string[] }>}
 */
const identityFromToken = async (token) => {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('OIDC token is not a JWT.');
  }
  const header = decodePart(parts[0]);
  const payload = decodePart(parts[1]);
  const signingInput = `${parts[0]}.${parts[1]}`;
  const signature = Buffer.from(parts[2], 'base64url');

  let keys = await loadJwks(false);
  let jwk = keys.find((key) => !header.kid || key.kid === header.kid);
  if (!jwk) {
    keys = await loadJwks(true);
    jwk = keys.find((key) => key.kid === header.kid);
  }
  if (!jwk) {
    throw new Error('OIDC signing key was not found.');
  }
  if (!verifySignature(header.alg, signingInput, signature, jwk)) {
    throw new Error('OIDC token signature is invalid.');
  }

  const expectedIss = issuer();
  const tokenIss = typeof payload.iss === 'string' ? payload.iss.replace(/\/$/, '') : '';
  if (tokenIss !== expectedIss) {
    throw new Error('OIDC token issuer does not match STARVAULT_OIDC_ISSUER.');
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === 'number' && payload.exp + CLOCK_SKEW_SECONDS < now) {
    throw new Error('OIDC token has expired. Sign in again.');
  }
  if (typeof payload.nbf === 'number' && payload.nbf - CLOCK_SKEW_SECONDS > now) {
    throw new Error('OIDC token is not valid yet.');
  }
  if (!audienceMatches(payload.aud)) {
    throw new Error('OIDC token audience does not match the console client.');
  }

  const username = headerValue(
    claimString(payload, ['preferred_username', 'username', 'nickname', 'name', 'email']) ||
      (typeof payload.sub === 'string' ? payload.sub : ''),
  );
  if (!username) {
    throw new Error('OIDC token has no subject.');
  }
  return { username, groups: [...new Set(claimGroups(payload))] };
};

module.exports = { identityFromToken };
