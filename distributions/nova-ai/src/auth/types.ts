import type { K8sObjectMeta } from '../cluster/types';

export type ConsolePersona = 'none' | 'viewer' | 'developer' | 'admin';

export type OidcConfig = {
  issuer: string;
  clientId: string;
  scopes?: string;
};

export type AuthUser = {
  sub: string;
  username: string;
  email?: string;
  groups: string[];
};

export type AuthSession = {
  accessToken: string;
  idToken?: string;
  user: AuthUser;
};

export type PlatformRoleKind = {
  apiVersion: string;
  kind: string;
  metadata: K8sObjectMeta;
  spec?: {
    kubernetes?: {
      clusterRoleSelectors?: Array<{
        matchLabels?: Record<string, string>;
      }>;
    };
    starvault?: {
      policies?: string[];
    };
    oidc?: {
      applications?: string[];
    };
  };
  status?: {
    phase?: string;
    resolvedApplications?: string[];
    resolvedPolicies?: string[];
    aggregatedClusterRole?: string;
  };
};

export type PlatformBindingSubject = {
  kind: 'User' | 'Group' | 'ServiceAccount' | string;
  name: string;
  namespace?: string;
};

export type KubernetesTarget = 'None' | 'Cluster' | 'Namespaces' | string;

export type PlatformRoleBindingKind = {
  apiVersion: string;
  kind: string;
  metadata: K8sObjectMeta;
  spec: {
    platformRoleRef: { name: string };
    subjects: PlatformBindingSubject[];
    kubernetes?: {
      target?: KubernetesTarget;
      namespaces?: string[];
    };
  };
  status?: {
    phase?: string;
    resolvedSubjects?: Array<PlatformBindingSubject & { identity?: string }>;
    appliedTarget?: {
      target?: KubernetesTarget;
      namespaces?: string[];
    };
  };
};

export type ProjectAccess = {
  persona: ConsolePersona;
  canView: boolean;
  canEdit: boolean;
  canManageRbac: boolean;
  services: string[];
};

export type AccessSource = 'bootstrap' | 'oidc' | 'unavailable';

export type PlatformAccess = {
  source: AccessSource;
  clusterPersona: ConsolePersona;
  canCreateProjects: boolean;
  username?: string;
  forProject: (projectName: string) => ProjectAccess;
  canViewProject: (projectName: string) => boolean;
};
