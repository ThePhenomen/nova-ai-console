import type { ClusterConnection } from './types';

const LEGACY_STORAGE_KEY = 'nova-ai.cluster-connection';

if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}

const CLUSTER_CONNECTION: ClusterConnection | null = (() => {
  const apiServer =
    typeof process.env.KUBECONFIG_API_SERVER === 'string'
      ? process.env.KUBECONFIG_API_SERVER.trim().replace(/\/$/, '')
      : '';
  if (!apiServer) {
    return null;
  }
  return { apiServer };
})();

export const getClusterConnection = (): ClusterConnection | null => CLUSTER_CONNECTION;

export const subscribeClusterConnection = (): (() => void) => () => undefined;
