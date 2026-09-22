import React from 'react';
import { Navigate } from 'react-router-dom';

const RedirectToProjects: React.FC = () => <Navigate to="/projects" replace />;

export default RedirectToProjects;
