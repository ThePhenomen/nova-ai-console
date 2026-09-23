import React from 'react';
import PlaceholderTab from '../projects/tabs/PlaceholderTab';
import { CONSOLE_NAV_SERVICES } from '../../consoleServices';

const Experiments: React.FC = () => {
  const service = CONSOLE_NAV_SERVICES.find((item) => item.id === 'experiments');
  return (
    <PlaceholderTab title={service?.title ?? 'Experiments'} description={service?.description ?? ''} />
  );
};

export default Experiments;
