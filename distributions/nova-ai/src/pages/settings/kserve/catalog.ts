import type { K8sObjectMeta } from '../../../cluster/types';

export type KServeSettingsKind = 'ClusterServingRuntime' | 'ClusterStorageContainer' | 'ServingRuntime';

export type SettingsKindCatalog = {
  kind: KServeSettingsKind;
  title: string;
  description: string;
  apiVersion: 'serving.kserve.io/v1alpha1';
  group: 'serving.kserve.io';
  version: 'v1alpha1';
  plural: string;
  scope: 'Cluster' | 'Namespaced';
  tabId: string;
};

export type KServeSettingsResource = {
  apiVersion?: string;
  kind?: string;
  metadata: K8sObjectMeta;
  spec?: Record<string, unknown>;
  disabled?: boolean;
  status?: Record<string, unknown>;
};

/** Cluster/namespaced ServingRuntimes with this label are treated as pre-installed templates. */
export const PRE_INSTALLED_LABEL = 'nova-ai.io/pre-installed';

export const PROTOCOL_VERSIONS = ['v1', 'v2', 'grpc-v1', 'grpc-v2'] as const;

export const WORKLOAD_TYPES = ['initContainer', 'container'] as const;

export const SETTINGS_KIND_CATALOG: SettingsKindCatalog[] = [
  {
    kind: 'ClusterServingRuntime',
    title: 'Cluster serving runtimes',
    description: 'Cluster-wide runtimes used when an InferenceService does not pin a namespaced ServingRuntime.',
    apiVersion: 'serving.kserve.io/v1alpha1',
    group: 'serving.kserve.io',
    version: 'v1alpha1',
    plural: 'clusterservingruntimes',
    scope: 'Cluster',
    tabId: 'cluster-serving-runtimes',
  },
  {
    kind: 'ClusterStorageContainer',
    title: 'Cluster storage containers',
    description: 'Cluster-wide storage initializer used to download models from URI prefixes and regexes.',
    apiVersion: 'serving.kserve.io/v1alpha1',
    group: 'serving.kserve.io',
    version: 'v1alpha1',
    plural: 'clusterstoragecontainers',
    scope: 'Cluster',
    tabId: 'cluster-storage-containers',
  },
  {
    kind: 'ServingRuntime',
    title: 'Serving runtimes',
    description: 'Project-scoped runtimes. Developers can create and edit these in their projects.',
    apiVersion: 'serving.kserve.io/v1alpha1',
    group: 'serving.kserve.io',
    version: 'v1alpha1',
    plural: 'servingruntimes',
    scope: 'Namespaced',
    tabId: 'serving-runtimes',
  },
];

export const settingsKindByTab = (tabId: string | undefined): SettingsKindCatalog => {
  const found = SETTINGS_KIND_CATALOG.find((item) => item.tabId === tabId);
  if (found) {
    return found;
  }
  const fallback = SETTINGS_KIND_CATALOG.find((item) => item.kind === 'ClusterServingRuntime');
  if (!fallback) {
    throw new Error('KServe settings catalog is empty');
  }
  return fallback;
};

export const settingsKindByName = (kind: string): SettingsKindCatalog => {
  const found = SETTINGS_KIND_CATALOG.find((item) => item.kind === kind);
  if (!found) {
    throw new Error(`Unknown KServe settings kind: ${kind}`);
  }
  return found;
};

export const settingsListPath = (kind: SettingsKindCatalog): string => `/settings/kserve/${kind.tabId}`;

export const settingsDetailsPath = (
  kind: SettingsKindCatalog,
  name: string,
  namespace?: string,
): string =>
  kind.scope === 'Namespaced'
    ? `/settings/kserve/${kind.tabId}/${encodeURIComponent(namespace ?? '')}/${encodeURIComponent(name)}`
    : `/settings/kserve/${kind.tabId}/${encodeURIComponent(name)}`;
