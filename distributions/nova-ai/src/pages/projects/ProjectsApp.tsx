import React from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import ProjectDetails from './ProjectDetails';
import ProjectsList from './ProjectsList';

const ProjectsApp: React.FC = () => (
  <Routes>
    <Route index element={<ProjectsList />} />
    <Route path=":projectName" element={<Navigate to="overview" replace />} />
    <Route path=":projectName/:tab" element={<ProjectDetails />} />
  </Routes>
);

export default ProjectsApp;
