export type ClusterConnection = {
  apiServer: string;
  token?: string;
  clientCertificateData?: string;
  clientKeyData?: string;
  certificateAuthorityData?: string;
};

export type K8sObjectMeta = {
  name: string;
  namespace?: string;
  uid?: string;
  creationTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
};

export type K8sList<T> = {
  items: T[];
};

export type K8sStatus = {
  kind?: string;
  message?: string;
  reason?: string;
  code?: number;
};

export type NamespaceKind = {
  apiVersion: string;
  kind: string;
  metadata: K8sObjectMeta;
  status?: { phase?: string };
};

export type ResourceQuotaKind = {
  apiVersion: string;
  kind: string;
  metadata: K8sObjectMeta;
  spec?: { hard?: Record<string, string> };
  status?: {
    hard?: Record<string, string>;
    used?: Record<string, string>;
  };
};

export type RoleKind = {
  apiVersion: string;
  kind: string;
  metadata: K8sObjectMeta;
  rules?: Array<{
    apiGroups?: string[];
    resources?: string[];
    verbs?: string[];
  }>;
};

export type RoleBindingKind = {
  apiVersion: string;
  kind: string;
  metadata: K8sObjectMeta;
  roleRef: {
    apiGroup: string;
    kind: string;
    name: string;
  };
  subjects?: Array<{
    kind: string;
    name: string;
    namespace?: string;
    apiGroup?: string;
  }>;
};

export const hasClusterCredentials = (connection: ClusterConnection): boolean => {
  if (connection.token && connection.token.trim() !== '') {
    return true;
  }
  return Boolean(connection.clientCertificateData && connection.clientKeyData);
};
