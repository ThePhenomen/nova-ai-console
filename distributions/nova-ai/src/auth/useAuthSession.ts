import * as React from 'react';
import { getAuthSession, setAuthSession, subscribeAuthSession } from './authSession';
import type { AuthSession } from './types';

export const useAuthSession = (): [AuthSession | null, (next: AuthSession | null) => void] => {
  const session = React.useSyncExternalStore(
    subscribeAuthSession,
    getAuthSession,
    getAuthSession,
  );
  return [session, setAuthSession];
};
