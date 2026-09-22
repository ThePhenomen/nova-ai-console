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
      scopes: asNonEmptyString(record.scopes),
    };
  } catch {
    return null;
  }
};

let snapshot: OidcConfig | null = typeof window === 'undefined' ? null : readStoredConfig();

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
    ? {
        issuer: next.issuer.trim().replace(/\/$/, ''),
        clientId: next.clientId.trim(),
        scopes: asNonEmptyString(next.scopes),
      }
    : null;
  try {
    if (snapshot) {
      localStorage.setItem(OIDC_CONFIG_STORAGE_KEY, JSON.stringify(snapshot));
    } else {
      localStorage.removeItem(OIDC_CONFIG_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
  emit();
};
