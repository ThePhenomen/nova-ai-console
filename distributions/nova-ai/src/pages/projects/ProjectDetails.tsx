import React from 'react';
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Content,
  PageSection,
  Tab,
  Tabs,
  TabTitleText,
} from '@patternfly/react-core';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { hasProjectService } from '../../auth/access';
import { usePlatformAccess } from '../../auth/usePlatformAccess';
import { PIPELINES_SERVICE } from '../../consoleServices';
import OverviewTab from './tabs/OverviewTab';
import PermissionsTab from './tabs/PermissionsTab';
import PlaceholderTab from './tabs/PlaceholderTab';
import RolesTab from './tabs/RolesTab';

export const PROJECT_TABS = [
  { id: 'overview', title: 'Overview' },
  { id: 'workbench', title: 'Workbench', service: 'Workbench' },
  { id: 'experiments', title: 'Experiments', service: 'Experiments' },
  { id: 'pipelines', title: 'Pipelines', service: PIPELINES_SERVICE },
  { id: 'deployments', title: 'Deployments', service: 'Deployments' },
  { id: 'roles', title: 'Roles', adminOnly: true },
  { id: 'permissions', title: 'Permissions', adminOnly: true },
] as const;

export type ProjectTabId = (typeof PROJECT_TABS)[number]['id'];

const isProjectTabId = (value: string | undefined): value is ProjectTabId =>
  PROJECT_TABS.some((tab) => tab.id === value);

const ProjectDetails: React.FC = () => {
  const { projectName, tab } = useParams<{ projectName: string; tab: string }>();
  const navigate = useNavigate();
  const { access } = usePlatformAccess();

  if (!projectName) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Missing project name" />
      </PageSection>
    );
  }

  if (!access.canViewProject(projectName)) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Access denied">
          Your PlatformRoleBinding does not grant access to this project.
        </Alert>
      </PageSection>
    );
  }

  const projectAccess = access.forProject(projectName);
  const visibleTabs = PROJECT_TABS.filter((item) => {
    if ('adminOnly' in item && item.adminOnly) {
      return projectAccess.canManageRbac;
    }
    if ('service' in item && item.service) {
      return hasProjectService(projectAccess, item.service);
    }
    return projectAccess.canView;
  });
  const requestedTab: ProjectTabId = isProjectTabId(tab) ? tab : 'overview';
  const activeTab = visibleTabs.some((item) => item.id === requestedTab)
    ? requestedTab
    : 'overview';

  if (requestedTab !== activeTab) {
    return <Navigate to={`/projects/${projectName}/${activeTab}`} replace />;
  }

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <Breadcrumb>
          <BreadcrumbItem>
            <Link to="/projects">Projects</Link>
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{projectName}</BreadcrumbItem>
        </Breadcrumb>
        <Content component="h1">{projectName}</Content>
      </PageSection>
      <PageSection type="tabs" hasBodyWrapper={false}>
        <Tabs
          activeKey={activeTab}
          onSelect={(_event, tabKey) => {
            navigate(`/projects/${projectName}/${String(tabKey)}`);
          }}
        >
          {visibleTabs.map((item) => (
            <Tab
              key={item.id}
              eventKey={item.id}
              title={<TabTitleText>{item.title}</TabTitleText>}
            />
          ))}
        </Tabs>
      </PageSection>
      {activeTab === 'overview' ? (
        <OverviewTab projectName={projectName} canManageRbac={projectAccess.canManageRbac} />
      ) : null}
      {activeTab === 'workbench' ? (
        <PlaceholderTab title="Workbench" description="Workbenches in this project will appear here." />
      ) : null}
      {activeTab === 'experiments' ? (
        <PlaceholderTab
          title="Experiments"
          description="MLflow experiments in this project will appear here."
        />
      ) : null}
      {activeTab === 'pipelines' ? (
        <PlaceholderTab title="Pipelines" description="Pipelines in this project will appear here." />
      ) : null}
      {activeTab === 'deployments' ? (
        <PlaceholderTab
          title="Deployments"
          description="Model deployments in this project will appear here."
        />
      ) : null}
      {activeTab === 'roles' ? <RolesTab projectName={projectName} /> : null}
      {activeTab === 'permissions' ? <PermissionsTab projectName={projectName} /> : null}
    </>
  );
};

export default ProjectDetails;
