import { getClusterConnection } from './connectionStore';
import type { ClusterConnection, K8sStatus } from './types';

const PROXY_PREFIX = '/k8s-proxy';

export class K8sApiError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly reason?: string,
  ) {
    super(message);
    this.name = 'K8sApiError';
  }
}

const isK8sStatus = (value: unknown): value is K8sStatus =>
  typeof value === 'object' &&
  value !== null &&
  (value as K8sStatus).kind === 'Status';

const readErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload: unknown = await response.json();
    if (isK8sStatus(payload) && payload.message) {
      return payload.message;
    }
    if (typeof payload === 'object' && payload !== null && 'message' in payload) {
      const { message } = payload as { message: unknown };
      if (typeof message === 'string' && message.trim() !== '') {
        return message;
      }
    }
  } catch {
    // ignore parse errors and fall through
  }
  return response.statusText || `Request failed with status ${response.status}`;
};

type RequestOptions = {
  method?: string;
  body?: unknown;
  connection?: ClusterConnection | null;
};

export const k8sRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const connection = options.connection ?? getClusterConnection();
  if (!connection) {
    throw new K8sApiError('Not connected to a cluster');
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: `Bearer ${connection.token}`,
    'X-Cluster-Url': connection.apiServer.replace(/\/$/, ''),
  };
  const init: RequestInit = {
    method: options.method ?? 'GET',
    headers,
    cache: 'no-store',
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(options.body);
  }

  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  let response: Response;
  try {
    response = await fetch(`${PROXY_PREFIX}${normalizedPath}`, init);
  } catch {
    throw new K8sApiError(
      'Could not reach the cluster proxy. Make sure the Nova AI Console dev server is running.',
    );
  }

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new K8sApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

export const testClusterConnection = async (connection: ClusterConnection): Promise<void> => {
  await k8sRequest('/api/v1', { connection });
};
