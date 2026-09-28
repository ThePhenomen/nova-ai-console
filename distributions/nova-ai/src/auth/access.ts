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
  RbacClusterRole,
} from './types';

export const CONSOLE_SERVICE_LABEL = 'nova-ai.io/console-service';
export const CONSOLE_SERVICE_ENABLED = /^nova-ai\.io\/(.+)-enabled$/;
export const CONSOLE_PERSONA_LABEL = 'nova-ai.io/console-persona';
export const CONSOLE_OIDC_APPLICATION = 'nova-ai-console';
export const OIDC_APPLICATION_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Console login stays first. Extra names are project OIDC clients. */
export const oidcApplicationsWithConsole = (applications: string[]): string[] => {
  const extras = [
    ...new Set(
      applications
        .map((value) => value.trim())
        .filter((value) => value !== '' && value !== CONSOLE_OIDC_APPLICATION),
    ),
  ];
  return [CONSOLE_OIDC_APPLICATION, ...extras];
};
export const ADMIN_AGGREGATE_LABEL = 'nova-ai.io/aggregate-to-admin';
export const CONTRIBUTOR_AGGREGATE_LABEL = 'nova-ai.io/aggregate-to-developer';
export const COMPONENT_AGGREGATE_LABEL = 'nova-ai.io/aggregate-to-component';

const COMPONENT_INSTANCE = /^nova-ai-(mlflow|airflow|jupyterhub)\.(.+)$/i;

/** nova-ai-jupyterhub.team-a → team-a. The OIDC client is nova-ai-jupyterhub-team-a. */
export const componentInstanceNamespace = (roleName: string): string | undefined => {
  const namespace = roleName.trim().match(COMPONENT_INSTANCE)?.[2]?.trim();
  return namespace || undefined;
};

export const componentOidcApplication = (roleName: string): string =>
  roleName.trim().toLowerCase().replace(/\./g, '-');

export const bindingAppliesToProject = (
  binding: PlatformRoleBindingKind,
  projectName: string,
): boolean => {
  const target = binding.status?.appliedTarget?.target ?? binding.spec.kubernetes?.target ?? 'None';
  const namespaces =
    binding.status?.appliedTarget?.namespaces ?? binding.spec.kubernetes?.namespaces ?? [];
  if (target === 'Cluster' || (target === 'Namespaces' && namespaces.includes(projectName))) {
    return true;
  }
  return componentInstanceNamespace(binding.spec.platformRoleRef.name)?.toLowerCase() ===
    projectName.toLowerCase();
};

const ROLE_RANK: Record<ConsoleRole, number> = {
  none: 0,
  contributor: 1,
  admin: 2,
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

export type KubernetesAccessLevel = 'admin' | 'developer' | 'none';

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
};

export const roleGrantsAdmin = (role: PlatformRoleKind): boolean =>
  role.metadata.labels?.[CONSOLE_PERSONA_LABEL] === 'admin' ||
  selectorHas(role, ADMIN_AGGREGATE_LABEL);

export const roleGrantsContributor = (role: PlatformRoleKind): boolean =>
  !roleGrantsAdmin(role) &&
  (role.metadata.name === 'nova-ai-contributor' ||
    role.metadata.name === 'nova-ai-developer' ||
    selectorHas(role, CONTRIBUTOR_AGGREGATE_LABEL));

export const consoleRoleFromPlatformRole = (role: PlatformRoleKind): ConsoleRole => {
  if (roleGrantsAdmin(role)) {
    return 'admin';
  }
  if (roleGrantsContributor(role)) {
    return 'contributor';
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
  return 'none';
};

/** One role per project OIDC client. The level is the bound group name. */
export const roleIsOidcClient = (role: PlatformRoleKind): boolean =>
  kubernetesAccessFromRole(role) === 'none' &&
  (selectorHas(role, COMPONENT_AGGREGATE_LABEL) ||
    componentInstanceNamespace(role.metadata.name) !== undefined);

export const normalizeConsoleService = (service: string): string =>
  service.trim().toLowerCase().replace(/\s+/g, '-');

const SERVICE_ALIASES: Record<string, string> = {
  mlflow: 'experiments',
  experiment: 'experiments',
  workbenches: 'workbench',
  notebook: 'workbench',
  notebooks: 'workbench',
  jupyterhub: 'workbench',
  kserve: 'deployments',
  deployment: 'deployments',
  models: 'deployments',
  pipeline: 'pipelines',
  airflow: 'pipelines',
};

export const canonicalConsoleService = (service: string): string => {
  const normalized = normalizeConsoleService(service);
  return SERVICE_ALIASES[normalized] ?? normalized;
};

/** Tabs whose visibility comes from OIDC groups, not PlatformRole labels. */
const GROUP_GATED_SERVICES = new Set(['experiments', 'workbench', 'pipelines', 'deployments']);

const isGroupGatedService = (service: string): boolean =>
  GROUP_GATED_SERVICES.has(canonicalConsoleService(service));

const COMPONENT_GROUP =
  /^nova-ai-(mlflow|airflow|jupyterhub)\.(.+)\.(admins|developers|viewers)$/i;

const COMPONENT_SERVICE: Record<string, string> = {
  mlflow: 'experiments',
  airflow: 'pipelines',
  jupyterhub: 'workbench',
};

/**
 * nova-ai-mlflow|airflow.<namespace>.admins|developers|viewers → that project's tab.
 * nova-ai-jupyterhub.<namespace>.admins|developers → Workbench. viewers does not open it.
 * Deployments is not a group: it follows ClusterRole rules on serving.kserve.io.
 * The level is the last segment so a namespace may contain dots.
 */
export const componentServicesByNamespace = (groups: string[]): Map<string, string[]> => {
  const byNamespace = new Map<string, string[]>();
  groups.forEach((group) => {
    const match = identityTail(group).trim().match(COMPONENT_GROUP);
    if (!match) {
      return;
    }
    const product = match[1].toLowerCase();
    const level = match[3].toLowerCase();
    if (product === 'jupyterhub' && level === 'viewers') {
      return;
    }
    const service = COMPONENT_SERVICE[product];
    const namespace = match[2].toLowerCase();
    if (!service || namespace === '') {
      return;
    }
    byNamespace.set(namespace, unique([...(byNamespace.get(namespace) ?? []), service]));
  });
  return byNamespace;
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
  const named = unique([...fromEnabled, ...fromLegacy]).filter(
    (service) => !isGroupGatedService(service),
  );
  if (named.length > 0 || fromEnabled.length > 0 || fromLegacy.length > 0) {
    return named;
  }
  const applications = role.spec?.oidc?.applications ?? [];
  return unique(
    applications
      .filter((application) => application.startsWith(OIDC_AUTH_PREFIX))
      .map((application) => application.slice(OIDC_AUTH_PREFIX.length)),
  ).filter((service) => !isGroupGatedService(service));
};

const emptyProjectAccess = (): ProjectAccess => ({
  role: 'none',
  canView: false,
  canEdit: false,
  canEditDeployments: false,
  canManageRbac: false,
  services: [],
});

const projectAccessFrom = (
  role: ConsoleRole,
  services: string[],
  canEditDeployments = false,
  canManageRbac = role === 'admin',
): ProjectAccess => ({
  role,
  canView: role !== 'none' || services.length > 0,
  canEdit: role === 'contributor' || role === 'admin',
  canEditDeployments,
  canManageRbac,
  services: unique(services),
});

export const bootstrapAccess = (username?: string): PlatformAccess => {
  const services = [...CONSOLE_NAV_SERVICE_TITLES, PIPELINES_SERVICE];
  const project = projectAccessFrom('admin', services, true);
  return {
    source: 'bootstrap',
    consoleRole: 'admin',
    canCreateProjects: true,
    canEditKserveCluster: true,
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
  canEditKserveCluster: false,
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
  clusterRoles?: RbacClusterRole[];
};

const KSERVE_API_GROUP = 'serving.kserve.io';
const KSERVE_CLUSTER_RESOURCES = new Set([
  'clusterservingruntimes',
  'clusterstoragecontainers',
  'localmodelnodegroups',
  'localmodelcaches',
]);
const READ_VERBS = new Set(['*', 'get', 'list', 'watch']);
const WRITE_VERBS = new Set(['*', 'create', 'update', 'patch', 'delete']);
const CONSOLE_AUTH_API_GROUP = 'auth.nova-platform.io';
const CONSOLE_RBAC_RESOURCES = ['platformroles', 'platformrolebindings'];

type KserveGrant = { read: boolean; writeNamespaced: boolean; writeCluster: boolean };

const emptyKserveGrant = (): KserveGrant => ({
  read: false,
  writeNamespaced: false,
  writeCluster: false,
});

const kserveGrantFromRules = (
  rules: RbacClusterRole['rules'],
  scope: 'cluster' | 'namespace',
): KserveGrant => {
  const grant = emptyKserveGrant();
  (rules ?? []).forEach((rule) => {
    const groups = rule.apiGroups ?? [];
    if (!groups.some((group) => group === '*' || group === KSERVE_API_GROUP)) {
      return;
    }
    const canRead = (rule.verbs ?? []).some((verb) => READ_VERBS.has(verb));
    const canWrite = (rule.verbs ?? []).some((verb) => WRITE_VERBS.has(verb));
    (rule.resources ?? []).forEach((resource) => {
      const namespaced = resource === '*' || !KSERVE_CLUSTER_RESOURCES.has(resource);
      const clusterScoped = resource === '*' || KSERVE_CLUSTER_RESOURCES.has(resource);
      if (namespaced && canRead) {
        grant.read = true;
      }
      if (namespaced && canWrite) {
        grant.writeNamespaced = true;
      }
      if (scope === 'cluster' && clusterScoped && canWrite) {
        grant.writeCluster = true;
      }
    });
  });
  return grant;
};

const kserveGrantForRole = (
  role: PlatformRoleKind,
  clusterRoles: RbacClusterRole[],
  scope: 'cluster' | 'namespace',
): KserveGrant => {
  const selectors = role.spec?.kubernetes?.clusterRoleSelectors ?? [];
  return clusterRoles.reduce((grant, clusterRole) => {
    const labels = clusterRole.metadata?.labels ?? {};
    const matches = selectors.some((selector) =>
      Object.entries(selector.matchLabels ?? {}).every(([key, value]) => labels[key] === value),
    );
    if (!matches) {
      return grant;
    }
    const next = kserveGrantFromRules(clusterRole.rules, scope);
    return {
      read: grant.read || next.read,
      writeNamespaced: grant.writeNamespaced || next.writeNamespaced,
      writeCluster: grant.writeCluster || next.writeCluster,
    };
  }, emptyKserveGrant());
};

type ConsoleGrant = {
  listNamespaces: boolean;
  createNamespaces: boolean;
  manageRbac: boolean;
};

const emptyConsoleGrant = (): ConsoleGrant => ({
  listNamespaces: false,
  createNamespaces: false,
  manageRbac: false,
});

const resourceCovers = (resources: string[], names: string[]): boolean =>
  resources.some(
    (resource) => resource === '*' || names.some((name) => resource === name || resource.startsWith(`${name}/`)),
  );

const consoleGrantFromRules = (rules: RbacClusterRole['rules']): ConsoleGrant => {
  const grant = emptyConsoleGrant();
  (rules ?? []).forEach((rule) => {
    const verbs = rule.verbs ?? [];
    const canWrite = verbs.some((verb) => WRITE_VERBS.has(verb));
    const canList = verbs.some((verb) => verb === '*' || verb === 'list');
    const resources = rule.resources ?? [];
    const groups = rule.apiGroups ?? [];
    const core = groups.some((group) => group === '*' || group === '');
    const authApi = groups.some((group) => group === '*' || group === CONSOLE_AUTH_API_GROUP);
    if (core && resourceCovers(resources, ['namespaces'])) {
      if (canList) {
        grant.listNamespaces = true;
      }
      if (canWrite) {
        grant.createNamespaces = true;
      }
    }
    if (authApi && canWrite && resourceCovers(resources, CONSOLE_RBAC_RESOURCES)) {
      grant.manageRbac = true;
    }
  });
  return grant;
};

const consoleGrantForRole = (role: PlatformRoleKind, clusterRoles: RbacClusterRole[]): ConsoleGrant => {
  const selectors = role.spec?.kubernetes?.clusterRoleSelectors ?? [];
  return clusterRoles.reduce((grant, clusterRole) => {
    const labels = clusterRole.metadata?.labels ?? {};
    const matches = selectors.some((selector) =>
      Object.entries(selector.matchLabels ?? {}).every(([key, value]) => labels[key] === value),
    );
    if (!matches) {
      return grant;
    }
    const next = consoleGrantFromRules(clusterRole.rules);
    return {
      listNamespaces: grant.listNamespaces || next.listNamespaces,
      createNamespaces: grant.createNamespaces || next.createNamespaces,
      manageRbac: grant.manageRbac || next.manageRbac,
    };
  }, emptyConsoleGrant());
};

/**
 * Console admin comes from ClusterRole rules, scoped by the binding target:
 * list/create on namespaces and write on platformroles and platformrolebindings.
 * target Cluster applies that to every project. target Namespaces limits role
 * management to the listed projects and does not open project creation.
 * Experiments, Workbench and Pipelines come from OIDC groups
 * nova-ai-mlflow|airflow.<namespace>.admins|developers|viewers and
 * nova-ai-jupyterhub.<namespace>.admins|developers.
 * Deployments comes from ClusterRole rules on serving.kserve.io, scoped the same way.
 */
export const computePlatformAccess = (input: AccessInput): PlatformAccess => {
  const rolesByName = new Map(input.roles.map((role) => [role.metadata.name, role]));
  const clusterRoles = input.clusterRoles ?? [];
  let consoleRole: ConsoleRole = 'none';
  const clusterServices: string[] = [];
  const projectRoles = new Map<string, ConsoleRole>();
  const projectServices = new Map<string, string[]>();
  const deploymentWriters = new Set<string>();
  const visibleProjects = new Set<string>();
  let seesAllProjects = false;
  let canCreateProjects = false;
  let clusterManageRbac = false;
  const projectRbacWriters = new Set<string>();
  let clusterDeploymentRead = false;
  let clusterDeploymentWrite = false;
  let canEditKserveCluster = false;
  const componentServices = componentServicesByNamespace(input.user.groups);

  for (const binding of input.bindings) {
    if (!bindingMatchesUser(binding, input.user)) {
      continue;
    }
    const role = rolesByName.get(binding.spec.platformRoleRef.name);
    if (!role) {
      continue;
    }
    const services = servicesFromRole(role);
    const presetRole = consoleRoleFromPlatformRole(role);
    const target =
      binding.status?.appliedTarget?.target ?? binding.spec.kubernetes?.target ?? 'None';
    const namespaces =
      binding.status?.appliedTarget?.namespaces ?? binding.spec.kubernetes?.namespaces ?? [];
    const namespacedKserve = kserveGrantForRole(role, clusterRoles, 'namespace');
    const clusterKserve = kserveGrantForRole(role, clusterRoles, 'cluster');
    const consoleGrant = consoleGrantForRole(role, clusterRoles);
    const kserve = target === 'Cluster' ? clusterKserve : namespacedKserve;
    if (clusterKserve.writeCluster) {
      canEditKserveCluster = true;
    }

    const namespaceRole: ConsoleRole = consoleGrant.manageRbac ? 'admin' : presetRole;

    if (target === 'Namespaces') {
      namespaces.forEach((namespace) => {
        visibleProjects.add(namespace);
        projectRoles.set(namespace, maxRole(projectRoles.get(namespace) ?? 'none', namespaceRole));
        if (consoleGrant.manageRbac) {
          projectRbacWriters.add(namespace.toLowerCase());
        }
        const namespaceServices = [...services];
        if (kserve.read) {
          namespaceServices.push('deployments');
        }
        if (kserve.writeNamespaced) {
          deploymentWriters.add(namespace.toLowerCase());
        }
        projectServices.set(
          namespace,
          unique([...(projectServices.get(namespace) ?? []), ...namespaceServices]),
        );
      });
      continue;
    }

    if (target === 'Cluster') {
      if (consoleGrant.listNamespaces) {
        seesAllProjects = true;
      }
      if (consoleGrant.createNamespaces) {
        canCreateProjects = true;
      }
      if (consoleGrant.manageRbac) {
        clusterManageRbac = true;
      }
      const clusterConsoleRole: ConsoleRole =
        consoleGrant.manageRbac || consoleGrant.createNamespaces ? 'admin' : presetRole;
      if (clusterConsoleRole !== 'none') {
        consoleRole = maxRole(consoleRole, clusterConsoleRole);
      }
      if (kserve.read) {
        clusterDeploymentRead = true;
      }
      if (kserve.writeNamespaced) {
        clusterDeploymentWrite = true;
      }
    }

    clusterServices.push(...services);
  }

  componentServices.forEach((_services, namespace) => {
    visibleProjects.add(namespace);
  });

  const visibleLower = new Set([...visibleProjects].map((namespace) => namespace.toLowerCase()));
  const componentServicesInView = [...componentServices.entries()].flatMap(([namespace, services]) =>
    seesAllProjects || visibleLower.has(namespace) ? services : [],
  );
  const deploymentService = clusterDeploymentRead || deploymentWriters.size > 0 ||
    [...projectServices.values()].some((services) => services.includes('deployments'))
    ? ['deployments']
    : [];

  const grantedServices = unique([
    ...clusterServices,
    ...[...projectServices.values()].flat(),
    ...componentServicesInView,
    ...deploymentService,
  ]);

  return {
    source: 'oidc',
    consoleRole,
    canCreateProjects,
    canEditKserveCluster,
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
        ...(clusterDeploymentRead ? ['deployments'] : []),
        ...(projectServices.get(projectName) ?? []),
        ...(componentServices.get(projectName.toLowerCase()) ?? []),
      ]);
      const canEditDeployments =
        clusterDeploymentWrite || deploymentWriters.has(projectName.toLowerCase());
      const canManageRbac =
        clusterManageRbac || projectRbacWriters.has(projectName.toLowerCase());
      return projectAccessFrom(role, services, canEditDeployments, canManageRbac);
    },
    canViewProject: (projectName: string) =>
      seesAllProjects || visibleProjects.has(projectName),
  };
};

export const hasProjectService = (access: ProjectAccess, service: string): boolean =>
  access.services.some((item) => canonicalConsoleService(item) === canonicalConsoleService(service));

export const hasConsoleService = (access: PlatformAccess, service: string): boolean =>
  access.services.some((item) => canonicalConsoleService(item) === canonicalConsoleService(service));
