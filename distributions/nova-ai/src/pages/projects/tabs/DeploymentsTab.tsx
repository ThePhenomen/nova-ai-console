import React from 'react';
import DeploymentsPage from '../../deployments/DeploymentsPage';

type DeploymentsTabProps = {
  projectName: string;
};

const DeploymentsTab: React.FC<DeploymentsTabProps> = ({ projectName }) => (
  <DeploymentsPage projectName={projectName} />
);

export default DeploymentsTab;
