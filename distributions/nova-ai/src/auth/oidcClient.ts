import { getAuthSession, setAuthSession } from './authSession';
import type { AuthSession, AuthUser, OidcConfig } from './types';

const PKCE_STORAGE_KEY = 'nova-ai.oidc.pkce';
const OIDC_FORWARD_PATH = '/oidc-forward';
const OIDC_PKCE_PATH = '/oidc-pkce';

export class OidcError extends Error {
  constructor(
    message: string,
    readonly title = 'Could not complete sign-in',
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

export const formatOidcError = (raw: string): OidcError => {
  const text = raw.toLowerCase();
  if (
    text.includes('grant is invalid') ||
    text.includes('invalid_grant') ||
    (text.includes('authorization code') && text.includes('expired'))
  ) {
    return new OidcError(
      'The one-time authorization code was already used or expired. This is not a missing-permissions error. Sign in again.',
      'Sign-in code already used',
    );
  }
  if (text.includes('client failed to authenticate') || text.includes('invalid_client')) {
    return new OidcError(
      'StarVault rejected the OIDC client. For a confidential client, paste the client secret from identity/oidc/client/<name>.',
      'OIDC client was rejected',
    );
  }
  if (
    text.includes('access denied') ||
    text.includes('not authorized') ||
    text.includes('not assigned') ||
    text.includes('no assignment') ||
    text.includes('permission denied')
  ) {
    return new OidcError(
      'This user can sign in to StarVault, but has no OIDC assignment for the console. Create a PlatformRoleBinding to nova-ai-admin, nova-ai-developer, or nova-ai-mlflow.',
      'No platform role assigned',
    );
  }
  if (text.includes('redirect_uri')) {
    return new OidcError(
      'The redirect URI is not registered on the StarVault OIDC client. Add the URI shown in the sign-in dialog.',
      'Redirect URI mismatch',
    );
  }
  return new OidcError(raw);
};

type DiscoveryDocument = {
  authorization_endpoint: string;
  token_endpoint: string;
};

type PkceHandshake = {
  verifier: string;
  state: string;
  nonce: string;
  redirectUri: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
};

const randomUrl = (bytes: number): string => {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  let binary = '';
  buffer.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const oidcForward = async (targetUrl: string, init: RequestInit = {}): Promise<Response> => {
  const headers = new Headers(init.headers);
  headers.set('X-Target-Url', targetUrl);
  if (!headers.has('Accept')) {
    headers.set('Accept', 'application/json');
  }
  let response: Response;
  try {
    response = await fetch(OIDC_FORWARD_PATH, {
      ...init,
      headers,
      cache: 'no-store',
    });
  } catch {
    throw new OidcError(
      'Could not reach the OIDC proxy. Make sure the Nova AI Console dev server is running.',
    );
  }
  return response;
};

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload: unknown = await response.json();
    if (typeof payload === 'object' && payload !== null) {
      const record = payload as Record<string, unknown>;
      if (typeof record.error_description === 'string') {
        return record.error_description;
      }
      if (typeof record.error === 'string') {
        return record.error;
      }
      if (typeof record.message === 'string') {
        return record.message;
      }
      if (Array.isArray(record.errors)) {
        const details = record.errors.filter(
          (item): item is string => typeof item === 'string' && item.trim() !== '',
        );
        if (details.length > 0) {
          return details.join('; ');
        }
      }
    }
  } catch {
    // fall through
  }
  return response.statusText || `OIDC request failed with status ${response.status}`;
};

const discover = async (issuer: string): Promise<DiscoveryDocument> => {
  const discoveryUrl = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
  const response = await oidcForward(discoveryUrl);
  if (!response.ok) {
    throw new OidcError(await readErrorMessage(response));
  }
  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null) {
    throw new OidcError('OIDC discovery document is invalid.');
  }
  const record = payload as Record<string, unknown>;
  if (
    typeof record.authorization_endpoint !== 'string' ||
    typeof record.token_endpoint !== 'string'
  ) {
    throw new OidcError('OIDC discovery document is missing authorization or token endpoint.');
  }
  return {
    authorization_endpoint: record.authorization_endpoint,
    token_endpoint: record.token_endpoint,
  };
};

const createPkceChallenge = async (verifier: string): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(OIDC_PKCE_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ verifier }),
      cache: 'no-store',
    });
  } catch {
    throw new OidcError(
      'Could not reach the OIDC proxy. Make sure the Nova AI Console dev server is running.',
    );
  }
  if (!response.ok) {
    throw new OidcError(await readErrorMessage(response));
  }
  const payload: unknown = await response.json();
  const challenge =
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { challenge?: unknown }).challenge === 'string'
      ? (payload as { challenge: string }).challenge
      : '';
  if (!challenge) {
    throw new OidcError('OIDC proxy did not return a PKCE challenge.');
  }
  return challenge;
};

const decodeJwtPayload = (token: string): Record<string, unknown> => {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new OidcError('OIDC token is not a JWT.');
  }
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  try {
    const parsed: unknown = JSON.parse(atob(padded));
    if (typeof parsed !== 'object' || parsed === null) {
      throw new OidcError('OIDC token payload is invalid.');
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof OidcError) {
      throw error;
    }
    throw new OidcError('OIDC token payload could not be decoded.');
  }
};

const claimString = (claims: Record<string, unknown>, keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = claims[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
};

const claimGroups = (claims: Record<string, unknown>): string[] => {
  const raw = claims.groups ?? claims['nova_groups'] ?? claims['https://kubernetes.io/groups'];
  if (typeof raw === 'string' && raw.trim() !== '') {
    return [raw.trim()];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
};

export const userFromClaims = (claims: Record<string, unknown>): AuthUser => {
  const sub = claimString(claims, ['sub']);
  if (!sub) {
    throw new OidcError('OIDC token does not include a subject.');
  }
  return {
    sub,
    username:
      claimString(claims, ['preferred_username', 'username', 'nickname', 'name', 'email']) ?? sub,
    email: claimString(claims, ['email']),
    groups: claimGroups(claims),
    aliases: [
      sub,
      claimString(claims, ['preferred_username']),
      claimString(claims, ['username']),
      claimString(claims, ['nickname']),
      claimString(claims, ['name']),
      claimString(claims, ['email']),
    ].filter((value): value is string => Boolean(value)),
  };
};

export const startOidcLogin = async (config: OidcConfig): Promise<void> => {
  const issuer = config.issuer.trim().replace(/\/$/, '');
  const clientId = config.clientId.trim();
  if (!issuer || !clientId) {
    throw new OidcError('StarVault issuer URL and OIDC client ID are required.');
  }
  const discovery = await discover(issuer);
  const verifier = randomUrl(32);
  const challenge = await createPkceChallenge(verifier);
  const handshake: PkceHandshake = {
    verifier,
    state: randomUrl(16),
    nonce: randomUrl(16),
    redirectUri: `${window.location.origin}/auth/callback`,
    issuer,
    clientId,
    clientSecret: config.clientSecret?.trim() || undefined,
  };
  sessionStorage.setItem(PKCE_STORAGE_KEY, JSON.stringify(handshake));

  const authorizeUrl = new URL(discovery.authorization_endpoint);
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', handshake.redirectUri);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('scope', config.scopes?.trim() || 'openid');
  authorizeUrl.searchParams.set('code_challenge', challenge);
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('state', handshake.state);
  authorizeUrl.searchParams.set('nonce', handshake.nonce);
  window.location.assign(authorizeUrl.toString());
};

const readHandshake = (): PkceHandshake => {
  const raw = sessionStorage.getItem(PKCE_STORAGE_KEY);
  if (!raw) {
    throw new OidcError('OIDC login state is missing. Start sign-in again.');
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null) {
    throw new OidcError('OIDC login state is invalid.');
  }
  const record = parsed as Record<string, unknown>;
  const handshake: PkceHandshake = {
    verifier: typeof record.verifier === 'string' ? record.verifier : '',
    state: typeof record.state === 'string' ? record.state : '',
    nonce: typeof record.nonce === 'string' ? record.nonce : '',
    redirectUri: typeof record.redirectUri === 'string' ? record.redirectUri : '',
    issuer: typeof record.issuer === 'string' ? record.issuer : '',
    clientId: typeof record.clientId === 'string' ? record.clientId : '',
    clientSecret: typeof record.clientSecret === 'string' ? record.clientSecret : undefined,
  };
  if (
    !handshake.verifier ||
    !handshake.state ||
    !handshake.redirectUri ||
    !handshake.issuer ||
    !handshake.clientId
  ) {
    throw new OidcError('OIDC login state is incomplete.');
  }
  return handshake;
};

const exchangeAuthorizationCode = async (callbackUrl: string): Promise<AuthSession> => {
  const params = new URL(callbackUrl).searchParams;
  const error = params.get('error');
  if (error) {
    throw formatOidcError(params.get('error_description') || error);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    throw new OidcError('OIDC callback is missing the authorization code.');
  }

  const handshake = readHandshake();
  if (state !== handshake.state) {
    throw new OidcError('OIDC state mismatch. Start sign-in again.');
  }

  const discovery = await discover(handshake.issuer);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: handshake.redirectUri,
    client_id: handshake.clientId,
    code_verifier: handshake.verifier,
  });
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (handshake.clientSecret) {
    body.set('client_secret', handshake.clientSecret);
    headers.Authorization = `Basic ${btoa(`${handshake.clientId}:${handshake.clientSecret}`)}`;
  }
  const response = await oidcForward(discovery.token_endpoint, {
    method: 'POST',
    headers,
    body: body.toString(),
  });
  if (!response.ok) {
    throw formatOidcError(await readErrorMessage(response));
  }

  const payload: unknown = await response.json();
  if (typeof payload !== 'object' || payload === null) {
    throw new OidcError('OIDC token response is invalid.');
  }
  const record = payload as Record<string, unknown>;
  const accessToken =
    typeof record.access_token === 'string' ? record.access_token : undefined;
  const idToken = typeof record.id_token === 'string' ? record.id_token : undefined;
  if (!accessToken && !idToken) {
    throw new OidcError('OIDC token response has no access or ID token.');
  }

  const claims = decodeJwtPayload(idToken || accessToken || '');
  if (handshake.nonce && typeof claims.nonce === 'string' && claims.nonce !== handshake.nonce) {
    throw new OidcError('OIDC nonce mismatch.');
  }

  const session: AuthSession = {
    accessToken: accessToken || idToken || '',
    idToken,
    user: userFromClaims(claims),
  };
  sessionStorage.removeItem(PKCE_STORAGE_KEY);
  setAuthSession(session);
  return session;
};

const exchanges = new Map<string, Promise<AuthSession>>();

export const completeOidcLogin = async (callbackUrl: string): Promise<AuthSession> => {
  const code = new URL(callbackUrl).searchParams.get('code');
  if (code) {
    const inFlight = exchanges.get(code);
    if (inFlight) {
      return inFlight;
    }
  }
  const existing = getAuthSession();
  if (existing && !code) {
    return existing;
  }
  const exchange = exchangeAuthorizationCode(callbackUrl);
  if (code) {
    exchanges.set(code, exchange);
  }
  try {
    return await exchange;
  } catch (error) {
    if (code) {
      exchanges.delete(code);
    }
    const existingAfterFailure = getAuthSession();
    if (existingAfterFailure) {
      return existingAfterFailure;
    }
    throw error;
  }
};

export const logoutOidc = (): void => {
  sessionStorage.removeItem(PKCE_STORAGE_KEY);
  setAuthSession(null);
};
