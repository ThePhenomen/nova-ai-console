import type {
  AuthUser,
  ConsolePersona,
  PlatformAccess,
  PlatformBindingSubject,
  PlatformRoleBindingKind,
  PlatformRoleKind,
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

const subjectMatchesUser = (subject: PlatformBindingSubject, user: AuthUser): boolean => {
  if (subject.kind === 'User') {
    return (
      subject.name === user.username ||
      subject.name === user.sub ||
      subject.name === user.email ||
      subject.name === `oidc:user:${user.username}`
    );
  }
  if (subject.kind === 'Group') {
    return (
      user.groups.includes(subject.name) ||
      user.groups.includes(`oidc:group:${subject.name}`)
    );
  }
  return false;
};

const resolvedMatchesUser = (
  subject: PlatformBindingSubject & { identity?: string },
  user: AuthUser,
): boolean => {
  if (subjectMatchesUser(subject, user)) {
    return true;
  }
  if (!subject.identity) {
    return false;
  }
  const tail = identityTail(subject.identity);
  return (
    tail === user.username ||
    tail === user.sub ||
    tail === user.email ||
    user.groups.includes(tail) ||
    user.groups.includes(subject.identity) ||
    subject.identity.endsWith(`:${user.username}`)
  );
};

export const bindingMatchesUser = (
  binding: PlatformRoleBindingKind,
  user: AuthUser,
): boolean => {
  if (binding.spec.subjects.some((subject) => subjectMatchesUser(subject, user))) {
    return true;
  }
  return (binding.status?.resolvedSubjects ?? []).some((subject) =>
    resolvedMatchesUser(subject, user),
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
    forProject: () => project,
    canViewProject: () => true,
  };
};

export const emptyAccess = (source: PlatformAccess['source'], username?: string): PlatformAccess => ({
  source,
  clusterPersona: 'none',
  canCreateProjects: false,
  username,
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

  input.bindings.forEach((binding) => {
    if (!bindingMatchesUser(binding, input.user)) {
      return;
    }
    const role = rolesByName.get(binding.spec.platformRoleRef.name);
    if (!role) {
      return;
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
      return;
    }

    if (persona) {
      clusterPersona = maxPersona(clusterPersona, persona);
    }
    clusterServices.push(...services);
  });

  const seesAllProjects = PERSONA_RANK[clusterPersona] >= PERSONA_RANK.viewer;

  return {
    source: 'oidc',
    clusterPersona,
    canCreateProjects: clusterPersona === 'admin',
    username: input.user.username,
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
