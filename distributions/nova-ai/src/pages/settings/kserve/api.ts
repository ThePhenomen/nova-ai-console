import { k8sRequest } from '../../../cluster/k8sClient';
import type { K8sList } from '../../../cluster/types';
import { cloneResource } from '../../deployments/manifest';
import type { KServeSettingsResource, SettingsKindCatalog } from './catalog';

const collectionPath = (kind: SettingsKindCatalog, namespace?: string): string => {
  const base = `/apis/${kind.group}/${kind.version}`;
  if (kind.scope === 'Namespaced') {
    return `${base}/namespaces/${encodeURIComponent(namespace ?? '')}/${kind.plural}`;
  }
  return `${base}/${kind.plural}`;
};

const itemPath = (kind: SettingsKindCatalog, name: string, namespace?: string): string =>
  `${collectionPath(kind, namespace)}/${encodeURIComponent(name)}`;

const writable = (resource: KServeSettingsResource, keepVersion: boolean): KServeSettingsResource => {
  const next = cloneResource(resource);
  delete next.status;
  if (next.metadata) {
    const metadata: Record<string, unknown> = { ...next.metadata };
    delete metadata.managedFields;
    delete metadata.uid;
    delete metadata.creationTimestamp;
    delete metadata.generation;
    delete metadata.deletionTimestamp;
    if (!keepVersion) {
      delete metadata.resourceVersion;
    }
    if (next.kind === 'ClusterServingRuntime' || next.kind === 'ClusterStorageContainer') {
      delete metadata.namespace;
    }
    next.metadata = metadata as KServeSettingsResource['metadata'];
  }
  return next;
};

export const listSettingsResources = async (
  kind: SettingsKindCatalog,
  namespace?: string,
): Promise<KServeSettingsResource[]> => {
  const list = await k8sRequest<K8sList<KServeSettingsResource>>(collectionPath(kind, namespace));
  return list.items ?? [];
};

export const getSettingsResource = (
  kind: SettingsKindCatalog,
  name: string,
  namespace?: string,
): Promise<KServeSettingsResource> => k8sRequest<KServeSettingsResource>(itemPath(kind, name, namespace));

export const createSettingsResource = (
  kind: SettingsKindCatalog,
  resource: KServeSettingsResource,
): Promise<KServeSettingsResource> =>
  k8sRequest<KServeSettingsResource>(collectionPath(kind, resource.metadata.namespace), {
    method: 'POST',
    body: writable(resource, false),
  });

export const updateSettingsResource = (
  kind: SettingsKindCatalog,
  resource: KServeSettingsResource,
): Promise<KServeSettingsResource> =>
  k8sRequest<KServeSettingsResource>(
    itemPath(kind, resource.metadata.name, resource.metadata.namespace),
    {
      method: 'PUT',
      body: writable(resource, true),
    },
  );

export const deleteSettingsResource = (
  kind: SettingsKindCatalog,
  name: string,
  namespace?: string,
): Promise<void> => k8sRequest(itemPath(kind, name, namespace), { method: 'DELETE' });
