import { k8sRequest } from '../../cluster/k8sClient';
import type { K8sList } from '../../cluster/types';
import {
  INFERENCE_SERVICE_API,
  INFERENCE_SERVICE_KIND,
  type InferenceServiceFormValues,
  type InferenceServiceKind,
} from './types';
import { predictorModelFromForm } from './kserveHelpers';

const collectionPath = (namespace: string): string =>
  `/apis/${INFERENCE_SERVICE_API}/namespaces/${encodeURIComponent(namespace)}/inferenceservices`;

const itemPath = (namespace: string, name: string): string =>
  `${collectionPath(namespace)}/${encodeURIComponent(name)}`;

export const listInferenceServices = async (namespace: string): Promise<InferenceServiceKind[]> => {
  const list = await k8sRequest<K8sList<InferenceServiceKind>>(collectionPath(namespace));
  return list.items ?? [];
};

export const getInferenceService = (
  namespace: string,
  name: string,
): Promise<InferenceServiceKind> => k8sRequest<InferenceServiceKind>(itemPath(namespace, name));

export const deleteInferenceService = (namespace: string, name: string): Promise<void> =>
  k8sRequest(itemPath(namespace, name), { method: 'DELETE' });

const buildSpec = (values: InferenceServiceFormValues): InferenceServiceKind['spec'] => {
  const minReplicas = Number.parseInt(values.minReplicas, 10);
  return {
    predictor: {
      ...(Number.isFinite(minReplicas) && minReplicas >= 0 ? { minReplicas } : {}),
      model: predictorModelFromForm(values),
    },
  };
};

export const createInferenceService = async (
  values: InferenceServiceFormValues,
): Promise<InferenceServiceKind> => {
  const body: InferenceServiceKind = {
    apiVersion: INFERENCE_SERVICE_API,
    kind: INFERENCE_SERVICE_KIND,
    metadata: {
      name: values.name.trim(),
      namespace: values.namespace.trim(),
    },
    spec: buildSpec(values),
  };
  return k8sRequest<InferenceServiceKind>(collectionPath(values.namespace.trim()), {
    method: 'POST',
    body,
  });
};

export const updateInferenceService = async (
  current: InferenceServiceKind,
  values: InferenceServiceFormValues,
): Promise<InferenceServiceKind> => {
  const namespace = current.metadata.namespace ?? values.namespace;
  const name = current.metadata.name;
  const next: InferenceServiceKind = {
    apiVersion: current.apiVersion,
    kind: current.kind,
    metadata: current.metadata,
    spec: {
      ...current.spec,
      ...buildSpec(values),
    },
  };
  return k8sRequest<InferenceServiceKind>(itemPath(namespace, name), {
    method: 'PUT',
    body: next,
  });
};
