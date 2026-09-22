import { hasClusterCredentials, type ClusterConnection } from './types';

export const CLUSTER_CONNECTION_STORAGE_KEY = 'nova-ai.cluster-connection';

const listeners = new Set<() => void>();

const asNonEmptyString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const readStoredConnection = (): ClusterConnection | null => {
  try {
    const raw = localStorage.getItem(CLUSTER_CONNECTION_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    const apiServer = asNonEmptyString(record.apiServer);
    if (!apiServer) {
      return null;
    }
    const connection: ClusterConnection = {
      apiServer,
      token: asNonEmptyString(record.token),
      clientCertificateData: asNonEmptyString(record.clientCertificateData),
      clientKeyData: asNonEmptyString(record.clientKeyData),
      certificateAuthorityData: asNonEmptyString(record.certificateAuthorityData),
    };
    return hasClusterCredentials(connection) ? connection : null;
  } catch {
    return null;
  }
};

export const getEnvClusterConnection = (): ClusterConnection | null => {
  const apiServer =
    typeof process.env.KUBECONFIG_API_SERVER === 'string'
      ? process.env.KUBECONFIG_API_SERVER.trim().replace(/\/$/, '')
      : '';
  if (!apiServer) {
    return null;
  }
  return { apiServer, useEnvKubeconfig: true };
};

let snapshot: ClusterConnection | null =
  typeof window === 'undefined' ? null : readStoredConnection() ?? getEnvClusterConnection();

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
  if (next) {
    snapshot = {
      apiServer: next.apiServer.trim(),
      token: asNonEmptyString(next.token),
      clientCertificateData: asNonEmptyString(next.clientCertificateData),
      clientKeyData: asNonEmptyString(next.clientKeyData),
      certificateAuthorityData: asNonEmptyString(next.certificateAuthorityData),
      ...(next.useEnvKubeconfig ? { useEnvKubeconfig: true } : {}),
    };
  } else {
    snapshot = getEnvClusterConnection();
  }
  try {
    if (snapshot && !snapshot.useEnvKubeconfig) {
      localStorage.setItem(CLUSTER_CONNECTION_STORAGE_KEY, JSON.stringify(snapshot));
    } else {
      localStorage.removeItem(CLUSTER_CONNECTION_STORAGE_KEY);
    }
  } catch {
    // localStorage may be unavailable
  }
  emit();
};

const kubeconfigScalar = (text: string, key: string): string | undefined => {
  const match = text.match(new RegExp(`^\\s*${key}:\\s*(.*)$`, 'm'));
  if (!match) {
    return undefined;
  }
  const value = match[1].trim().replace(/^['"]|['"]$/g, '');
  if (value === '|' || value === '|-' || value === '>' || value === '>-') {
    const lines = text.slice(match.index ?? 0).split('\n').slice(1);
    const block: string[] = [];
    for (const line of lines) {
      if (line.startsWith(' ') || line.startsWith('\t')) {
        block.push(line.trim());
        continue;
      }
      break;
    }
    const joined = block.join('').trim();
    return joined === '' ? undefined : joined;
  }
  return value === '' ? undefined : value;
};

export const parseKubeconfig = (text: string): Partial<ClusterConnection> => {
  const apiServer = kubeconfigScalar(text, 'server');
  const token = kubeconfigScalar(text, 'token');
  const clientCertificateData = kubeconfigScalar(text, 'client-certificate-data');
  const clientKeyData = kubeconfigScalar(text, 'client-key-data');
  const certificateAuthorityData = kubeconfigScalar(text, 'certificate-authority-data');
  return {
    ...(apiServer ? { apiServer: apiServer.replace(/\/$/, '') } : {}),
    ...(token ? { token } : {}),
    ...(clientCertificateData ? { clientCertificateData } : {}),
    ...(clientKeyData ? { clientKeyData } : {}),
    ...(certificateAuthorityData ? { certificateAuthorityData } : {}),
  };
};

export const normalizeToken = (token: string): string =>
  token.trim().replace(/^Bearer\s+/i, '');
