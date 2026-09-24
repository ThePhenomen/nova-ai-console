import { CONSOLE_NAV_SERVICE_TITLES, PIPELINES_SERVICE } from '../consoleServices';
import type {
  AuthUser,
  ConsoleRole,
  PlatformAccess,
  PlatformBindingSubject,
  PlatformGroupKind,
  PlatformRoleBindingKind,
  PlatformRoleKind,
  PlatformUserKind,
  ProjectAccess,
} from './types';

export const CONSOLE_SERVICE_LABEL = 'nova-ai.io/console-service';
export const CONSOLE_SERVICE_ENABLED = /^nova-ai\.io\/(.+)-enabled$/;
export const CONSOLE_PERSONA_LABEL = 'nova-ai.io/console-persona';
export const CONSOLE_OIDC_APPLICATION = 'nova-ai-console';
export const ADMIN_AGGREGATE_LABEL = 'nova-ai.io/aggregate-to-admin';
export const CONTRIBUTOR_AGGREGATE_LABEL = 'nova-ai.io/aggregate-to-developer';
export const VIEWER_AGGREGATE_LABEL = 'nova-ai.io/aggregate-to-viewer';

const ROLE_RANK: Record<ConsoleRole, number> = {
  none: 0,
  viewer: 1,
  contributor: 2,
  admin: 3,
};

const OIDC_AUTH_PREFIX = 'oidc-auth-';

export const maxRole = (left: ConsoleRole, right: ConsoleRole): ConsoleRole =>
  ROLE_RANK[left] >= ROLE_RANK[right] ? left : right;

const unique = (values: string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter((value) => value !== ''))].toSorted();

const identityTail = (identity: string): string => {
  const parts = identity.split(':');
  return parts[parts.length - 1] ?? identity;
};

const addIdentity = (bucket: Set<string>, value?: string): void => {
  if (!value) {
    return;
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return;
  }
  bucket.add(trimmed);
  bucket.add(trimmed.toLowerCase());
  const tail = identityTail(trimmed);
  if (tail !== trimmed) {
    bucket.add(tail);
    bucket.add(tail.toLowerCase());
  }
};

export const enrichUserFromPlatformDirectory = (
  user: AuthUser,
  platformUsers: PlatformUserKind[],
  platformGroups: PlatformGroupKind[],
): AuthUser => {
  const aliases = new Set<string>(user.aliases ?? []);
  addIdentity(aliases, user.sub);
  addIdentity(aliases, user.username);
  addIdentity(aliases, user.email);
  user.groups.forEach((group) => addIdentity(aliases, group));

  const matchedUser = platformUsers.find((platformUser) => {
    const candidates = [
      platformUser.metadata.name,
      platformUser.spec?.username,
      platformUser.status?.username,
      platformUser.status?.entityId,
      platformUser.status?.email,
      platformUser.status?.displayName,
    ];
    return candidates.some((candidate) => {
      if (!candidate) {
        return false;
      }
      return (
        aliases.has(candidate) ||
        aliases.has(candidate.toLowerCase()) ||
        aliases.has(identityTail(candidate))
      );
    });
  });

  const userCrNames = new Set<string>();
  if (matchedUser) {
    addIdentity(aliases, matchedUser.metadata.name);
    addIdentity(aliases, matchedUser.spec?.username);
    addIdentity(aliases, matchedUser.status?.username);
    addIdentity(aliases, matchedUser.status?.entityId);
    addIdentity(aliases, matchedUser.status?.email);
    addIdentity(aliases, matchedUser.status?.displayName);
    (matchedUser.status?.groups ?? []).forEach((group) => addIdentity(aliases, group));
    userCrNames.add(matchedUser.metadata.name);
    if (matchedUser.spec?.username) {
      userCrNames.add(matchedUser.spec.username);
    }
    if (matchedUser.status?.username) {
      userCrNames.add(matchedUser.status.username);
    }
  }

  const groupNames: string[] = [...user.groups, ...(matchedUser?.status?.groups ?? [])];
  platformGroups.forEach((group) => {
    const memberMatch = (group.spec?.members ?? []).some((member) => {
      if (!member) {
        return false;
      }
      const tail = identityTail(member);
      return (
        userCrNames.has(member) ||
        aliases.has(member) ||
        aliases.has(member.toLowerCase()) ||
        aliases.has(tail) ||
        aliases.has(tail.toLowerCase())
      );
    });
    const nameMatch = [
      group.metadata.name,
      group.spec?.groupName,
      group.status?.starvaultGroupId,
    ].some((candidate) => {
      if (!candidate) {
        return false;
      }
      const tail = identityTail(candidate);
      return (
        aliases.has(candidate) ||
        aliases.has(candidate.toLowerCase()) ||
        aliases.has(tail) ||
        aliases.has(tail.toLowerCase())
      );
    });
    if (!memberMatch && !nameMatch) {
      return;
    }
    addIdentity(aliases, group.metadata.name);
    addIdentity(aliases, group.spec?.groupName);
    addIdentity(aliases, group.status?.starvaultGroupId);
    groupNames.push(group.metadata.name);
    if (group.spec?.groupName) {
      groupNames.push(group.spec.groupName);
    }
  });

  const displayName =
    matchedUser?.status?.username ||
    matchedUser?.spec?.username ||
    matchedUser?.metadata.name ||
    user.username;

  return {
    ...user,
    username: displayName,
    email: user.email ?? matchedUser?.status?.email,
    groups: unique(groupNames),
    aliases: [...aliases],
  };
};

const userIdentities = (user: AuthUser): Set<string> => {
  const bucket = new Set<string>();
  addIdentity(bucket, user.sub);
  addIdentity(bucket, user.username);
  addIdentity(bucket, user.email);
  user.groups.forEach((group) => addIdentity(bucket, group));
  (user.aliases ?? []).forEach((alias) => addIdentity(bucket, alias));
  return bucket;
};

const subjectMatchesUser = (subject: PlatformBindingSubject, user: AuthUser): boolean => {
  if (subject.kind === 'ServiceAccount') {
    return false;
  }
  const identities = userIdentities(user);
  const values = [subject.name, subject.identity].filter(
    (value): value is string => typeof value === 'string' && value.trim() !== '',
  );
  return values.some((value) => {
    const tail = identityTail(value);
    return (
      identities.has(value) ||
      identities.has(value.toLowerCase()) ||
      identities.has(tail) ||
      identities.has(tail.toLowerCase())
    );
  });
};

export const bindingMatchesUser = (
  binding: PlatformRoleBindingKind,
  user: AuthUser,
): boolean => {
  if (binding.spec.subjects.some((subject) => subjectMatchesUser(subject, user))) {
    return true;
  }
  return (binding.status?.resolvedSubjects ?? []).some((subject) =>
    subjectMatchesUser(subject, user),
  );
};

const selectorHas = (role: PlatformRoleKind, label: string): boolean =>
  (role.spec?.kubernetes?.clusterRoleSelectors ?? []).some(
    (selector) => selector.matchLabels?.[label] === 'true',
  );

export type KubernetesAccessLevel = 'admin' | 'developer' | 'viewer' | 'none';

export const KUBERNETES_ACCESS_PRESETS: Record<
  Exclude<KubernetesAccessLevel, 'none'>,
  { title: string; persona?: 'admin'; selectors: string[] }
> = {
  admin: {
    title: 'Admin',
    persona: 'admin',
    selectors: [CONTRIBUTOR_AGGREGATE_LABEL, ADMIN_AGGREGATE_LABEL],
  },
  developer: {
    title: 'Developer',
    selectors: [CONTRIBUTOR_AGGREGATE_LABEL],
  },
  viewer: {
    title: 'Viewer',
    selectors: [VIEWER_AGGREGATE_LABEL],
  },
};

export const roleGrantsAdmin = (role: PlatformRoleKind): boolean =>
  role.metadata.labels?.[CONSOLE_PERSONA_LABEL] === 'admin' ||
  selectorHas(role, ADMIN_AGGREGATE_LABEL);

export const roleGrantsContributor = (role: PlatformRoleKind): boolean =>
  !roleGrantsAdmin(role) &&
  (role.metadata.name === 'nova-ai-contributor' ||
    role.metadata.name === 'nova-ai-developer' ||
    selectorHas(role, CONTRIBUTOR_AGGREGATE_LABEL));

export const roleGrantsViewer = (role: PlatformRoleKind): boolean =>
  !roleGrantsAdmin(role) &&
  !roleGrantsContributor(role) &&
  (role.metadata.name === 'nova-ai-viewer' || selectorHas(role, VIEWER_AGGREGATE_LABEL));

export const consoleRoleFromPlatformRole = (role: PlatformRoleKind): ConsoleRole => {
  if (roleGrantsAdmin(role)) {
    return 'admin';
  }
  if (roleGrantsContributor(role)) {
    return 'contributor';
  }
  if (roleGrantsViewer(role)) {
    return 'viewer';
  }
  return 'none';
};

export const kubernetesAccessFromRole = (role: PlatformRoleKind): KubernetesAccessLevel => {
  if (roleGrantsAdmin(role)) {
    return 'admin';
  }
  if (roleGrantsContributor(role)) {
    return 'developer';
  }
  if (roleGrantsViewer(role)) {
    return 'viewer';
  }
  return 'none';
};

export const servicesFromRole = (role: PlatformRoleKind): string[] => {
  const labels = role.metadata.labels ?? {};
  const fromEnabled = Object.entries(labels).flatMap(([key, value]) => {
    if (value !== 'true') {
      return [];
    }
    const match = key.match(CONSOLE_SERVICE_ENABLED);
    return match?.[1] ? [match[1]] : [];
  });
  const legacy = labels[CONSOLE_SERVICE_LABEL];
  const fromLegacy = legacy && !legacy.includes(',') ? [legacy] : [];
  const named = unique([...fromEnabled, ...fromLegacy]);
  if (named.length > 0) {
    return named;
  }
  const applications = role.spec?.oidc?.applications ?? [];
  return unique(
    applications
      .filter((application) => application.startsWith(OIDC_AUTH_PREFIX))
      .map((application) => application.slice(OIDC_AUTH_PREFIX.length)),
  );
};

const emptyProjectAccess = (): ProjectAccess => ({
  role: 'none',
  canView: false,
  canEdit: false,
  canManageRbac: false,
  services: [],
});

const projectAccessFrom = (role: ConsoleRole, services: string[]): ProjectAccess => ({
  role,
  canView: role !== 'none',
  canEdit: role === 'contributor' || role === 'admin',
  canManageRbac: role === 'admin',
  services: unique(services),
});

export const bootstrapAccess = (username?: string): PlatformAccess => {
  const services = [...CONSOLE_NAV_SERVICE_TITLES, PIPELINES_SERVICE];
  const project = projectAccessFrom('admin', services);
  return {
    source: 'bootstrap',
    consoleRole: 'admin',
    canCreateProjects: true,
    username,
    services,
    visibleProjects: [],
    forProject: () => project,
    canViewProject: () => true,
  };
};

export const emptyAccess = (source: PlatformAccess['source'], username?: string): PlatformAccess => ({
  source,
  consoleRole: 'none',
  canCreateProjects: false,
  username,
  services: [],
  visibleProjects: [],
  forProject: () => emptyProjectAccess(),
  canViewProject: () => false,
});

export type AccessInput = {
  user: AuthUser;
  roles: PlatformRoleKind[];
  bindings: PlatformRoleBindingKind[];
};

/**
 * UI admin vs contributor vs viewer comes from kubernetes aggregation plus
 * `nova-ai.io/console-persona: admin`. Extra sidebar and project tabs come from
 * nova-ai.io/<tab>-enabled: "true" (for example nova-ai.io/experiments-enabled),
 * and kubernetes.target still decides which namespaces are listed.
 */
export const computePlatformAccess = (input: AccessInput): PlatformAccess => {
  const rolesByName = new Map(input.roles.map((role) => [role.metadata.name, role]));
  let consoleRole: ConsoleRole = 'none';
  const clusterServices: string[] = [];
  const projectRoles = new Map<string, ConsoleRole>();
  const projectServices = new Map<string, string[]>();
  const visibleProjects = new Set<string>();
  let seesAllProjects = false;

  for (const binding of input.bindings) {
    if (!bindingMatchesUser(binding, input.user)) {
      continue;
    }
    const role = rolesByName.get(binding.spec.platformRoleRef.name);
    if (!role) {
      continue;
    }
    const boundRole = consoleRoleFromPlatformRole(role);
    const services = servicesFromRole(role);
    const target =
      binding.status?.appliedTarget?.target ?? binding.spec.kubernetes?.target ?? 'None';
    const namespaces =
      binding.status?.appliedTarget?.namespaces ?? binding.spec.kubernetes?.namespaces ?? [];

    consoleRole = maxRole(consoleRole, boundRole === 'none' ? 'contributor' : boundRole);

    if (target === 'Namespaces') {
      namespaces.forEach((namespace) => {
        visibleProjects.add(namespace);
        projectRoles.set(namespace, maxRole(projectRoles.get(namespace) ?? 'none', boundRole));
        projectServices.set(
          namespace,
          unique([...(projectServices.get(namespace) ?? []), ...services]),
        );
      });
      continue;
    }

    clusterServices.push(...services);
  }

  if (consoleRole === 'admin') {
    seesAllProjects = true;
  }

  const grantedServices = unique([
    ...clusterServices,
    ...[...projectServices.values()].flat(),
  ]);

  return {
    source: 'oidc',
    consoleRole,
    canCreateProjects: consoleRole === 'admin',
    username: input.user.username,
    services: grantedServices,
    visibleProjects: [...visibleProjects].toSorted(),
    forProject: (projectName: string) => {
      const role = maxRole(
        seesAllProjects ? consoleRole : 'none',
        projectRoles.get(projectName) ?? 'none',
      );
      const canSee = seesAllProjects || visibleProjects.has(projectName) || role !== 'none';
      if (!canSee) {
        return emptyProjectAccess();
      }
      const services = unique([
        ...clusterServices,
        ...(projectServices.get(projectName) ?? []),
      ]);
      const effective: ConsoleRole = role === 'none' ? 'contributor' : role;
      return projectAccessFrom(effective, services);
    },
    canViewProject: (projectName: string) =>
      seesAllProjects || visibleProjects.has(projectName),
  };
};

export const normalizeConsoleService = (service: string): string =>
  service.trim().toLowerCase().replace(/\s+/g, '-');

const SERVICE_ALIASES: Record<string, string> = {
  mlflow: 'experiments',
  experiment: 'experiments',
  workbenches: 'workbench',
  notebook: 'workbench',
  notebooks: 'workbench',
  deployment: 'deployments',
  models: 'deployments',
  pipeline: 'pipelines',
};

export const canonicalConsoleService = (service: string): string => {
  const normalized = normalizeConsoleService(service);
  return SERVICE_ALIASES[normalized] ?? normalized;
};

export const hasProjectService = (access: ProjectAccess, service: string): boolean =>
  access.services.some((item) => canonicalConsoleService(item) === canonicalConsoleService(service));

export const hasConsoleService = (access: PlatformAccess, service: string): boolean =>
  access.services.some((item) => canonicalConsoleService(item) === canonicalConsoleService(service));
