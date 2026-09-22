import type { K8sObjectMeta } from '../cluster/types';

export type ConsolePersona = 'none' | 'viewer' | 'developer' | 'admin';

export type OidcConfig = {
  issuer: string;
  clientId: string;
  clientSecret?: string;
  scopes?: string;
  redirectUri?: string;
};

export type AuthUser = {
  sub: string;
  username: string;
  email?: string;
  groups: string[];
  aliases?: string[];
};

export type AuthSession = {
  accessToken: string;
  idToken?: string;
  user: AuthUser;
};

export type PlatformUserKind = {
  apiVersion?: string;
  kind?: string;
  metadata: K8sObjectMeta;
  spec?: {
    username?: string;
  };
  status?: {
    username?: string;
    entityId?: string;
    email?: string;
    displayName?: string;
    groups?: string[];
  };
};

export type PlatformGroupKind = {
  apiVersion?: string;
  kind?: string;
  metadata: K8sObjectMeta;
  spec?: {
    type?: string;
    members?: string[];
    groupName?: string;
  };
  status?: {
    starvaultGroupId?: string;
  };
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
  identity?: string;
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
  services: string[];
  forProject: (projectName: string) => ProjectAccess;
  canViewProject: (projectName: string) => boolean;
};
