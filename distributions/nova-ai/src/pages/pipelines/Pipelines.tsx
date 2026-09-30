import React from 'react';
import PlaceholderTab from '../projects/tabs/PlaceholderTab';
import { CONSOLE_NAV_SERVICES } from '../../consoleServices';

const Pipelines: React.FC = () => {
  const service = CONSOLE_NAV_SERVICES.find((item) => item.id === 'pipelines');
  return (
    <PlaceholderTab title={service?.title ?? 'Pipelines'} description={service?.description ?? ''} />
  );
};

export default Pipelines;
