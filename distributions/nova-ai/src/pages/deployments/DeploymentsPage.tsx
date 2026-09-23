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

  const createNamespaces = namespaces.filter((namespace) => access.forProject(namespace).canEdit);
  const canCreate = createNamespaces.length > 0;
  const defaultCreateNamespace = projectName ?? createNamespaces[0] ?? '';
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
              <Button variant="primary" size="lg" onClick={() => setIsCreateOpen(true)}>
                Create Deployment
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
        <EmptyState headingLevel="h2" titleText="No deployments" icon={CubesIcon}>
          <EmptyStateBody>
            Create an InferenceService or InferenceGraph from a short form, or paste a raw YAML/JSON
            manifest.
          </EmptyStateBody>
          {canCreate ? (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" size="lg" onClick={() => setIsCreateOpen(true)}>
                  Create Deployment
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          ) : null}
        </EmptyState>
      ) : null}
      {!isLoading && items.length > 0 ? (
        <Table aria-label="Deployments" variant="compact">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Kind</Th>
              {!projectName ? <Th>Project</Th> : null}
              <Th>Summary</Th>
              <Th>Ready</Th>
              <Th>URL</Th>
              <Th>Created</Th>
              <Th screenReaderText="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => {
              const kind = catalogOf(item);
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
                  <Td dataLabel="Kind">{kind.title}</Td>
                  {!projectName ? <Td dataLabel="Project">{namespace || '—'}</Td> : null}
                  <Td dataLabel="Summary">{resourceSummary(kind, item)}</Td>
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
      {isCreateOpen && defaultCreateNamespace ? (
        <ResourceFormModal
          kind={kindByName('InferenceService')}
          namespace={defaultCreateNamespace}
          namespaces={createNamespaces}
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
      {viewTarget ? (
        <Modal isOpen variant="medium" onClose={() => setViewTarget(null)} aria-label="Deployment details">
          <ModalHeader title={viewTarget.metadata.name} />
          <ModalBody>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Kind</DescriptionListTerm>
                <DescriptionListDescription>{catalogOf(viewTarget).title}</DescriptionListDescription>
              </DescriptionListGroup>
              {viewTarget.metadata.namespace ? (
                <DescriptionListGroup>
                  <DescriptionListTerm>Project</DescriptionListTerm>
                  <DescriptionListDescription>{viewTarget.metadata.namespace}</DescriptionListDescription>
                </DescriptionListGroup>
              ) : null}
              <DescriptionListGroup>
                <DescriptionListTerm>
                  {catalogOf(viewTarget).kind === 'InferenceService' ? 'Storage URI' : 'Graph'}
                </DescriptionListTerm>
                <DescriptionListDescription>
                  {catalogOf(viewTarget).kind === 'InferenceService'
                    ? storageUriOf(viewTarget)
                    : resourceSummary(catalogOf(viewTarget), viewTarget)}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Ready</DescriptionListTerm>
                <DescriptionListDescription>{readyStatus(viewTarget)}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>URL</DescriptionListTerm>
                <DescriptionListDescription>{serviceUrl(viewTarget) || '—'}</DescriptionListDescription>
              </DescriptionListGroup>
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
