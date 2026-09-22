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
import { Link, useNavigate, useParams } from 'react-router-dom';
import OverviewTab from './tabs/OverviewTab';
import PermissionsTab from './tabs/PermissionsTab';
import PlaceholderTab from './tabs/PlaceholderTab';
import RolesTab from './tabs/RolesTab';

export const PROJECT_TABS = [
  { id: 'overview', title: 'Overview' },
  { id: 'workbench', title: 'Workbench' },
  { id: 'pipelines', title: 'Pipelines' },
  { id: 'deployments', title: 'Deployments' },
  { id: 'roles', title: 'Roles' },
  { id: 'permissions', title: 'Permissions' },
] as const;

export type ProjectTabId = (typeof PROJECT_TABS)[number]['id'];

const isProjectTabId = (value: string | undefined): value is ProjectTabId =>
  PROJECT_TABS.some((tab) => tab.id === value);

const ProjectDetails: React.FC = () => {
  const { projectName, tab } = useParams<{ projectName: string; tab: string }>();
  const navigate = useNavigate();

  if (!projectName) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Missing project name" />
      </PageSection>
    );
  }

  const activeTab: ProjectTabId = isProjectTabId(tab) ? tab : 'overview';

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
          {PROJECT_TABS.map((item) => (
            <Tab
              key={item.id}
              eventKey={item.id}
              title={<TabTitleText>{item.title}</TabTitleText>}
            />
          ))}
        </Tabs>
      </PageSection>
      {activeTab === 'overview' ? <OverviewTab projectName={projectName} /> : null}
      {activeTab === 'workbench' ? (
        <PlaceholderTab title="Workbench" description="Workbenches in this project will appear here." />
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
