import React from 'react';
import { Route, Routes } from 'react-router-dom';
import DeploymentDetails from './DeploymentDetails';
import DeploymentsPage from './DeploymentsPage';

const Deployments: React.FC = () => (
  <Routes>
    <Route index element={<DeploymentsPage />} />
    <Route path=":namespace/:kind/:name" element={<DeploymentDetails />} />
  </Routes>
);

export default Deployments;
