import type { K8sObjectMeta } from '../../cluster/types';

export type K8sCondition = {
  type?: string;
  status?: string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
};

export type PredictorModel = {
  modelFormat?: { name?: string; version?: string };
  storageUri?: string;
  runtime?: string;
  protocolVersion?: string;
  resources?: {
    requests?: Record<string, string>;
    limits?: Record<string, string>;
  };
};

export type InferenceServicePredictor = {
  minReplicas?: number;
  maxReplicas?: number;
  model?: PredictorModel;
  [framework: string]: unknown;
};

export type InferenceServiceKind = {
  apiVersion: string;
  kind: string;
  metadata: K8sObjectMeta;
  spec?: {
    predictor?: InferenceServicePredictor;
    explainer?: unknown;
    transformer?: unknown;
  };
  status?: {
    url?: string;
    address?: { url?: string };
    components?: {
      predictor?: { url?: string };
    };
    conditions?: K8sCondition[];
    modelStatus?: {
      transitionStatus?: string;
      modelRevisionStates?: { activeModelState?: string };
    };
  };
};

export const INFERENCE_SERVICE_API = 'serving.kserve.io/v1beta1';
export const INFERENCE_SERVICE_KIND = 'InferenceService';

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

export type InferenceServiceFormValues = {
  name: string;
  namespace: string;
  format: string;
  storageUri: string;
  runtime: string;
  minReplicas: string;
  cpu: string;
  memory: string;
};
