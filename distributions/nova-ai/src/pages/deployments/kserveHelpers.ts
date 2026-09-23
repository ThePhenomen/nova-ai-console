import type { InferenceServiceFormValues, InferenceServiceKind, PredictorModel } from './types';

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

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;

export const predictorType = (service: InferenceServiceKind): string => {
  const predictor = service.spec?.predictor;
  if (!predictor) {
    return '—';
  }
  const format = predictor.model?.modelFormat?.name?.trim();
  if (format) {
    return format;
  }
  const framework = Object.keys(predictor).find((key) => !PREDICTOR_META_KEYS.has(key));
  return framework ?? '—';
};

export const storageUriOf = (service: InferenceServiceKind): string => {
  const predictor = service.spec?.predictor;
  if (!predictor) {
    return '—';
  }
  if (predictor.model?.storageUri) {
    return predictor.model.storageUri;
  }
  const framework = predictorType(service);
  const impl = asRecord(predictor[framework]);
  const uri = impl?.storageUri;
  return typeof uri === 'string' && uri.trim() !== '' ? uri : '—';
};

export const readyStatus = (service: InferenceServiceKind): 'True' | 'False' | 'Unknown' => {
  const ready = service.status?.conditions?.find((condition) => condition.type === 'Ready');
  if (ready?.status === 'True' || ready?.status === 'False') {
    return ready.status;
  }
  return 'Unknown';
};

export const serviceUrl = (service: InferenceServiceKind): string =>
  service.status?.url ||
  service.status?.address?.url ||
  service.status?.components?.predictor?.url ||
  '';

export const formValuesFromService = (service: InferenceServiceKind): InferenceServiceFormValues => {
  const predictor = service.spec?.predictor;
  const model = predictor?.model;
  const framework = predictorType(service);
  const impl = framework !== '—' ? asRecord(predictor?.[framework]) : undefined;
  const resources = model?.resources?.requests ?? asRecord(impl?.resources)?.requests;
  const requests = asRecord(resources);
  const uri = storageUriOf(service);
  return {
    name: service.metadata.name,
    namespace: service.metadata.namespace ?? '',
    format: framework === '—' ? 'sklearn' : framework,
    storageUri: uri === '—' ? '' : uri,
    runtime: model?.runtime ?? '',
    minReplicas: String(predictor?.minReplicas ?? 1),
    cpu: typeof requests?.cpu === 'string' ? requests.cpu : '100m',
    memory: typeof requests?.memory === 'string' ? requests.memory : '256Mi',
  };
};

export const predictorModelFromForm = (values: InferenceServiceFormValues): PredictorModel => ({
  modelFormat: { name: values.format.trim() || 'sklearn' },
  storageUri: values.storageUri.trim(),
  ...(values.runtime.trim() ? { runtime: values.runtime.trim() } : {}),
  resources: {
    requests: {
      ...(values.cpu.trim() ? { cpu: values.cpu.trim() } : {}),
      ...(values.memory.trim() ? { memory: values.memory.trim() } : {}),
    },
  },
});
