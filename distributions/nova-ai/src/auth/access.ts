import type {
  AuthUser,
  ConsolePersona,
  PlatformAccess,
  PlatformBindingSubject,
  PlatformGroupKind,
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
  services: unique(services),
});

export const bootstrapAccess = (username?: string): PlatformAccess => {
  const project = projectAccessFrom('admin', []);
  return {
    source: 'bootstrap',
    clusterPersona: 'admin',
    canCreateProjects: true,
    username,
    services: [],
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
 * WHO is a User CR and/or a Group CR. The signed-in OIDC subject (StarVault
 * entity id in `sub`) is resolved to a User CR, then to Groups via
 * `Group.spec.members`, `User.status.groups`, and the token `groups` claim.
 * A binding matches if any subject User/Group name or resolved identity
 * equals one of those aliases.
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
    services: grantedServices,
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
  access.services.includes(service);

export const hasConsoleService = (access: PlatformAccess, service: string): boolean =>
  access.services.includes(service);
