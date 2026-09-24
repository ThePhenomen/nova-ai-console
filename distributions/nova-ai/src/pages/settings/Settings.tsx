import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import KServeSettings from './kserve/KServeSettings';
import ResourceDetails from './kserve/ResourceDetails';

const Settings: React.FC = () => (
  <Routes>
    <Route index element={<Navigate to="kserve" replace />} />
    <Route path="kserve" element={<Navigate to="cluster-serving-runtimes" replace />} />
    <Route path="kserve/:tab/:namespace/:name" element={<ResourceDetails />} />
    <Route path="kserve/:tab/:name" element={<ResourceDetails />} />
    <Route path="kserve/:tab" element={<KServeSettings />} />
  </Routes>
);

export default Settings;
