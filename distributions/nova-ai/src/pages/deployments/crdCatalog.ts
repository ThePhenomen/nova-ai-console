import type { K8sObjectMeta } from '../../cluster/types';

export type K8sCondition = {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
};

export type KServeResource = {
  apiVersion?: string;
  kind?: string;
  metadata: K8sObjectMeta;
  spec?: Record<string, unknown>;
  status?: {
    url?: string;
    address?: { url?: string };
    conditions?: K8sCondition[];
    copies?: { available?: number; failed?: number; total?: number };
    [key: string]: unknown;
  };
};

export type FieldType = 'string' | 'number' | 'stringList' | 'select';

export type FieldDef = {
  path: string;
  label: string;
  type: FieldType;
  group: 'basic' | 'advanced';
  required?: boolean;
  placeholder?: string;
  helperText?: string;
  options?: string[];
};

export type KindCatalog = {
  kind: 'InferenceService' | 'InferenceGraph';
  title: string;
  description: string;
  apiVersion: string;
  group: string;
  version: string;
  plural: string;
  scope: 'Namespaced';
  fields: FieldDef[];
};

export const MODEL_FORMATS = [
  'sklearn',
  'xgboost',
  'tensorflow',
  'pytorch',
  'onnx',
  'huggingface',
  'mlflow',
  'lightgbm',
  'paddle',
  'pmml',
  'triton',
] as const;

export const GRAPH_ROUTER_TYPES = ['Sequence', 'Splitter', 'Ensemble', 'Switch'] as const;

export const KIND_CATALOG: KindCatalog[] = [
  {
    kind: 'InferenceService',
    title: 'InferenceService',
    description: 'Deploy a single model.',
    apiVersion: 'serving.kserve.io/v1beta1',
    group: 'serving.kserve.io',
    version: 'v1beta1',
    plural: 'inferenceservices',
    scope: 'Namespaced',
    fields: [
      { path: 'metadata.name', label: 'Name', type: 'string', group: 'basic', required: true },
      {
        path: 'spec.predictor.model.modelFormat.name',
        label: 'Model format',
        type: 'select',
        group: 'basic',
        required: true,
        options: [...MODEL_FORMATS],
      },
      {
        path: 'spec.predictor.model.storageUri',
        label: 'Storage URI',
        type: 'string',
        group: 'basic',
        required: true,
        placeholder: 's3://bucket/model or pvc://my-pvc/path',
        helperText: 'URI of the model artifact. Supports s3://, gs://, pvc://, and http(s)://.',
      },
      {
        path: 'spec.predictor.model.runtime',
        label: 'Serving runtime',
        type: 'string',
        group: 'advanced',
        placeholder: 'Optional ServingRuntime name',
        helperText: 'Leave empty to let KServe pick a runtime from the model format.',
      },
      { path: 'spec.predictor.minReplicas', label: 'Min replicas', type: 'number', group: 'advanced' },
      { path: 'spec.predictor.maxReplicas', label: 'Max replicas', type: 'number', group: 'advanced' },
      {
        path: 'spec.predictor.model.resources.requests.cpu',
        label: 'CPU request',
        type: 'string',
        group: 'advanced',
        placeholder: '100m',
      },
      {
        path: 'spec.predictor.model.resources.requests.memory',
        label: 'Memory request',
        type: 'string',
        group: 'advanced',
        placeholder: '256Mi',
      },
    ],
  },
  {
    kind: 'InferenceGraph',
    title: 'InferenceGraph',
    description: 'Route traffic across InferenceServices.',
    apiVersion: 'serving.kserve.io/v1alpha1',
    group: 'serving.kserve.io',
    version: 'v1alpha1',
    plural: 'inferencegraphs',
    scope: 'Namespaced',
    fields: [
      { path: 'metadata.name', label: 'Name', type: 'string', group: 'basic', required: true },
      {
        path: 'spec.nodes.root.routerType',
        label: 'Router',
        type: 'select',
        group: 'basic',
        required: true,
        options: [...GRAPH_ROUTER_TYPES],
      },
      {
        path: 'spec.nodes.root.steps.0.serviceName',
        label: 'Root service',
        type: 'string',
        group: 'basic',
        required: true,
        placeholder: 'InferenceService name',
        helperText: 'First node in the graph. Add more nodes in the raw manifest.',
      },
      { path: 'spec.minReplicas', label: 'Min replicas', type: 'number', group: 'advanced' },
      { path: 'spec.maxReplicas', label: 'Max replicas', type: 'number', group: 'advanced' },
    ],
  },
];

export const kindByName = (kind: string): KindCatalog => {
  const found = KIND_CATALOG.find((item) => item.kind === kind);
  if (!found) {
    throw new Error(`Unknown deployment kind: ${kind}`);
  }
  return found;
};
