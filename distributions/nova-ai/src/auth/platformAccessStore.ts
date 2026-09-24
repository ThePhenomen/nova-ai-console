import { bootstrapAccess, emptyAccess } from './access';
import type { PlatformAccess } from './types';

export type PlatformAccessSnapshot = {
  access: PlatformAccess;
  error: string | null;
  isLoading: boolean;
  cacheKey: string | null;
  loaded: boolean;
};

const listeners = new Set<() => void>();

let snapshot: PlatformAccessSnapshot = {
  access: emptyAccess('oidc'),
  error: null,
  isLoading: false,
  cacheKey: null,
  loaded: false,
};

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

export const getPlatformAccessSnapshot = (): PlatformAccessSnapshot => snapshot;

export const subscribePlatformAccess = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setPlatformAccessSnapshot = (next: Partial<PlatformAccessSnapshot>): void => {
  snapshot = { ...snapshot, ...next };
  emit();
};

export const resetPlatformAccess = (access: PlatformAccess = bootstrapAccess()): void => {
  snapshot = {
    access,
    error: null,
    isLoading: false,
    cacheKey: null,
    loaded: false,
  };
  emit();
};

export const platformAccessCacheKey = (sessionSub: string | null, hasConnection: boolean): string | null => {
  if (!sessionSub) {
    return hasConnection ? 'kubeconfig' : null;
  }
  return hasConnection ? `oidc:${sessionSub}` : `oidc-pending:${sessionSub}`;
};
