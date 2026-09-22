import { getEnvOidcConfig } from './envOidc';
import type { OidcConfig } from './types';

export const OIDC_CONFIG_STORAGE_KEY = 'nova-ai.oidc-config';

const listeners = new Set<() => void>();

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const readStoredConfig = (): OidcConfig | null => {
  try {
    const raw = localStorage.getItem(OIDC_CONFIG_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const issuer = asNonEmptyString(record.issuer);
    const clientId = asNonEmptyString(record.clientId);
    if (!issuer || !clientId) {
      return null;
    }
    return {
      issuer,
      clientId,
      clientSecret: asNonEmptyString(record.clientSecret),
      scopes: asNonEmptyString(record.scopes),
      redirectUri: asNonEmptyString(record.redirectUri),
    };
  } catch {
    return null;
  }
};

export const resolveOidcConfig = (stored?: OidcConfig | null): OidcConfig | null => {
  const env = getEnvOidcConfig();
  const fromStore = stored === undefined ? (typeof window === 'undefined' ? null : readStoredConfig()) : stored;
  const issuer = env?.issuer || fromStore?.issuer;
  const clientId = env?.clientId || fromStore?.clientId;
  if (!issuer || !clientId) {
    return null;
  }
  return {
    issuer,
    clientId,
    clientSecret: fromStore?.clientSecret,
    scopes: env?.scopes || fromStore?.scopes,
    redirectUri: env?.redirectUri || fromStore?.redirectUri,
  };
};

let snapshot: OidcConfig | null = typeof window === 'undefined' ? null : resolveOidcConfig();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

export const getOidcConfig = (): OidcConfig | null => snapshot;

export const subscribeOidcConfig = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setOidcConfig = (next: OidcConfig | null): void => {
  snapshot = next
    ? resolveOidcConfig({
        issuer: next.issuer.trim().replace(/\/$/, ''),
        clientId: next.clientId.trim(),
        clientSecret: asNonEmptyString(next.clientSecret),
        scopes: asNonEmptyString(next.scopes),
        redirectUri: asNonEmptyString(next.redirectUri),
      })
    : resolveOidcConfig(null);
  try {
    if (next) {
      localStorage.setItem(
        OIDC_CONFIG_STORAGE_KEY,
        JSON.stringify({
          issuer: next.issuer.trim().replace(/\/$/, ''),
          clientId: next.clientId.trim(),
          clientSecret: asNonEmptyString(next.clientSecret),
          scopes: asNonEmptyString(next.scopes),
          redirectUri: asNonEmptyString(next.redirectUri),
        }),
      );
    } else {
      localStorage.removeItem(OIDC_CONFIG_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
  emit();
};
