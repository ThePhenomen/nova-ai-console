import * as React from 'react';
import { getClusterConnection, subscribeClusterConnection } from './connectionStore';
import type { ClusterConnection } from './types';

export const useClusterConnection = (): ClusterConnection | null =>
  React.useSyncExternalStore(subscribeClusterConnection, getClusterConnection, getClusterConnection);
