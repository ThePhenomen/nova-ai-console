import * as React from 'react';
import {
  getClusterConnection,
  setClusterConnection,
  subscribeClusterConnection,
} from './connectionStore';
import type { ClusterConnection } from './types';

export const useClusterConnection = (): [
  ClusterConnection | null,
  (next: ClusterConnection | null) => void,
] => {
  const connection = React.useSyncExternalStore(
    subscribeClusterConnection,
    getClusterConnection,
    getClusterConnection,
  );
  return [connection, setClusterConnection];
};
