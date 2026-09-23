import React from 'react';
import PlaceholderTab from '../projects/tabs/PlaceholderTab';
import { CONSOLE_NAV_SERVICES } from '../../consoleServices';

const Deployments: React.FC = () => {
  const service = CONSOLE_NAV_SERVICES.find((item) => item.id === 'deployments');
  return (
    <PlaceholderTab title={service?.title ?? 'Deployments'} description={service?.description ?? ''} />
  );
};

export default Deployments;
