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
  listPlatformGroups,
  listPlatformRoleBindings,
  listPlatformRoles,
  listPlatformUsers,
} from './platformApi';
import type { PlatformAccess } from './types';
import { useAuthSession } from './useAuthSession';

export type PlatformAccessState = {
  access: PlatformAccess;
  error: string | null;
  isLoading: boolean;
};

export const usePlatformAccess = (): PlatformAccessState => {
  const [session] = useAuthSession();
  const [connection] = useClusterConnection();
  const [access, setAccess] = React.useState<PlatformAccess>(() =>
    session ? emptyAccess('oidc', session.user.username) : bootstrapAccess(),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    if (!session) {
      setAccess(bootstrapAccess());
      setError(null);
      setIsLoading(false);
      return;
    }
    if (!connection) {
      setAccess(emptyAccess('oidc', session.user.username));
      setError(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [roles, bindings, platformUsers, platformGroups] = await Promise.all([
          listPlatformRoles(),
          listPlatformRoleBindings(),
          listPlatformUsers().catch((): [] => []),
          listPlatformGroups().catch((): [] => []),
        ]);
        if (!cancelled) {
          const user = enrichUserFromPlatformDirectory(session.user, platformUsers, platformGroups);
          setAccess(computePlatformAccess({ user, roles, bindings }));
        }
      } catch (err) {
        if (!cancelled) {
          const message =
            err instanceof K8sApiError ? err.message : 'Failed to load platform roles.';
          setError(message);
          setAccess(
            emptyAccess(
              err instanceof K8sApiError && err.statusCode === 404 ? 'unavailable' : 'oidc',
              session.user.username,
            ),
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [connection, session]);

  return { access, error, isLoading };
};
