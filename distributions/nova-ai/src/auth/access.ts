import type {
  AuthUser,
  ConsolePersona,
  PlatformAccess,
  PlatformBindingSubject,
  PlatformRoleBindingKind,
  PlatformRoleKind,
  PlatformUserKind,
  ProjectAccess,
} from './types';

export const CONSOLE_SERVICE_LABEL = 'nova-ai.io/console-service';
export const CONSOLE_PERSONA_LABEL = 'nova-ai.io/console-persona';

export const CATALOG_PERSONA_ROLES: Record<string, ConsolePersona> = {
  'nova-ai-admin': 'admin',
  'nova-ai-developer': 'developer',
  'nova-ai-viewer': 'viewer',
};

const PERSONA_RANK: Record<ConsolePersona, number> = {
  none: 0,
  viewer: 1,
  developer: 2,
  admin: 3,
};

const OIDC_AUTH_PREFIX = 'oidc-auth-';

export const maxPersona = (left: ConsolePersona, right: ConsolePersona): ConsolePersona =>
  PERSONA_RANK[left] >= PERSONA_RANK[right] ? left : right;

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

export const enrichUserFromPlatformUsers = (
  user: AuthUser,
  platformUsers: PlatformUserKind[],
): AuthUser => {
  const aliases = new Set<string>(user.aliases ?? []);
  addIdentity(aliases, user.sub);
  addIdentity(aliases, user.username);
  addIdentity(aliases, user.email);
  user.groups.forEach((group) => addIdentity(aliases, group));

  const matched = platformUsers.find((platformUser) => {
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

  if (matched) {
    addIdentity(aliases, matched.metadata.name);
    addIdentity(aliases, matched.spec?.username);
    addIdentity(aliases, matched.status?.username);
    addIdentity(aliases, matched.status?.entityId);
    addIdentity(aliases, matched.status?.email);
    addIdentity(aliases, matched.status?.displayName);
    (matched.status?.groups ?? []).forEach((group) => addIdentity(aliases, group));
  }

  const displayName =
    matched?.status?.username ||
    matched?.spec?.username ||
    matched?.metadata.name ||
    user.username;

  return {
    ...user,
    username: displayName,
    email: user.email ?? matched?.status?.email,
    groups: unique([...user.groups, ...(matched?.status?.groups ?? [])]),
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
  const identities = userIdentities(user);
  const candidates = [subject.name, subject.identity, identityTail(subject.name)];
  if (subject.identity) {
    candidates.push(identityTail(subject.identity));
  }
  if (subject.kind === 'User' || subject.kind === 'Group' || !subject.kind) {
    return candidates.some(
      (candidate) =>
        Boolean(candidate) &&
        (identities.has(candidate) || identities.has(candidate.toLowerCase())),
    );
  }
  return false;
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

export const personaFromRole = (role: PlatformRoleKind): ConsolePersona | null => {
  const labeled = role.metadata.labels?.[CONSOLE_PERSONA_LABEL];
  if (labeled === 'admin' || labeled === 'developer' || labeled === 'viewer') {
    return labeled;
  }
  return CATALOG_PERSONA_ROLES[role.metadata.name] ?? null;
};

export const servicesFromRole = (role: PlatformRoleKind): string[] => {
  const labeled = role.metadata.labels?.[CONSOLE_SERVICE_LABEL];
  const fromLabel = labeled
    ? labeled
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '')
    : [];
  if (fromLabel.length > 0) {
    return unique(fromLabel);
  }
  if (personaFromRole(role)) {
    return [];
  }
  const applications = role.spec?.oidc?.applications ?? [];
  return unique(
    applications
      .filter((application) => application.startsWith(OIDC_AUTH_PREFIX))
      .map((application) => application.slice(OIDC_AUTH_PREFIX.length)),
  );
};

const emptyProjectAccess = (): ProjectAccess => ({
  persona: 'none',
  canView: false,
  canEdit: false,
  canManageRbac: false,
  services: [],
});

const projectAccessFrom = (persona: ConsolePersona, services: string[]): ProjectAccess => ({
  persona,
  canView: PERSONA_RANK[persona] >= PERSONA_RANK.viewer,
  canEdit: PERSONA_RANK[persona] >= PERSONA_RANK.developer,
  canManageRbac: persona === 'admin',
  services: persona === 'admin' ? unique(['*', ...services]) : unique(services),
});

export const bootstrapAccess = (username?: string): PlatformAccess => {
  const project = projectAccessFrom('admin', ['*']);
  return {
    source: 'bootstrap',
    clusterPersona: 'admin',
    canCreateProjects: true,
    username,
    services: ['*'],
    forProject: () => project,
    canViewProject: () => true,
  };
};

export const emptyAccess = (source: PlatformAccess['source'], username?: string): PlatformAccess => ({
  source,
  clusterPersona: 'none',
  canCreateProjects: false,
  username,
  services: [],
  forProject: () => emptyProjectAccess(),
  canViewProject: () => false,
});

export type AccessInput = {
  user: AuthUser;
  roles: PlatformRoleKind[];
  bindings: PlatformRoleBindingKind[];
};

/**
 * Console authorization follows nova-auth-operator: PlatformRole is WHAT,
 * PlatformRoleBinding is WHO and WHERE (`kubernetes.target`).
 *
 * Personas come from catalog roles (`nova-ai-admin|developer`) or
 * `nova-ai.io/console-persona`. Only objects labeled `nova-ai-console` are
 * used. Cluster and None targets apply cluster-wide; Namespaces targets are
 * per project. Per-project service tabs come from a role labeled
 * `nova-ai.io/console-service=<id>` (or `oidc-auth-<id>` on a non-persona
 * role) bound with `target: Namespaces`.
 */
export const computePlatformAccess = (input: AccessInput): PlatformAccess => {
  const rolesByName = new Map(input.roles.map((role) => [role.metadata.name, role]));
  let clusterPersona: ConsolePersona = 'none';
  const clusterServices: string[] = [];
  const projectPersonas = new Map<string, ConsolePersona>();
  const projectServices = new Map<string, string[]>();
  const visibleProjects = new Set<string>();

  for (const binding of input.bindings) {
    if (!bindingMatchesUser(binding, input.user)) {
      continue;
    }
    const role = rolesByName.get(binding.spec.platformRoleRef.name);
    if (!role) {
      continue;
    }
    const persona = personaFromRole(role);
    const services = servicesFromRole(role);
    const target =
      binding.status?.appliedTarget?.target ?? binding.spec.kubernetes?.target ?? 'None';
    const namespaces =
      binding.status?.appliedTarget?.namespaces ?? binding.spec.kubernetes?.namespaces ?? [];

    if (target === 'Namespaces') {
      namespaces.forEach((namespace) => {
        visibleProjects.add(namespace);
        if (persona) {
          projectPersonas.set(
            namespace,
            maxPersona(projectPersonas.get(namespace) ?? 'none', persona),
          );
        }
        projectServices.set(
          namespace,
          unique([...(projectServices.get(namespace) ?? []), ...services]),
        );
      });
      continue;
    }

    if (persona) {
      clusterPersona = maxPersona(clusterPersona, persona);
    }
    clusterServices.push(...services);
  }

  const seesAllProjects = PERSONA_RANK[clusterPersona] >= PERSONA_RANK.viewer;

  const grantedServices = unique([
    ...clusterServices,
    ...[...projectServices.values()].flat(),
  ]);

  return {
    source: 'oidc',
    clusterPersona,
    canCreateProjects: clusterPersona === 'admin',
    username: input.user.username,
    services: clusterPersona === 'admin' ? unique(['*', ...grantedServices]) : grantedServices,
    forProject: (projectName: string) => {
      const persona = maxPersona(clusterPersona, projectPersonas.get(projectName) ?? 'none');
      if (persona === 'none' && !seesAllProjects && !visibleProjects.has(projectName)) {
        return emptyProjectAccess();
      }
      const services = unique([
        ...clusterServices,
        ...(projectServices.get(projectName) ?? []),
      ]);
      if (persona === 'none') {
        if (services.length === 0) {
          return emptyProjectAccess();
        }
        return {
          persona: 'viewer',
          canView: true,
          canEdit: false,
          canManageRbac: false,
          services,
        };
      }
      return projectAccessFrom(persona, services);
    },
    canViewProject: (projectName: string) => {
      if (seesAllProjects) {
        return true;
      }
      const persona = maxPersona(clusterPersona, projectPersonas.get(projectName) ?? 'none');
      return persona !== 'none' || visibleProjects.has(projectName);
    },
  };
};

export const hasProjectService = (access: ProjectAccess, service: string): boolean =>
  access.persona === 'admin' || access.services.includes('*') || access.services.includes(service);

export const hasConsoleService = (access: PlatformAccess, service: string): boolean =>
  access.source === 'bootstrap' ||
  access.clusterPersona === 'admin' ||
  access.services.includes('*') ||
  access.services.includes(service);
