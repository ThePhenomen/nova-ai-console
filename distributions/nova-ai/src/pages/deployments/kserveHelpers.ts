import type { FieldDef, KindCatalog, KServeResource } from './crdCatalog';
import { getAt, setAt } from './manifest';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
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

export const fieldToString = (resource: KServeResource, field: FieldDef): string => {
  const value = getAt(resource, field.path);
  if (field.type === 'stringList') {
    return Array.isArray(value) ? value.map(String).filter((item) => item !== '').join(', ') : '';
  }
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
  if (field.type === 'stringList') {
    const items = raw
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    setAt(target, field.path, items.length > 0 ? items : undefined);
    return;
  }
  setAt(target, field.path, raw.trim() === '' ? undefined : raw);
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
  const modelUri = asRecord(predictor?.model)?.storageUri;
  if (typeof modelUri === 'string' && modelUri.trim() !== '') {
    return modelUri;
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
