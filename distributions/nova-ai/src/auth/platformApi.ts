import { k8sRequest } from '../cluster/k8sClient';
import type { K8sList } from '../cluster/types';
import { hasConsoleScope } from '../consoleScope';
import type {
  PlatformRoleBindingKind,
  PlatformRoleKind,
  PlatformUserKind,
} from './types';

export const PLATFORM_AUTH_API = '/apis/auth.nova-platform.io/v1alpha1';

export const listPlatformRoles = (): Promise<PlatformRoleKind[]> =>
  k8sRequest<K8sList<PlatformRoleKind>>(`${PLATFORM_AUTH_API}/platformroles`).then((list) =>
    list.items.filter((role) => hasConsoleScope(role.metadata.labels)),
  );

export const listPlatformUsers = (): Promise<PlatformUserKind[]> =>
  k8sRequest<K8sList<PlatformUserKind>>(`${PLATFORM_AUTH_API}/users`).then((list) => list.items);

export const listPlatformRoleBindings = (): Promise<PlatformRoleBindingKind[]> =>
  k8sRequest<K8sList<PlatformRoleBindingKind>>(
    `${PLATFORM_AUTH_API}/platformrolebindings`,
  ).then((list) => list.items);

export const createPlatformRoleBinding = (
  binding: PlatformRoleBindingKind,
): Promise<PlatformRoleBindingKind> =>
  k8sRequest<PlatformRoleBindingKind>(`${PLATFORM_AUTH_API}/platformrolebindings`, {
    method: 'POST',
    body: binding,
  });

export const deletePlatformRoleBinding = (name: string): Promise<void> =>
  k8sRequest(`${PLATFORM_AUTH_API}/platformrolebindings/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });

export const dns1123Name = (value: string): string => {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
  return normalized || `nova-ai-${Date.now()}`;
};
