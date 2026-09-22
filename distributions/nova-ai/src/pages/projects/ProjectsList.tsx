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
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Pagination,
  SearchInput,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import {
  ActionsColumn,
  Table,
  Tbody,
  Td,
  Th,
  Thead,
  Tr,
  type ThProps,
} from '@patternfly/react-table';
import ClusterConnectionModal from '../../cluster/ClusterConnectionModal';
import { K8sApiError } from '../../cluster/k8sClient';
import { useClusterConnection } from '../../cluster/useClusterConnection';
import { useAuthSession } from '../../auth/useAuthSession';
import { usePlatformAccess } from '../../auth/usePlatformAccess';
import CreateProjectModal from './CreateProjectModal';
import { deleteProject, listProjects, type ProjectSummary } from './projectApi';

const PER_PAGE_OPTIONS = [
  { title: '10', value: 10 },
  { title: '20', value: 20 },
  { title: '50', value: 50 },
  { title: '100', value: 100 },
];

const formatQuota = (project: ProjectSummary): string => {
  const hard = project.quota?.status?.hard ?? project.quota?.spec?.hard;
  if (!hard || Object.keys(hard).length === 0) {
    return '—';
  }
  return Object.entries(hard)
    .map(([key, value]) => `${key}: ${value}`)
    .join(', ');
};

const formatCreated = (value?: string): string => {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString();
};

type SortColumn = 'name' | 'status' | 'created';

const SORT_COLUMNS: SortColumn[] = ['name', 'status', 'created'];

const compareProjects = (
  left: ProjectSummary,
  right: ProjectSummary,
  column: SortColumn,
  direction: 'asc' | 'desc',
): number => {
  const order = direction === 'asc' ? 1 : -1;
  if (column === 'status') {
    return left.phase.localeCompare(right.phase) * order;
  }
  if (column === 'created') {
    return (left.createdAt ?? '').localeCompare(right.createdAt ?? '') * order;
  }
  return left.name.localeCompare(right.name) * order;
};

const ProjectsList: React.FC = () => {
  const navigate = useNavigate();
  const [connection] = useClusterConnection();
  const [session] = useAuthSession();
  const { access, error: accessError, isLoading: isAccessLoading } = usePlatformAccess();
  const [projects, setProjects] = React.useState<ProjectSummary[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [isClusterOpen, setIsClusterOpen] = React.useState(false);
  const [editProject, setEditProject] = React.useState<ProjectSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<ProjectSummary | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [perPage, setPerPage] = React.useState(10);
  const [sortColumn, setSortColumn] = React.useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');

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

  const showCreate = access.canCreateProjects;
  const canManageRbac = access.consoleRole === 'admin';

  const filteredProjects = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects
      .filter((project) => access.canViewProject(project.name))
      .filter((project) => {
        if (!query) {
          return true;
        }
        return (
          project.name.toLowerCase().includes(query) ||
          project.description.toLowerCase().includes(query) ||
          project.phase.toLowerCase().includes(query)
        );
      })
      .toSorted((left, right) => compareProjects(left, right, sortColumn, sortDirection));
  }, [access, projects, search, sortColumn, sortDirection]);

  const pageCount = Math.max(1, Math.ceil(filteredProjects.length / perPage));
  const currentPage = Math.min(page, pageCount);
  const pagedProjects = filteredProjects.slice((currentPage - 1) * perPage, currentPage * perPage);

  const getSortParams = (column: SortColumn): ThProps['sort'] => ({
    sortBy: {
      index: SORT_COLUMNS.indexOf(sortColumn),
      direction: sortDirection,
    },
    onSort: (_event, index, direction) => {
      setSortColumn(SORT_COLUMNS[index] ?? 'name');
      setSortDirection(direction);
      setPage(1);
    },
    columnIndex: SORT_COLUMNS.indexOf(column),
  });

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteProject(deleteTarget.name);
      setDeleteTarget(null);
      await loadProjects();
    } catch (err) {
      setActionError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to delete project.');
    } finally {
      setIsDeleting(false);
    }
  };

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

  const pagination = (
    <Pagination
      itemCount={filteredProjects.length}
      page={currentPage}
      perPage={perPage}
      perPageOptions={PER_PAGE_OPTIONS}
      onSetPage={(_event, nextPage) => setPage(nextPage)}
      onPerPageSelect={(_event, nextPerPage) => {
        setPerPage(nextPerPage);
        setPage(1);
      }}
      isCompact
    />
  );

  return (
    <PageSection>
      {access.source === 'bootstrap' ? (
        <Alert variant="info" isInline title="Using kubeconfig credentials" style={{ marginBottom: '1rem' }}>
          Sign in with StarVault to apply PlatformRoleBindings. Until then the console treats this
          connection as cluster admin.
        </Alert>
      ) : null}
      {session && access.source === 'oidc' && access.consoleRole === 'none' && filteredProjects.length === 0 ? (
        <Alert variant="info" isInline title="No platform role assigned" style={{ marginBottom: '1rem' }}>
          Signed in as {access.username ?? session.user.username}
          {session.user.sub && session.user.sub !== (access.username ?? session.user.username)
            ? ` (entity ${session.user.sub})`
            : ''}
          . Bind this User CR, or a Group that lists it in spec.members, in a
          PlatformRoleBinding to nova-ai-admin or nova-ai-developer
          (kubernetes.target: Cluster for admin, Namespaces for a contributor project).
        </Alert>
      ) : null}
      {accessError ? (
        <Alert variant="warning" isInline title="Could not load platform roles" style={{ marginBottom: '1rem' }}>
          {accessError}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="danger" isInline title="Could not update project" style={{ marginBottom: '1rem' }}>
          {actionError}
        </Alert>
      ) : null}
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem variant="search-filter">
            <SearchInput
              aria-label="Search projects"
              placeholder="Filter by name"
              value={search}
              onChange={(_event, value) => {
                setSearch(value);
                setPage(1);
              }}
              onClear={() => {
                setSearch('');
                setPage(1);
              }}
            />
          </ToolbarItem>
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
          <ToolbarItem variant="pagination" align={{ default: 'alignEnd' }}>
            {pagination}
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
      {!isLoading && !isAccessLoading && filteredProjects.length === 0 && !error ? (
        <EmptyState headingLevel="h2" titleText="No projects" icon={CubesIcon}>
          <EmptyStateBody>
            {search.trim()
              ? 'No projects match the current filter.'
              : showCreate
                ? 'Create a project to get a namespace with resource quotas.'
                : 'No projects are visible for your PlatformRoleBinding.'}
          </EmptyStateBody>
          {showCreate && !search.trim() ? (
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
      {!isLoading && !isAccessLoading && filteredProjects.length > 0 ? (
        <>
          <Table aria-label="Projects" variant="compact">
            <Thead>
              <Tr>
                <Th sort={getSortParams('name')}>Name</Th>
                <Th>Description</Th>
                <Th sort={getSortParams('status')}>Status</Th>
                <Th>Resource quota</Th>
                <Th sort={getSortParams('created')}>Created</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {pagedProjects.map((project) => (
                <Tr
                  key={project.name}
                  isClickable
                  onRowClick={() => navigate(`/projects/${project.name}/overview`)}
                >
                  <Td dataLabel="Name">{project.name}</Td>
                  <Td dataLabel="Description">{project.description || '—'}</Td>
                  <Td dataLabel="Status">{project.phase}</Td>
                  <Td dataLabel="Resource quota">{formatQuota(project)}</Td>
                  <Td dataLabel="Created">{formatCreated(project.createdAt)}</Td>
                  <Td isActionCell>
                    {showCreate || canManageRbac ? (
                      <ActionsColumn
                        items={[
                          {
                            title: 'Edit project',
                            isDisabled: !showCreate,
                            onClick: (event) => {
                              event.stopPropagation();
                              setEditProject(project);
                            },
                          },
                          {
                            title: 'Edit permissions',
                            isDisabled: !canManageRbac,
                            onClick: (event) => {
                              event.stopPropagation();
                              navigate(`/projects/${project.name}/permissions`);
                            },
                          },
                          {
                            isSeparator: true,
                          },
                          {
                            title: 'Delete project',
                            isDisabled: !showCreate,
                            onClick: (event) => {
                              event.stopPropagation();
                              setDeleteTarget(project);
                            },
                          },
                        ]}
                      />
                    ) : null}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <Toolbar>
            <ToolbarContent>
              <ToolbarItem variant="pagination" align={{ default: 'alignEnd' }}>
                {pagination}
              </ToolbarItem>
            </ToolbarContent>
          </Toolbar>
        </>
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
      {editProject ? (
        <CreateProjectModal
          project={editProject}
          onClose={() => setEditProject(null)}
          onCreated={() => {
            setEditProject(null);
            void loadProjects();
          }}
        />
      ) : null}
      {deleteTarget ? (
        <Modal
          isOpen
          variant="small"
          onClose={() => setDeleteTarget(null)}
          aria-label="Delete project"
        >
          <ModalHeader title="Delete project" />
          <ModalBody>
            Delete project {deleteTarget.name}? This removes the Kubernetes namespace and cannot be
            undone.
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={() => void confirmDelete()} isLoading={isDeleting}>
              Delete
            </Button>
            <Button variant="link" onClick={() => setDeleteTarget(null)} isDisabled={isDeleting}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </PageSection>
  );
};

export default ProjectsList;
