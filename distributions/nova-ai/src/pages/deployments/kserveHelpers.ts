import type { FieldDef, KindCatalog, KServeResource } from './crdCatalog';
import { cloneResource, getAt, setAt } from './manifest';

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const PREDICTOR_META_KEYS = new Set([
  'minReplicas',
  'maxReplicas',
  'containerConcurrency',
  'timeout',
  'canaryTrafficPercent',
  'logger',
  'batcher',
  'labels',
  'annotations',
  'serviceAccountName',
  'imagePullSecrets',
  'affinity',
  'nodeSelector',
  'tolerations',
  'schedulerName',
  'runtime',
  'runtimeVersion',
  'model',
]);

export type StorageMode = 'uri' | 'storage';

export type PortDraft = {
  containerPort: string;
  name: string;
  protocol: string;
};

export const emptyResource = (kind: KindCatalog, namespace: string): KServeResource => {
  const metadata = { name: '', namespace };
  if (kind.kind === 'InferenceGraph') {
    return {
      apiVersion: kind.apiVersion,
      kind: kind.kind,
      metadata,
      spec: {
        nodes: {
          root: {
            routerType: 'Sequence',
            steps: [{ serviceName: '' }],
          },
        },
      },
    };
  }
  return {
    apiVersion: kind.apiVersion,
    kind: kind.kind,
    metadata,
    spec: {
      predictor: {
        minReplicas: 1,
        model: {
          modelFormat: { name: 'sklearn' },
        },
      },
    },
  };
};

export const ensureModel = (resource: KServeResource): Record<string, unknown> => {
  const root = resource as unknown as Record<string, unknown>;
  if (!asRecord(root.spec)) {
    root.spec = {};
  }
  const spec = root.spec as Record<string, unknown>;
  if (!asRecord(spec.predictor)) {
    spec.predictor = {};
  }
  const predictor = spec.predictor as Record<string, unknown>;
  if (!asRecord(predictor.model)) {
    predictor.model = {};
  }
  return predictor.model as Record<string, unknown>;
};

export const fieldToString = (resource: KServeResource, field: FieldDef): string => {
  const value = getAt(resource, field.path);
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
};

export const applyField = (resource: KServeResource, field: FieldDef, raw: string): void => {
  const target = resource as unknown as Record<string, unknown>;
  if (field.type === 'number') {
    const parsed = Number(raw);
    setAt(target, field.path, raw.trim() === '' || Number.isNaN(parsed) ? undefined : parsed);
    return;
  }
  setAt(target, field.path, raw.trim() === '' ? undefined : raw);
};

export const readStringList = (resource: KServeResource, path: string): string[] => {
  const value = getAt(resource, path);
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
};

export const writeStringList = (resource: KServeResource, path: string, items: string[]): void => {
  setAt(resource as unknown as Record<string, unknown>, path, items.length > 0 ? items : undefined);
};

export const storageModeOf = (resource: KServeResource): StorageMode => {
  const model = asRecord(asRecord(asRecord(resource.spec)?.predictor)?.model);
  return asRecord(model?.storage) ? 'storage' : 'uri';
};

export const readPorts = (resource: KServeResource): PortDraft[] => {
  const value = getAt(resource, 'spec.predictor.model.ports');
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const port = asRecord(item);
    return {
      containerPort: port?.containerPort === undefined || port.containerPort === null ? '' : String(port.containerPort),
      name: typeof port?.name === 'string' ? port.name : '',
      protocol: typeof port?.protocol === 'string' && port.protocol.trim() !== '' ? port.protocol : 'TCP',
    };
  });
};

export const writePorts = (resource: KServeResource, ports: PortDraft[]): void => {
  const nextPorts = ports.map((port) => {
    const containerPort = Number(port.containerPort);
    const next: Record<string, unknown> = {
      protocol: port.protocol.trim() !== '' ? port.protocol.trim() : 'TCP',
    };
    if (Number.isInteger(containerPort) && containerPort > 0) {
      next.containerPort = containerPort;
    }
    if (port.name.trim() !== '') {
      next.name = port.name.trim();
    }
    return next;
  });
  setAt(
    resource as unknown as Record<string, unknown>,
    'spec.predictor.model.ports',
    nextPorts.length > 0 ? nextPorts : undefined,
  );
};

export const sanitizePorts = (resource: KServeResource): void => {
  writePorts(
    resource,
    readPorts(resource).filter((port) => Number.isInteger(Number(port.containerPort)) && Number(port.containerPort) > 0),
  );
};

export const resourceValue = (resource: KServeResource, side: 'requests' | 'limits', name: string): string => {
  const model = asRecord(asRecord(asRecord(resource.spec)?.predictor)?.model);
  const resources = asRecord(model?.resources);
  const bucket = asRecord(resources?.[side]);
  const value = bucket?.[name];
  return value === undefined || value === null ? '' : String(value);
};

export const writeResourceValue = (
  resource: KServeResource,
  side: 'requests' | 'limits',
  name: string,
  raw: string,
): void => {
  const model = ensureModel(resource);
  let resources = asRecord(model.resources);
  if (!resources) {
    resources = {};
    model.resources = resources;
  }
  let bucket = asRecord(resources[side]);
  if (!bucket) {
    bucket = {};
    resources[side] = bucket;
  }
  if (raw.trim() === '') {
    delete bucket[name];
  } else {
    bucket[name] = raw.trim();
  }
  if (Object.keys(bucket).length === 0) {
    delete resources[side];
  }
  if (Object.keys(resources).length === 0) {
    delete model.resources;
  }
};

export const setStorageMode = (resource: KServeResource, mode: StorageMode): void => {
  const model = ensureModel(resource);
  if (mode === 'uri') {
    delete model.storage;
    return;
  }
  delete model.storageUri;
  if (!asRecord(model.storage)) {
    model.storage = { key: '', path: '' };
  }
};

export const storageField = (resource: KServeResource, name: 'key' | 'path'): string => {
  const model = asRecord(asRecord(asRecord(resource.spec)?.predictor)?.model);
  const storage = asRecord(model?.storage);
  const value = storage?.[name];
  return typeof value === 'string' ? value : '';
};

export const writeStorageField = (resource: KServeResource, name: 'key' | 'path', raw: string): void => {
  const model = ensureModel(resource);
  let storage = asRecord(model.storage);
  if (!storage) {
    storage = {};
    model.storage = storage;
  }
  if (raw.trim() === '') {
    delete storage[name];
  } else {
    storage[name] = raw.trim();
  }
};

export const predictorType = (resource: KServeResource): string => {
  const predictor = asRecord(asRecord(resource.spec)?.predictor);
  if (!predictor) {
    return '—';
  }
  const model = asRecord(predictor.model);
  const format = asRecord(model?.modelFormat)?.name;
  if (typeof format === 'string' && format.trim() !== '') {
    return format;
  }
  const framework = Object.keys(predictor).find((key) => !PREDICTOR_META_KEYS.has(key));
  return framework ?? '—';
};

export const storageUriOf = (resource: KServeResource): string => {
  const predictor = asRecord(asRecord(resource.spec)?.predictor);
  const model = asRecord(predictor?.model);
  const modelUri = model?.storageUri;
  if (typeof modelUri === 'string' && modelUri.trim() !== '') {
    return modelUri;
  }
  const storage = asRecord(model?.storage);
  const key = typeof storage?.key === 'string' ? storage.key : '';
  const path = typeof storage?.path === 'string' ? storage.path : '';
  if (key || path) {
    return [key, path].filter((item) => item !== '').join('/');
  }
  return '—';
};

export const readyStatus = (resource: KServeResource): 'True' | 'False' | 'Unknown' => {
  const ready = resource.status?.conditions?.find((condition) => condition.type === 'Ready');
  if (ready?.status === 'True' || ready?.status === 'False') {
    return ready.status;
  }
  return 'Unknown';
};

export const serviceUrl = (resource: KServeResource): string => {
  const status = resource.status;
  if (!status) {
    return '';
  }
  if (status.url) {
    return status.url;
  }
  if (status.address?.url) {
    return status.address.url;
  }
  const components = asRecord(status.components);
  const predictor = asRecord(components?.predictor);
  return typeof predictor?.url === 'string' ? predictor.url : '';
};

export const resourceSummary = (kind: KindCatalog, resource: KServeResource): string => {
  if (kind.kind === 'InferenceGraph') {
    const nodes = asRecord(asRecord(resource.spec)?.nodes);
    const count = nodes ? Object.keys(nodes).length : 0;
    return count === 1 ? '1 node' : `${count} nodes`;
  }
  return predictorType(resource);
};

export const prepareForSave = (resource: KServeResource): KServeResource => {
  const next = cloneResource(resource);
  const args = readStringList(next, 'spec.predictor.model.args')
    .map((item) => item.trim())
    .filter((item) => item !== '');
  writeStringList(next, 'spec.predictor.model.args', args);
  sanitizePorts(next);
  const model = asRecord(asRecord(asRecord(next.spec)?.predictor)?.model);
  if (!model) {
    return next;
  }
  if (storageModeOf(next) === 'storage') {
    delete model.storageUri;
    const storage = asRecord(model.storage);
    if (storage && !storage.key && !storage.path) {
      delete model.storage;
    }
  } else {
    delete model.storage;
  }
  return next;
};
