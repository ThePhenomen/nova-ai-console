import React from 'react';
import { canI } from '../cluster/accessReview';
import { useAuthSession } from './useAuthSession';

export type ConsoleResourceAccess = {
  loaded: boolean;
  listNamespaces: boolean;
  createNamespaces: boolean;
  updateNamespaces: boolean;
  deleteNamespaces: boolean;
  manageRoles: boolean;
};

const empty = (loaded = false): ConsoleResourceAccess => ({
  loaded,
  listNamespaces: false,
  createNamespaces: false,
  updateNamespaces: false,
  deleteNamespaces: false,
  manageRoles: false,
});

const AUTH_API = 'auth.nova-platform.io';

let cacheKey: string | null = null;
let cached: ConsoleResourceAccess = empty();
let inflight: Promise<ConsoleResourceAccess> | null = null;
const listeners = new Set<() => void>();

const emit = (): void => {
  listeners.forEach((listener) => listener());
};

const loadAccess = async (): Promise<ConsoleResourceAccess> => {
  const [listNamespaces, createNamespaces, updateNamespaces, deleteNamespaces, updateRoles, updateBindings] =
    await Promise.all([
      canI('list', '', 'namespaces'),
      canI('create', '', 'namespaces'),
      canI('update', '', 'namespaces'),
      canI('delete', '', 'namespaces'),
      canI('update', AUTH_API, 'platformroles'),
      canI('update', AUTH_API, 'platformrolebindings'),
    ]);
  return {
    loaded: true,
    listNamespaces,
    createNamespaces,
    updateNamespaces,
    deleteNamespaces,
    manageRoles: updateRoles || updateBindings,
  };
};

const ensureAccess = (key: string): void => {
  if (cacheKey === key && cached.loaded) {
    return;
  }
  if (cacheKey === key && inflight) {
    return;
  }
  cacheKey = key;
  cached = empty();
  inflight = loadAccess()
    .then((next) => {
      if (cacheKey === key) {
        cached = next;
        inflight = null;
        emit();
      }
      return next;
    })
    .catch(() => {
      const next = empty(true);
      if (cacheKey === key) {
        cached = next;
        inflight = null;
        emit();
      }
      return next;
    });
};

export const useConsoleResourceAccess = (): ConsoleResourceAccess => {
  const [session] = useAuthSession();
  const key = session?.user.sub ?? 'anonymous';
  const [access, setAccess] = React.useState<ConsoleResourceAccess>(() =>
    cacheKey === key ? cached : empty(),
  );

  React.useEffect(() => {
    const onChange = (): void => {
      if (cacheKey === key) {
        setAccess(cached);
      }
    };
    listeners.add(onChange);
    ensureAccess(key);
    onChange();
    return () => {
      listeners.delete(onChange);
    };
  }, [key]);

  return access;
};
