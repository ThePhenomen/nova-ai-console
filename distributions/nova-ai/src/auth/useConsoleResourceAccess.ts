import React from 'react';
import { canI } from '../cluster/accessReview';

export type ConsoleResourceAccess = {
  loaded: boolean;
  listNamespaces: boolean;
  createNamespaces: boolean;
  updateNamespaces: boolean;
  deleteNamespaces: boolean;
  manageRoles: boolean;
};

const empty: ConsoleResourceAccess = {
  loaded: false,
  listNamespaces: false,
  createNamespaces: false,
  updateNamespaces: false,
  deleteNamespaces: false,
  manageRoles: false,
};

const AUTH_API = 'auth.nova-platform.io';

export const useConsoleResourceAccess = (): ConsoleResourceAccess => {
  const [access, setAccess] = React.useState<ConsoleResourceAccess>(empty);

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const [listNamespaces, createNamespaces, updateNamespaces, deleteNamespaces, updateRoles, updateBindings] =
        await Promise.all([
          canI('list', '', 'namespaces'),
          canI('create', '', 'namespaces'),
          canI('update', '', 'namespaces'),
          canI('delete', '', 'namespaces'),
          canI('update', AUTH_API, 'platformroles'),
          canI('update', AUTH_API, 'platformrolebindings'),
        ]);
      if (!cancelled) {
        setAccess({
          loaded: true,
          listNamespaces,
          createNamespaces,
          updateNamespaces,
          deleteNamespaces,
          manageRoles: updateRoles || updateBindings,
        });
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, []);

  return access;
};
