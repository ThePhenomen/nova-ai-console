import React from 'react';
import { Button, Label } from '@patternfly/react-core';
import { ServerIcon } from '@patternfly/react-icons';
import ClusterConnectionModal from './ClusterConnectionModal';
import { useClusterConnection } from './useClusterConnection';

const clusterHost = (apiServer: string): string => {
  try {
    return new URL(apiServer).host;
  } catch {
    return apiServer;
  }
};

const ClusterToolbarItem: React.FC = () => {
  const [connection] = useClusterConnection();
  const [isOpen, setIsOpen] = React.useState(false);
  const close = React.useCallback(() => setIsOpen(false), []);

  return (
    <>
      <Button
        variant="plain"
        icon={<ServerIcon />}
        onClick={() => setIsOpen(true)}
        aria-label="Cluster connection"
      >
        <Label color={connection ? 'green' : 'orange'} isCompact>
          {connection ? clusterHost(connection.apiServer) : 'Not connected'}
        </Label>
      </Button>
      {isOpen ? <ClusterConnectionModal onClose={close} /> : null}
    </>
  );
};

export default ClusterToolbarItem;
