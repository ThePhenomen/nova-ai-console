import React from 'react';
import PlaceholderTab from '../projects/tabs/PlaceholderTab';
import { CONSOLE_NAV_SERVICES } from '../../consoleServices';

const Workbench: React.FC = () => {
  const service = CONSOLE_NAV_SERVICES.find((item) => item.id === 'workbench');
  return <PlaceholderTab title={service?.title ?? 'Workbench'} description={service?.description ?? ''} />;
};

export default Workbench;
