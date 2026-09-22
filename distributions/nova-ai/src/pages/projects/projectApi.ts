import { k8sRequest } from '../../cluster/k8sClient';
import type {
  K8sList,
  NamespaceKind,
  ResourceQuotaKind,
  RoleBindingKind,
  RoleKind,
} from '../../cluster/types';

export const PROJECT_DESCRIPTION_ANNOTATION = 'nova-ai.io/description';
export const PROJECT_LABEL = 'nova-ai.io/project';
export const PROJECT_QUOTA_NAME = 'nova-ai-quota';

const SYSTEM_NAMESPACE_PREFIXES = ['kube-', 'openshift-'];

export type ProjectQuotaInput = {
  cpuRequest: string;
  cpuLimit: string;
  memoryRequest: string;
  memoryLimit: string;
  pods: string;
};

export type CreateProjectInput = {
  name: string;
  description: string;
  quota: ProjectQuotaInput;
};

export type ProjectSummary = {
  name: string;
  description: string;
  phase: string;
  createdAt?: string;
  quota?: ResourceQuotaKind;
};

const isSystemNamespace = (name: string): boolean =>
  SYSTEM_NAMESPACE_PREFIXES.some((prefix) => name.startsWith(prefix));

export const getProjectDescription = (namespace: NamespaceKind): string =>
  namespace.metadata.annotations?.[PROJECT_DESCRIPTION_ANNOTATION] ??
  namespace.metadata.annotations?.['kubernetes.io/description'] ??
  '';

const quotaHardFromInput = (quota: ProjectQuotaInput): Record<string, string> => {
  const hard: Record<string, string> = {};
  if (quota.cpuRequest.trim()) {
    hard['requests.cpu'] = quota.cpuRequest.trim();
  }
  if (quota.cpuLimit.trim()) {
    hard['limits.cpu'] = quota.cpuLimit.trim();
  }
  if (quota.memoryRequest.trim()) {
    hard['requests.memory'] = quota.memoryRequest.trim();
  }
  if (quota.memoryLimit.trim()) {
    hard['limits.memory'] = quota.memoryLimit.trim();
  }
  if (quota.pods.trim()) {
    hard.pods = quota.pods.trim();
  }
  return hard;
};

export const listProjects = async (): Promise<ProjectSummary[]> => {
  const [namespaces, quotas] = await Promise.all([
    k8sRequest<K8sList<NamespaceKind>>('/api/v1/namespaces'),
    k8sRequest<K8sList<ResourceQuotaKind>>('/api/v1/resourcequotas').catch(
      (): K8sList<ResourceQuotaKind> => ({ items: [] }),
    ),
  ]);

  const quotaByNamespace = new Map<string, ResourceQuotaKind>();
  quotas.items.forEach((quota) => {
    const namespace = quota.metadata.namespace;
    if (!namespace) {
      return;
    }
    const current = quotaByNamespace.get(namespace);
    if (!current || quota.metadata.name === PROJECT_QUOTA_NAME) {
      quotaByNamespace.set(namespace, quota);
    }
  });

  return namespaces.items
    .filter((namespace) => !isSystemNamespace(namespace.metadata.name))
    .map((namespace) => ({
      name: namespace.metadata.name,
      description: getProjectDescription(namespace),
      phase: namespace.status?.phase ?? 'Unknown',
      createdAt: namespace.metadata.creationTimestamp,
      quota: quotaByNamespace.get(namespace.metadata.name),
    }))
    .toSorted((a, b) => a.name.localeCompare(b.name));
};

export const getNamespace = (name: string): Promise<NamespaceKind> =>
  k8sRequest<NamespaceKind>(`/api/v1/namespaces/${encodeURIComponent(name)}`);

export const listNamespaceQuotas = (name: string): Promise<ResourceQuotaKind[]> =>
  k8sRequest<K8sList<ResourceQuotaKind>>(
    `/api/v1/namespaces/${encodeURIComponent(name)}/resourcequotas`,
  ).then((list) => list.items);

export const listRoles = (namespace: string): Promise<RoleKind[]> =>
  k8sRequest<K8sList<RoleKind>>(
    `/apis/rbac.authorization.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/roles`,
  ).then((list) => list.items);

export const listRoleBindings = (namespace: string): Promise<RoleBindingKind[]> =>
  k8sRequest<K8sList<RoleBindingKind>>(
    `/apis/rbac.authorization.k8s.io/v1/namespaces/${encodeURIComponent(namespace)}/rolebindings`,
  ).then((list) => list.items);

export const NAMESPACE_NAME_PATTERN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export const createProject = async (input: CreateProjectInput): Promise<void> => {
  const name = input.name.trim();
  if (!NAMESPACE_NAME_PATTERN.test(name) || name.length > 63) {
    throw new Error(
      'Project name must be 1-63 characters, lowercase alphanumeric, and may contain hyphens.',
    );
  }

  const hard = quotaHardFromInput(input.quota);
  if (Object.keys(hard).length === 0) {
    throw new Error('Set at least one resource quota value.');
  }

  await k8sRequest('/api/v1/namespaces', {
    method: 'POST',
    body: {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: {
        name,
        labels: { [PROJECT_LABEL]: 'true' },
        annotations: input.description.trim()
          ? { [PROJECT_DESCRIPTION_ANNOTATION]: input.description.trim() }
          : undefined,
      },
    },
  });

  try {
    await k8sRequest(`/api/v1/namespaces/${encodeURIComponent(name)}/resourcequotas`, {
      method: 'POST',
      body: {
        apiVersion: 'v1',
        kind: 'ResourceQuota',
        metadata: { name: PROJECT_QUOTA_NAME },
        spec: { hard },
      },
    });
  } catch (error) {
    await k8sRequest(`/api/v1/namespaces/${encodeURIComponent(name)}`, { method: 'DELETE' }).catch(
      () => undefined,
    );
    throw error;
  }
};
