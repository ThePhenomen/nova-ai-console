import type { ClusterConnection } from './types';

export const CLUSTER_CONNECTION_STORAGE_KEY = 'nova-ai.cluster-connection';

const listeners = new Set<() => void>();

const readStoredConnection = (): ClusterConnection | null => {
  try {
    const raw = localStorage.getItem(CLUSTER_CONNECTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as ClusterConnection).apiServer !== 'string' ||
      typeof (parsed as ClusterConnection).token !== 'string'
    ) {
      return null;
    }
    const { apiServer, token } = parsed as ClusterConnection;
    if (apiServer.trim() === '' || token.trim() === '') {
      return null;
    }
    return { apiServer: apiServer.trim(), token: token.trim() };
  } catch {
    return null;
  }
};

let snapshot: ClusterConnection | null =
  typeof window === 'undefined' ? null : readStoredConnection();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

export const getClusterConnection = (): ClusterConnection | null => snapshot;

export const subscribeClusterConnection = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setClusterConnection = (next: ClusterConnection | null): void => {
  snapshot = next
    ? { apiServer: next.apiServer.trim(), token: next.token.trim() }
    : null;
  try {
    if (snapshot) {
      localStorage.setItem(CLUSTER_CONNECTION_STORAGE_KEY, JSON.stringify(snapshot));
    } else {
      localStorage.removeItem(CLUSTER_CONNECTION_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
  emit();
};

export const parseKubeconfig = (text: string): Partial<ClusterConnection> => {
  const server = text.match(/^\s*server:\s*(\S+)/m)?.[1];
  const token = text.match(/^\s*token:\s*(\S+)/m)?.[1];
  return {
    ...(server ? { apiServer: server.replace(/['"]/g, '') } : {}),
    ...(token ? { token: token.replace(/['"]/g, '') } : {}),
  };
};

export const normalizeToken = (token: string): string =>
  token.trim().replace(/^Bearer\s+/i, '');
