import * as React from 'react';
import { getOidcConfig, setOidcConfig, subscribeOidcConfig } from './oidcStore';
import type { OidcConfig } from './types';

export const useOidcConfig = (): [OidcConfig | null, (next: OidcConfig | null) => void] => {
  const config = React.useSyncExternalStore(subscribeOidcConfig, getOidcConfig, getOidcConfig);
  return [config, setOidcConfig];
};
