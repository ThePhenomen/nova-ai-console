import type { AuthSession } from './types';

export const AUTH_SESSION_STORAGE_KEY = 'nova-ai.auth-session';

const listeners = new Set<() => void>();

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const asStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
};

const readStoredSession = (): AuthSession | null => {
  try {
    const raw = localStorage.getItem(AUTH_SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const accessToken = asNonEmptyString(record.accessToken);
    const userRecord =
      typeof record.user === 'object' && record.user !== null
        ? (record.user as Record<string, unknown>)
        : null;
    const sub = asNonEmptyString(userRecord?.sub);
    const username = asNonEmptyString(userRecord?.username);
    if (!accessToken || !sub || !username) {
      return null;
    }
    return {
      accessToken,
      idToken: asNonEmptyString(record.idToken),
      user: {
        sub,
        username,
        email: asNonEmptyString(userRecord.email),
        groups: asStringArray(userRecord.groups),
      },
    };
  } catch {
    return null;
  }
};

let snapshot: AuthSession | null = typeof window === 'undefined' ? null : readStoredSession();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

export const getAuthSession = (): AuthSession | null => snapshot;

export const subscribeAuthSession = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setAuthSession = (next: AuthSession | null): void => {
  snapshot = next;
  try {
    if (snapshot) {
      localStorage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(snapshot));
    } else {
      localStorage.removeItem(AUTH_SESSION_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
  emit();
};
