import { k8sRequest } from '../../cluster/k8sClient';
import type { K8sList } from '../../cluster/types';
import type { KindCatalog, KServeResource } from './crdCatalog';
import { cloneResource } from './manifest';

const collectionPath = (kind: KindCatalog, namespace?: string): string =>
  `/apis/${kind.group}/${kind.version}/namespaces/${encodeURIComponent(namespace ?? '')}/${kind.plural}`;

const itemPath = (kind: KindCatalog, namespace: string | undefined, name: string): string =>
  `${collectionPath(kind, namespace)}/${encodeURIComponent(name)}`;

const writable = (resource: KServeResource, keepVersion: boolean): KServeResource => {
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
    next.metadata = metadata as KServeResource['metadata'];
  }
  return next;
};

export const listKServeResources = async (
  kind: KindCatalog,
  namespace?: string,
): Promise<KServeResource[]> => {
  const list = await k8sRequest<K8sList<KServeResource>>(collectionPath(kind, namespace));
  return list.items ?? [];
};

export const createKServeResource = (
  kind: KindCatalog,
  resource: KServeResource,
): Promise<KServeResource> =>
  k8sRequest<KServeResource>(collectionPath(kind, resource.metadata.namespace), {
    method: 'POST',
    body: writable(resource, false),
  });

export const updateKServeResource = (
  kind: KindCatalog,
  resource: KServeResource,
): Promise<KServeResource> =>
  k8sRequest<KServeResource>(itemPath(kind, resource.metadata.namespace, resource.metadata.name), {
    method: 'PUT',
    body: writable(resource, true),
  });

export const deleteKServeResource = (
  kind: KindCatalog,
  name: string,
  namespace?: string,
): Promise<void> => k8sRequest(itemPath(kind, namespace, name), { method: 'DELETE' });
