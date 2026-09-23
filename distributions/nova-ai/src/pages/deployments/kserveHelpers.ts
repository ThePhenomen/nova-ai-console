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

export type EnvDraft = {
  name: string;
  value: string;
};

export type LabelDraft = {
  key: string;
  value: string;
};

export type GraphStepDraft = {
  serviceName: string;
  name: string;
  data: string;
  condition: string;
  extra: Record<string, unknown>;
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

export const ensureSpec = (resource: KServeResource): Record<string, unknown> => {
  const root = resource as unknown as Record<string, unknown>;
  if (!asRecord(root.spec)) {
    root.spec = {};
  }
  return root.spec as Record<string, unknown>;
};

export const ensurePredictor = (resource: KServeResource): Record<string, unknown> => {
  const spec = ensureSpec(resource);
  if (!asRecord(spec.predictor)) {
    spec.predictor = {};
  }
  return spec.predictor as Record<string, unknown>;
};

export const ensureModel = (resource: KServeResource): Record<string, unknown> => {
  const predictor = ensurePredictor(resource);
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

export const writeSpecResourceValue = (
  resource: KServeResource,
  side: 'requests' | 'limits',
  name: string,
  raw: string,
): void => {
  const spec = ensureSpec(resource);
  let resources = asRecord(spec.resources);
  if (!resources) {
    resources = {};
    spec.resources = resources;
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
    delete spec.resources;
  }
};

export const specResourceValue = (
  resource: KServeResource,
  side: 'requests' | 'limits',
  name: string,
): string => {
  const resources = asRecord(asRecord(resource.spec)?.resources);
  const bucket = asRecord(resources?.[side]);
  const value = bucket?.[name];
  return value === undefined || value === null ? '' : String(value);
};

export const readEnv = (resource: KServeResource): EnvDraft[] => {
  const value = getAt(resource, 'spec.predictor.model.env');
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const env = asRecord(item);
    return {
      name: typeof env?.name === 'string' ? env.name : '',
      value: typeof env?.value === 'string' ? env.value : '',
    };
  });
};

export const writeEnv = (resource: KServeResource, env: EnvDraft[]): void => {
  const nextEnv = env.map((item) => {
    const next: Record<string, unknown> = {};
    if (item.name.trim() !== '') {
      next.name = item.name.trim();
    }
    if (item.value !== '') {
      next.value = item.value;
    }
    return next;
  });
  setAt(
    resource as unknown as Record<string, unknown>,
    'spec.predictor.model.env',
    nextEnv.length > 0 ? nextEnv : undefined,
  );
};

export const sanitizeEnv = (resource: KServeResource): void => {
  writeEnv(
    resource,
    readEnv(resource).filter((item) => item.name.trim() !== ''),
  );
};

export const readLabels = (resource: KServeResource): LabelDraft[] =>
  Object.entries(resource.metadata.labels ?? {}).map(([key, value]) => ({ key, value }));

export const writeLabels = (resource: KServeResource, labels: LabelDraft[]): void => {
  const next: Record<string, string> = {};
  labels.forEach((item) => {
    const key = item.key.trim();
    if (key !== '') {
      next[key] = item.value;
    }
  });
  if (Object.keys(next).length === 0) {
    delete resource.metadata.labels;
    return;
  }
  resource.metadata.labels = next;
};

export const readGraphSteps = (resource: KServeResource): GraphStepDraft[] => {
  const value = getAt(resource, 'spec.nodes.root.steps');
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const step = asRecord(item) ?? {};
    const { serviceName, name, data, condition, ...extra } = step;
    return {
      serviceName: typeof serviceName === 'string' ? serviceName : '',
      name: typeof name === 'string' ? name : '',
      data: typeof data === 'string' ? data : '',
      condition: typeof condition === 'string' ? condition : '',
      extra,
    };
  });
};

export const writeGraphSteps = (resource: KServeResource, steps: GraphStepDraft[]): void => {
  const spec = ensureSpec(resource);
  let nodes = asRecord(spec.nodes);
  if (!nodes) {
    nodes = {};
    spec.nodes = nodes;
  }
  let root = asRecord(nodes.root);
  if (!root) {
    root = { routerType: 'Sequence' };
    nodes.root = root;
  }
  root.steps = steps.map((step) => {
    const next: Record<string, unknown> = { ...step.extra };
    if (step.serviceName.trim() !== '') {
      next.serviceName = step.serviceName.trim();
    } else {
      delete next.serviceName;
    }
    if (step.name.trim() !== '') {
      next.name = step.name.trim();
    } else {
      delete next.name;
    }
    if (step.data.trim() !== '') {
      next.data = step.data.trim();
    } else {
      delete next.data;
    }
    if (step.condition.trim() !== '') {
      next.condition = step.condition.trim();
    } else {
      delete next.condition;
    }
    return next;
  });
};

export const sanitizeGraphSteps = (resource: KServeResource): void => {
  writeGraphSteps(
    resource,
    readGraphSteps(resource).filter(
      (step) =>
        step.serviceName.trim() !== '' ||
        step.name.trim() !== '' ||
        step.data.trim() !== '' ||
        step.condition.trim() !== '' ||
        Object.keys(step.extra).length > 0,
    ),
  );
};

export const writeWorkerSpecNumber = (resource: KServeResource, key: string, raw: string): void => {
  const predictor = ensurePredictor(resource);
  let workerSpec = asRecord(predictor.workerSpec);
  if (!workerSpec) {
    workerSpec = {};
    predictor.workerSpec = workerSpec;
  }
  if (raw.trim() === '') {
    delete workerSpec[key];
  } else if (/^\d+$/.test(raw.trim())) {
    const value = Number(raw.trim());
    if (value >= 1) {
      workerSpec[key] = value;
    }
  }
  if (Object.keys(workerSpec).length === 0) {
    delete predictor.workerSpec;
  }
};

export const workerSpecNumber = (resource: KServeResource, key: string): string => {
  const workerSpec = asRecord(asRecord(asRecord(resource.spec)?.predictor)?.workerSpec);
  const value = workerSpec?.[key];
  return value === undefined || value === null ? '' : String(value);
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
  sanitizeEnv(next);
  sanitizePorts(next);
  sanitizeGraphSteps(next);
  const model = asRecord(asRecord(asRecord(next.spec)?.predictor)?.model);
  if (model) {
    if (storageModeOf(next) === 'storage') {
      delete model.storageUri;
      const storage = asRecord(model.storage);
      if (storage && !storage.key && !storage.path) {
        delete model.storage;
      }
    } else {
      delete model.storage;
    }
  }
  return next;
};
