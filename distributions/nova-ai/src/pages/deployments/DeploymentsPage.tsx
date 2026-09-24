import React from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Content,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Flex,
  FlexItem,
  FormSelect,
  FormSelectOption,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubesIcon, FolderIcon } from '@patternfly/react-icons';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { hasProjectService } from '../../auth/access';
import { usePlatformAccess } from '../../auth/usePlatformAccess';
import { K8sApiError } from '../../cluster/k8sClient';
import { listProjects } from '../projects/projectApi';
import {
  KIND_CATALOG,
  deploymentDetailsPath,
  kindByName,
  type KindCatalog,
  type KServeResource,
} from './crdCatalog';
import { deleteKServeResource, listKServeResources } from './kserveApi';
import { predictorType, readyStatus, serviceUrl } from './kserveHelpers';
import ResourceFormModal from './ResourceFormModal';

type DeploymentsPageProps = {
  projectName?: string;
};

const catalogOf = (item: KServeResource): KindCatalog => kindByName(item.kind ?? 'InferenceService');

const readyColor = (status: ReturnType<typeof readyStatus>): 'green' | 'red' | 'grey' => {
  if (status === 'True') {
    return 'green';
  }
  if (status === 'False') {
    return 'red';
  }
  return 'grey';
};

const formatCreated = (value?: string): string => {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const DeploymentsPage: React.FC<DeploymentsPageProps> = ({ projectName }) => {
  const { access } = usePlatformAccess();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [items, setItems] = React.useState<KServeResource[]>([]);
  const [namespaces, setNamespaces] = React.useState<string[]>(projectName ? [projectName] : []);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<KServeResource | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<KServeResource | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const scoped = projectName
        ? [projectName]
        : (await listProjects())
            .map((project) => project.name)
            .filter(
              (name) =>
                access.canViewProject(name) && hasProjectService(access.forProject(name), 'Deployments'),
            );
      setNamespaces(scoped);
      const lists = await Promise.all(
        KIND_CATALOG.flatMap((kind) =>
          scoped.map(async (namespace) => {
            try {
              const listed = await listKServeResources(kind, namespace);
              return listed.map((item) => ({
                ...item,
                kind: item.kind ?? kind.kind,
                apiVersion: item.apiVersion ?? kind.apiVersion,
              }));
            } catch {
              return [];
            }
          }),
        ),
      );
      setItems(
        lists.flat().toSorted((left, right) => left.metadata.name.localeCompare(right.metadata.name)),
      );
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to load deployments.');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [access, projectName]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const requestedProject = searchParams.get('project') ?? '';
  const selectedProject =
    projectName ||
    (requestedProject && namespaces.includes(requestedProject) ? requestedProject : '');
  const displayedItems = selectedProject
    ? items.filter((item) => item.metadata.namespace === selectedProject)
    : items;
  const showProjectColumn = !selectedProject;
  const createNamespaces = namespaces.filter((namespace) => access.forProject(namespace).canEdit);
  const canCreate = selectedProject
    ? access.forProject(selectedProject).canEdit
    : access.consoleRole === 'admin' ||
      access.consoleRole === 'contributor' ||
      createNamespaces.length > 0;
  const defaultCreateNamespace = selectedProject || createNamespaces[0] || '';
  const openDetails = (item: KServeResource) => {
    const namespace = item.metadata.namespace ?? '';
    navigate(
      deploymentDetailsPath(namespace, catalogOf(item).kind, item.metadata.name, Boolean(projectName)),
    );
  };
  const canMutateResource = (item: KServeResource): boolean =>
    access.forProject(item.metadata.namespace ?? '').canEdit;

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteKServeResource(
        catalogOf(deleteTarget),
        deleteTarget.metadata.name,
        deleteTarget.metadata.namespace,
      );
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to delete resource.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PageSection>
      {!projectName ? (
        <>
          <Content component="p" style={{ marginBottom: '0.75rem' }}>
            View and manage the health and performance of deployed models.
          </Content>
          <Flex
            alignItems={{ default: 'alignItemsCenter' }}
            spaceItems={{ default: 'spaceItemsMd' }}
            flexWrap={{ default: 'wrap' }}
            style={{ marginBottom: '1rem' }}
          >
            <FlexItem>
              <span style={{ fontWeight: 600 }}>Project</span>
            </FlexItem>
            <FlexItem>
              <FormSelect
                id="deployments-project-filter"
                value={selectedProject}
                onChange={(_event, value) => {
                  if (value) {
                    setSearchParams({ project: value });
                    return;
                  }
                  setSearchParams({});
                }}
                aria-label="Project"
                style={{ width: '14rem' }}
              >
                <FormSelectOption value="" label="All projects" />
                {namespaces.map((namespace) => (
                  <FormSelectOption key={namespace} value={namespace} label={namespace} />
                ))}
              </FormSelect>
            </FlexItem>
            {selectedProject ? (
              <FlexItem>
                <span>Go to </span>
                <Link
                  to={`/projects/${encodeURIComponent(selectedProject)}/overview`}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    fontWeight: 600,
                  }}
                >
                  <FolderIcon />
                  {selectedProject}
                </Link>
              </FlexItem>
            ) : null}
          </Flex>
        </>
      ) : null}
      {error ? (
        <Alert variant="danger" isInline title="Could not load deployments" style={{ marginBottom: '1rem' }}>
          {error}
        </Alert>
      ) : null}
      {actionError ? (
        <Alert variant="danger" isInline title="Could not update resource" style={{ marginBottom: '1rem' }}>
          {actionError}
        </Alert>
      ) : null}
      <Toolbar>
        <ToolbarContent>
          {canCreate ? (
            <ToolbarItem>
              <Button
                variant="primary"
                onClick={() => setIsCreateOpen(true)}
                isDisabled={!defaultCreateNamespace}
                style={{
                  backgroundColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
                  color: 'var(--pf-t--global--text--color--on-brand, #fff)',
                }}
              >
                Create Deployment
              </Button>
            </ToolbarItem>
          ) : null}
          <ToolbarItem>
            <Button
              variant="secondary"
              onClick={() => void load()}
              isDisabled={isLoading}
              style={{
                borderColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
                color: 'var(--pf-t--global--color--brand--default, #0066cc)',
              }}
            >
              Refresh
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isLoading ? (
        <Bullseye>
          <Spinner />
        </Bullseye>
      ) : null}
      {!isLoading && displayedItems.length === 0 && !error ? (
        <EmptyState headingLevel="h2" titleText="No deployments" icon={CubesIcon}>
          <EmptyStateBody>
            {selectedProject
              ? `No InferenceService or InferenceGraph resources in ${selectedProject}.`
              : 'Create an InferenceService or InferenceGraph from a short form, or paste a YAML manifest.'}
          </EmptyStateBody>
          {canCreate ? (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button
                  variant="primary"
                  onClick={() => setIsCreateOpen(true)}
                  style={{
                    backgroundColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
                    color: 'var(--pf-t--global--text--color--on-brand, #fff)',
                  }}
                >
                  Create Deployment
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          ) : null}
        </EmptyState>
      ) : null}
      {!isLoading && displayedItems.length > 0 ? (
        <Table aria-label="Deployments" variant="compact">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Kind</Th>
              {showProjectColumn ? <Th>Project</Th> : null}
              <Th>Model format</Th>
              <Th>Ready</Th>
              <Th>URL</Th>
              <Th>Created</Th>
              <Th screenReaderText="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {displayedItems.map((item) => {
              const kind = catalogOf(item);
              const namespace = item.metadata.namespace ?? '';
              const ready = readyStatus(item);
              const url = serviceUrl(item);
              return (
                <Tr
                  key={`${kind.kind}/${namespace}/${item.metadata.name}`}
                  isClickable
                  onRowClick={() => openDetails(item)}
                >
                  <Td dataLabel="Name">{item.metadata.name}</Td>
                  <Td dataLabel="Kind">{kind.title}</Td>
                  {showProjectColumn ? <Td dataLabel="Project">{namespace || '—'}</Td> : null}
                  <Td dataLabel="Model format">
                    {kind.kind === 'InferenceService' ? predictorType(item) : '—'}
                  </Td>
                  <Td dataLabel="Ready">
                    <Label color={readyColor(ready)} isCompact>
                      {ready === 'True' ? 'Ready' : ready === 'False' ? 'Not ready' : 'Unknown'}
                    </Label>
                  </Td>
                  <Td dataLabel="URL">
                    {url ? (
                      <a href={url} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                        {url}
                      </a>
                    ) : (
                      '—'
                    )}
                  </Td>
                  <Td dataLabel="Created">{formatCreated(item.metadata.creationTimestamp)}</Td>
                  <Td
                    isActionCell
                    onClick={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                  >
                    <ActionsColumn
                      items={[
                        {
                          title: 'View',
                          onClick: (event) => {
                            event?.stopPropagation();
                            openDetails(item);
                          },
                        },
                        {
                          title: 'Edit',
                          isDisabled: !canMutateResource(item),
                          onClick: (event) => {
                            event?.stopPropagation();
                            setEditTarget(item);
                          },
                        },
                        { isSeparator: true },
                        {
                          title: 'Delete',
                          isDisabled: !canMutateResource(item),
                          onClick: (event) => {
                            event?.stopPropagation();
                            setDeleteTarget(item);
                          },
                        },
                      ]}
                    />
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      ) : null}
      {isCreateOpen && defaultCreateNamespace ? (
        <ResourceFormModal
          kind={kindByName('InferenceService')}
          namespace={defaultCreateNamespace}
          namespaces={selectedProject ? [selectedProject] : createNamespaces}
          allowKindSwitch
          onClose={() => setIsCreateOpen(false)}
          onSaved={() => {
            setIsCreateOpen(false);
            void load();
          }}
        />
      ) : null}
      {editTarget ? (
        <ResourceFormModal
          kind={catalogOf(editTarget)}
          namespace={editTarget.metadata.namespace ?? defaultCreateNamespace}
          resource={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void load();
          }}
        />
      ) : null}
      {deleteTarget ? (
        <Modal isOpen variant="small" onClose={() => setDeleteTarget(null)} aria-label="Delete deployment">
          <ModalHeader title={`Delete ${catalogOf(deleteTarget).title}`} />
          <ModalBody>
            Delete {catalogOf(deleteTarget).title} {deleteTarget.metadata.name}
            {deleteTarget.metadata.namespace ? ` in ${deleteTarget.metadata.namespace}` : ''}? This
            cannot be undone.
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

export default DeploymentsPage;
