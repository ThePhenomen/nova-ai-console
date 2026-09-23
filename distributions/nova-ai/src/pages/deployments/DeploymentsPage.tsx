import React from 'react';
import {
  Alert,
  Bullseye,
  Button,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  EmptyState,
  EmptyStateActions,
  EmptyStateBody,
  EmptyStateFooter,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  Tab,
  Tabs,
  TabTitleText,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubesIcon } from '@patternfly/react-icons';
import { ActionsColumn, Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { hasProjectService } from '../../auth/access';
import { usePlatformAccess } from '../../auth/usePlatformAccess';
import { K8sApiError } from '../../cluster/k8sClient';
import { listProjects } from '../projects/projectApi';
import { KIND_CATALOG, kindByName, type KindCatalog, type KServeResource } from './crdCatalog';
import { deleteKServeResource, listKServeResources } from './kserveApi';
import { readyStatus, resourceSummary, serviceUrl, storageUriOf } from './kserveHelpers';
import ResourceFormModal from './ResourceFormModal';

type DeploymentsPageProps = {
  projectName?: string;
};

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
  const [kind, setKind] = React.useState<KindCatalog>(() => kindByName('InferenceService'));
  const [items, setItems] = React.useState<KServeResource[]>([]);
  const [namespaces, setNamespaces] = React.useState<string[]>(projectName ? [projectName] : []);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<KServeResource | null>(null);
  const [viewTarget, setViewTarget] = React.useState<KServeResource | null>(null);
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
      if (kind.scope === 'Cluster') {
        setItems(
          (await listKServeResources(kind)).toSorted((left, right) =>
            left.metadata.name.localeCompare(right.metadata.name),
          ),
        );
        return;
      }
      const lists =
        projectName && scoped[0]
          ? [await listKServeResources(kind, scoped[0])]
          : await Promise.all(
              scoped.map(async (namespace) => {
                try {
                  return await listKServeResources(kind, namespace);
                } catch {
                  return [];
                }
              }),
            );
      setItems(
        lists.flat().toSorted((left, right) => left.metadata.name.localeCompare(right.metadata.name)),
      );
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : `Failed to load ${kind.title} resources.`);
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [access, kind, projectName]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const createNamespaces = namespaces.filter((namespace) => access.forProject(namespace).canEdit);
  const canCreate =
    kind.scope === 'Cluster' ? access.canCreateProjects : createNamespaces.length > 0;
  const defaultCreateNamespace = projectName ?? createNamespaces[0] ?? '';
  const canMutateResource = (item: KServeResource): boolean => {
    if (kind.scope === 'Cluster') {
      return access.canCreateProjects;
    }
    return access.forProject(item.metadata.namespace ?? '').canEdit;
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteKServeResource(kind, deleteTarget.metadata.name, deleteTarget.metadata.namespace);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to delete resource.');
    } finally {
      setIsDeleting(false);
    }
  };

  const summaryTitle =
    kind.kind === 'InferenceService' ? 'Predictor' : kind.kind === 'InferenceGraph' ? 'Graph' : 'Source';

  return (
    <PageSection>
      <Tabs
        activeKey={kind.kind}
        onSelect={(_event, tabKey) => {
          const next = KIND_CATALOG.find((item) => item.kind === String(tabKey));
          if (next) {
            setKind(next);
            setViewTarget(null);
            setEditTarget(null);
          }
        }}
        style={{ marginBottom: '1rem' }}
      >
        {KIND_CATALOG.map((item) => (
          <Tab key={item.kind} eventKey={item.kind} title={<TabTitleText>{item.title}</TabTitleText>} />
        ))}
      </Tabs>
      {error ? (
        <Alert variant="danger" isInline title={`Could not load ${kind.title}`} style={{ marginBottom: '1rem' }}>
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
              <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                Create {kind.title}
              </Button>
            </ToolbarItem>
          ) : null}
          <ToolbarItem>
            <Button variant="secondary" onClick={() => void load()} isDisabled={isLoading}>
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
      {!isLoading && items.length === 0 && !error ? (
        <EmptyState headingLevel="h2" titleText={`No ${kind.title} resources`} icon={CubesIcon}>
          <EmptyStateBody>
            Create a {kind.title} from fields or paste a raw YAML/JSON manifest.
          </EmptyStateBody>
          {canCreate ? (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                  Create {kind.title}
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          ) : null}
        </EmptyState>
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Table aria-label={kind.title} variant="compact">
          <Thead>
            <Tr>
              <Th>Name</Th>
              {kind.scope === 'Namespaced' && !projectName ? <Th>Project</Th> : null}
              <Th>{summaryTitle}</Th>
              <Th>Ready</Th>
              {kind.kind === 'LocalModelCache' ? <Th>Copies</Th> : <Th>URL</Th>}
              <Th>Created</Th>
              <Th screenReaderText="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => {
              const namespace = item.metadata.namespace ?? '';
              const ready = readyStatus(item);
              const url = serviceUrl(item);
              return (
                <Tr
                  key={`${kind.kind}/${namespace}/${item.metadata.name}`}
                  isClickable
                  onRowClick={() => setViewTarget(item)}
                >
                  <Td dataLabel="Name">{item.metadata.name}</Td>
                  {kind.scope === 'Namespaced' && !projectName ? (
                    <Td dataLabel="Project">{namespace || '—'}</Td>
                  ) : null}
                  <Td dataLabel={summaryTitle}>{resourceSummary(kind, item)}</Td>
                  <Td dataLabel="Ready">
                    <Label color={readyColor(ready)} isCompact>
                      {ready === 'True' ? 'Ready' : ready === 'False' ? 'Not ready' : 'Unknown'}
                    </Label>
                  </Td>
                  <Td dataLabel={kind.kind === 'LocalModelCache' ? 'Copies' : 'URL'}>
                    {kind.kind === 'LocalModelCache' ? (
                      `${item.status?.copies?.available ?? 0}/${item.status?.copies?.total ?? 0}`
                    ) : url ? (
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
                            setViewTarget(item);
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
      {isCreateOpen && (kind.scope === 'Cluster' || defaultCreateNamespace) ? (
        <ResourceFormModal
          kind={kind}
          namespace={defaultCreateNamespace}
          namespaces={createNamespaces}
          onClose={() => setIsCreateOpen(false)}
          onSaved={() => {
            setIsCreateOpen(false);
            void load();
          }}
        />
      ) : null}
      {editTarget ? (
        <ResourceFormModal
          kind={kind}
          namespace={editTarget.metadata.namespace ?? defaultCreateNamespace}
          resource={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void load();
          }}
        />
      ) : null}
      {viewTarget ? (
        <Modal isOpen variant="medium" onClose={() => setViewTarget(null)} aria-label={`${kind.title} details`}>
          <ModalHeader title={viewTarget.metadata.name} />
          <ModalBody>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Kind</DescriptionListTerm>
                <DescriptionListDescription>{kind.title}</DescriptionListDescription>
              </DescriptionListGroup>
              {viewTarget.metadata.namespace ? (
                <DescriptionListGroup>
                  <DescriptionListTerm>Project</DescriptionListTerm>
                  <DescriptionListDescription>{viewTarget.metadata.namespace}</DescriptionListDescription>
                </DescriptionListGroup>
              ) : null}
              <DescriptionListGroup>
                <DescriptionListTerm>{summaryTitle}</DescriptionListTerm>
                <DescriptionListDescription>
                  {kind.kind === 'InferenceService' ? storageUriOf(viewTarget) : resourceSummary(kind, viewTarget)}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Ready</DescriptionListTerm>
                <DescriptionListDescription>{readyStatus(viewTarget)}</DescriptionListDescription>
              </DescriptionListGroup>
              {kind.kind === 'LocalModelCache' ? (
                <DescriptionListGroup>
                  <DescriptionListTerm>Copies</DescriptionListTerm>
                  <DescriptionListDescription>
                    {`${viewTarget.status?.copies?.available ?? 0} available / ${viewTarget.status?.copies?.total ?? 0} total`}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              ) : (
                <DescriptionListGroup>
                  <DescriptionListTerm>URL</DescriptionListTerm>
                  <DescriptionListDescription>{serviceUrl(viewTarget) || '—'}</DescriptionListDescription>
                </DescriptionListGroup>
              )}
              <DescriptionListGroup>
                <DescriptionListTerm>Created</DescriptionListTerm>
                <DescriptionListDescription>
                  {formatCreated(viewTarget.metadata.creationTimestamp)}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
            {(viewTarget.status?.conditions ?? []).length > 0 ? (
              <Table aria-label="Conditions" variant="compact" style={{ marginTop: '1rem' }}>
                <Thead>
                  <Tr>
                    <Th>Type</Th>
                    <Th>Status</Th>
                    <Th>Reason</Th>
                    <Th>Message</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {(viewTarget.status?.conditions ?? []).map((condition) => (
                    <Tr key={`${condition.type}-${condition.lastTransitionTime ?? ''}`}>
                      <Td dataLabel="Type">{condition.type ?? '—'}</Td>
                      <Td dataLabel="Status">{condition.status ?? '—'}</Td>
                      <Td dataLabel="Reason">{condition.reason ?? '—'}</Td>
                      <Td dataLabel="Message">{condition.message ?? '—'}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            ) : null}
          </ModalBody>
          <ModalFooter>
            {canMutateResource(viewTarget) ? (
              <Button
                variant="primary"
                onClick={() => {
                  setEditTarget(viewTarget);
                  setViewTarget(null);
                }}
              >
                Edit
              </Button>
            ) : null}
            <Button variant="link" onClick={() => setViewTarget(null)}>
              Close
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
      {deleteTarget ? (
        <Modal isOpen variant="small" onClose={() => setDeleteTarget(null)} aria-label={`Delete ${kind.title}`}>
          <ModalHeader title={`Delete ${kind.title}`} />
          <ModalBody>
            Delete {kind.title} {deleteTarget.metadata.name}
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
