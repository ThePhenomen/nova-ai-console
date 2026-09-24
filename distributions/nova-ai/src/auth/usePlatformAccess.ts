import * as React from 'react';
import { K8sApiError } from '../cluster/k8sClient';
import { useClusterConnection } from '../cluster/useClusterConnection';
import {
  bootstrapAccess,
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
      const [roles, bindings, platformUsers, platformGroups] = await Promise.all([
        listPlatformRoles(),
        listPlatformRoleBindings(),
        listPlatformUsers().catch((): [] => []),
        listPlatformGroups().catch((): [] => []),
      ]);
      const latest = getPlatformAccessSnapshot();
      if (latest.cacheKey !== cacheKey) {
        return;
      }
      const user = enrichUserFromPlatformDirectory(session.user, platformUsers, platformGroups);
      setPlatformAccessSnapshot({
        access: computePlatformAccess({ user, roles, bindings }),
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
      resetPlatformAccess(bootstrapAccess());
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
