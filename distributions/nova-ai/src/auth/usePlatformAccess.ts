import * as React from 'react';
import { K8sApiError } from '../cluster/k8sClient';
import { useClusterConnection } from '../cluster/useClusterConnection';
import {
  computePlatformAccess,
  emptyAccess,
  enrichUserFromPlatformDirectory,
} from './access';
import {
  getPlatformAccessSnapshot,
  platformAccessCacheKey,
  resetPlatformAccess,
  setPlatformAccessSnapshot,
  subscribePlatformAccess,
} from './platformAccessStore';
import {
  listPlatformGroups,
  listPlatformRoleBindings,
  listPlatformRoles,
  listPlatformUsers,
  listClusterRoles,
} from './platformApi';
import type { AuthSession } from './types';
import { useAuthSession } from './useAuthSession';

export type PlatformAccessState = {
  access: ReturnType<typeof getPlatformAccessSnapshot>['access'];
  error: string | null;
  isLoading: boolean;
};

let inflight: Promise<void> | null = null;
let inflightKey: string | null = null;

const loadMembershipGroups = async (idToken?: string): Promise<string[]> => {
  if (!idToken) {
    return [];
  }
  try {
    const response = await fetch('/k8s-membership', {
      headers: { Accept: 'application/json', 'X-Nova-Id-Token': idToken },
      cache: 'no-store',
    });
    if (!response.ok) {
      return [];
    }
    const payload: unknown = await response.json();
    const groups =
      typeof payload === 'object' && payload !== null && Array.isArray((payload as { groups?: unknown }).groups)
        ? (payload as { groups: unknown[] }).groups
        : [];
    return groups.filter((group): group is string => typeof group === 'string' && group.trim() !== '');
  } catch {
    return [];
  }
};

const loadPlatformAccess = async (session: AuthSession, cacheKey: string): Promise<void> => {
  const current = getPlatformAccessSnapshot();
  if (current.loaded && current.cacheKey === cacheKey && !current.isLoading) {
    return;
  }
  if (inflight && inflightKey === cacheKey) {
    await inflight;
    return;
  }

  inflightKey = cacheKey;
  inflight = (async () => {
    setPlatformAccessSnapshot({
      isLoading: !(current.loaded && current.cacheKey === cacheKey),
      error: null,
      cacheKey,
    });
    try {
      const [roles, bindings, platformUsers, platformGroups, clusterRoles] = await Promise.all([
        listPlatformRoles(),
        listPlatformRoleBindings(),
        listPlatformUsers().catch((): [] => []),
        listPlatformGroups().catch((): [] => []),
        listClusterRoles().catch((): [] => []),
      ]);
      const latest = getPlatformAccessSnapshot();
      if (latest.cacheKey !== cacheKey) {
        return;
      }
      const membershipGroups = await loadMembershipGroups(session.idToken || session.accessToken);
      const user = enrichUserFromPlatformDirectory(
        {
          ...session.user,
          groups: [...new Set([...session.user.groups, ...membershipGroups])],
        },
        platformUsers,
        platformGroups,
      );
      setPlatformAccessSnapshot({
        access: computePlatformAccess({ user, roles, bindings, clusterRoles }),
        error: null,
        isLoading: false,
        cacheKey,
        loaded: true,
      });
    } catch (err) {
      const latest = getPlatformAccessSnapshot();
      if (latest.cacheKey !== cacheKey) {
        return;
      }
      const message = err instanceof K8sApiError ? err.message : 'Failed to load platform roles.';
      setPlatformAccessSnapshot({
        access: emptyAccess(
          err instanceof K8sApiError && err.statusCode === 404 ? 'unavailable' : 'oidc',
          session.user.username,
        ),
        error: message,
        isLoading: false,
        cacheKey,
        loaded: true,
      });
    } finally {
      if (inflightKey === cacheKey) {
        inflight = null;
        inflightKey = null;
      }
    }
  })();

  await inflight;
};

export const usePlatformAccess = (): PlatformAccessState => {
  const [session] = useAuthSession();
  const connection = useClusterConnection();
  const snapshot = React.useSyncExternalStore(
    subscribePlatformAccess,
    getPlatformAccessSnapshot,
    getPlatformAccessSnapshot,
  );
  const cacheKey = platformAccessCacheKey(session?.user.sub ?? null, Boolean(connection));

  React.useEffect(() => {
    if (!session) {
      resetPlatformAccess(emptyAccess('oidc'));
      return;
    }
    if (!connection) {
      resetPlatformAccess(emptyAccess('oidc', session.user.username));
      return;
    }
    void loadPlatformAccess(session, cacheKey ?? `oidc:${session.user.sub}`);
  }, [cacheKey, connection, session]);

  return { access: snapshot.access, error: snapshot.error, isLoading: snapshot.isLoading };
};
