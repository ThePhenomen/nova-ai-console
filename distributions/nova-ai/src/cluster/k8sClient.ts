import { getClusterConnection } from './connectionStore';
import { hasClusterCredentials, type K8sStatus } from './types';

const PROXY_PREFIX = '/k8s-proxy';
const SESSION_PATH = '/k8s-session';

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
};

let activeSessionId: string | null = null;

const ensureSession = async (): Promise<string> => {
  if (activeSessionId) {
    return activeSessionId;
  }
  let response: Response;
  try {
    response = await fetch(SESSION_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ useEnv: true }),
      cache: 'no-store',
    });
  } catch {
    throw new K8sApiError(
      'Could not reach the cluster proxy. Make sure the Nova AI Console dev server is running.',
    );
  }
  if (!response.ok) {
    throw new K8sApiError(await readErrorMessage(response), response.status);
  }
  const payload: unknown = await response.json();
  const sessionId =
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as { sessionId?: unknown }).sessionId === 'string'
      ? (payload as { sessionId: string }).sessionId
      : '';
  if (!sessionId) {
    throw new K8sApiError('Cluster proxy did not return a session.');
  }
  activeSessionId = sessionId;
  return sessionId;
};

export const k8sRequest = async <T>(path: string, options: RequestOptions = {}): Promise<T> => {
  const connection = getClusterConnection();
  if (!connection || !hasClusterCredentials(connection)) {
    throw new K8sApiError(
      'KUBECONFIG_BASE64 is not set. Add it to .env and restart the Nova AI Console.',
    );
  }

  const sessionId = await ensureSession();
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Cluster-Session': sessionId,
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

  if (response.status === 401) {
    activeSessionId = null;
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
