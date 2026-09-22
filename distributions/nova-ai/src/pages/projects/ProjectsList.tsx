import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  PageSection,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import ClusterConnectionModal from '../../cluster/ClusterConnectionModal';
import { K8sApiError } from '../../cluster/k8sClient';
import { useClusterConnection } from '../../cluster/useClusterConnection';
import { useAuthSession } from '../../auth/useAuthSession';
import { usePlatformAccess } from '../../auth/usePlatformAccess';
import CreateProjectModal from './CreateProjectModal';
import { listProjects, type ProjectSummary } from './projectApi';

const formatQuota = (project: ProjectSummary): string => {
  const hard = project.quota?.status?.hard ?? project.quota?.spec?.hard;
  if (!hard || Object.keys(hard).length === 0) {
    return '—';
  }
  return Object.entries(hard)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
};

const ProjectsList: React.FC = () => {
  const navigate = useNavigate();
  const [connection] = useClusterConnection();
  const [session] = useAuthSession();
  const { access, error: accessError, isLoading: isAccessLoading } = usePlatformAccess();
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isClusterOpen, setIsClusterOpen] = React.useState(false);

  const loadProjects = React.useCallback(async () => {
    if (!connection) {
      setProjects([]);
      setError(null);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setProjects(await listProjects());
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to load projects.');
      setProjects([]);
    } finally {
      setIsLoading(false);
    }
  }, [connection]);

  React.useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const visibleProjects = projects.filter((project) => access.canViewProject(project.name));
  const showCreate = access.canCreateProjects;

  if (!connection) {
    return (
      <PageSection>
        <EmptyState headingLevel="h2" titleText="Connect to a cluster" icon={CubesIcon}>
          <EmptyStateBody>
            Specify the Kubernetes API server URL and credentials to create and view projects.
          </EmptyStateBody>
          <EmptyStateFooter>
            <EmptyStateActions>
              <Button variant="primary" onClick={() => setIsClusterOpen(true)}>
                Connect to cluster
              </Button>
            </EmptyStateActions>
          </EmptyStateFooter>
        </EmptyState>
        {isClusterOpen ? <ClusterConnectionModal onClose={() => setIsClusterOpen(false)} /> : null}
      </PageSection>
    );
  }

  return (
    <PageSection>
      {access.source === 'bootstrap' ? (
        <Alert variant="info" isInline title="Using kubeconfig credentials" style={{ marginBottom: '1rem' }}>
          Sign in with StarVault to apply PlatformRoleBindings. Until then the console treats this
          connection as cluster admin.
        </Alert>
      ) : null}
      {session && access.source === 'oidc' && access.clusterPersona === 'none' && visibleProjects.length === 0 ? (
        <Alert variant="info" isInline title="No platform role assigned" style={{ marginBottom: '1rem' }}>
          Signed in as {session.user.username}, but no PlatformRoleBinding grants project access
          yet.
        </Alert>
      ) : null}
      {accessError ? (
        <Alert variant="warning" isInline title="Could not load platform roles" style={{ marginBottom: '1rem' }}>
          {accessError}
        </Alert>
      ) : null}
      <Toolbar>
        <ToolbarContent>
          {showCreate ? (
            <ToolbarItem>
              <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                Create project
              </Button>
            </ToolbarItem>
          ) : null}
          <ToolbarItem>
            <Button variant="secondary" onClick={() => void loadProjects()} isDisabled={isLoading}>
              Refresh
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {error ? (
        <Alert variant="danger" isInline title="Could not load projects">
          {error}
        </Alert>
      ) : null}
      {isLoading || isAccessLoading ? (
        <Bullseye>
          <Spinner />
        </Bullseye>
      ) : null}
      {!isLoading && !isAccessLoading && visibleProjects.length === 0 && !error ? (
        <EmptyState headingLevel="h2" titleText="No projects" icon={CubesIcon}>
          <EmptyStateBody>
            {showCreate
              ? 'Create a project to get a namespace with resource quotas.'
              : 'No projects are visible for your PlatformRoleBinding.'}
          </EmptyStateBody>
          {showCreate ? (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                  Create project
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          ) : null}
        </EmptyState>
      ) : null}
      {!isLoading && !isAccessLoading && visibleProjects.length > 0 ? (
        <Table aria-label="Projects" variant="compact">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Description</Th>
              <Th>Status</Th>
              <Th>Resource quota</Th>
            </Tr>
          </Thead>
          <Tbody>
            {visibleProjects.map((project) => (
              <Tr
                key={project.name}
                isClickable
                onRowClick={() => navigate(`/projects/${project.name}/overview`)}
              >
                <Td dataLabel="Name">{project.name}</Td>
                <Td dataLabel="Description">{project.description || '—'}</Td>
                <Td dataLabel="Status">{project.phase}</Td>
                <Td dataLabel="Resource quota">{formatQuota(project)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      ) : null}
      {isCreateOpen ? (
        <CreateProjectModal
          onClose={() => setIsCreateOpen(false)}
          onCreated={(name) => {
            setIsCreateOpen(false);
            navigate(`/projects/${name}/overview`);
          }}
        />
      ) : null}
    </PageSection>
  );
};

export default ProjectsList;
