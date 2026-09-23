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
import InferenceServiceFormModal from './InferenceServiceFormModal';
import { deleteInferenceService, listInferenceServices } from './kserveApi';
import { predictorType, readyStatus, serviceUrl, storageUriOf } from './kserveHelpers';
import type { InferenceServiceKind } from './types';

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
  const [services, setServices] = React.useState<InferenceServiceKind[]>([]);
  const [namespaces, setNamespaces] = React.useState<string[]>(projectName ? [projectName] : []);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<InferenceServiceKind | null>(null);
  const [viewTarget, setViewTarget] = React.useState<InferenceServiceKind | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<InferenceServiceKind | null>(null);
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
      const lists = projectName
        ? [await listInferenceServices(projectName)]
        : await Promise.all(
            scoped.map(async (namespace) => {
              try {
                return await listInferenceServices(namespace);
              } catch {
                return [];
              }
            }),
          );
      setServices(
        lists.flat().toSorted((left, right) => left.metadata.name.localeCompare(right.metadata.name)),
      );
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to load InferenceServices.');
      setServices([]);
    } finally {
      setIsLoading(false);
    }
  }, [access, projectName]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const canCreate = namespaces.some((namespace) => access.forProject(namespace).canEdit);
  const createNamespaces = namespaces.filter((namespace) => access.forProject(namespace).canEdit);
  const defaultCreateNamespace = projectName ?? createNamespaces[0] ?? '';

  const confirmDelete = async () => {
    if (!deleteTarget?.metadata.namespace) {
      return;
    }
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteInferenceService(deleteTarget.metadata.namespace, deleteTarget.metadata.name);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to delete model.');
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
        <Alert variant="danger" isInline title="Could not update deployment" style={{ marginBottom: '1rem' }}>
          {actionError}
        </Alert>
      ) : null}
      <Toolbar>
        <ToolbarContent>
          {canCreate ? (
            <ToolbarItem>
              <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                Deploy model
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
      {!isLoading && services.length === 0 && !error ? (
        <EmptyState headingLevel="h2" titleText="No model deployments" icon={CubesIcon}>
          <EmptyStateBody>
            Deploy a KServe InferenceService to serve a model in this project.
          </EmptyStateBody>
          {canCreate ? (
            <EmptyStateFooter>
              <EmptyStateActions>
                <Button variant="primary" onClick={() => setIsCreateOpen(true)}>
                  Deploy model
                </Button>
              </EmptyStateActions>
            </EmptyStateFooter>
          ) : null}
        </EmptyState>
      ) : null}
      {!isLoading && services.length > 0 ? (
        <Table aria-label="InferenceServices" variant="compact">
          <Thead>
            <Tr>
              <Th>Name</Th>
              {!projectName ? <Th>Project</Th> : null}
              <Th>Predictor</Th>
              <Th>Ready</Th>
              <Th>URL</Th>
              <Th>Created</Th>
              <Th screenReaderText="Actions" />
            </Tr>
          </Thead>
          <Tbody>
            {services.map((service) => {
              const namespace = service.metadata.namespace ?? '';
              const canEdit = access.forProject(namespace).canEdit;
              const ready = readyStatus(service);
              const url = serviceUrl(service);
              return (
                <Tr
                  key={`${namespace}/${service.metadata.name}`}
                  isClickable
                  onRowClick={() => setViewTarget(service)}
                >
                  <Td dataLabel="Name">{service.metadata.name}</Td>
                  {!projectName ? <Td dataLabel="Project">{namespace || '—'}</Td> : null}
                  <Td dataLabel="Predictor">{predictorType(service)}</Td>
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
                  <Td dataLabel="Created">{formatCreated(service.metadata.creationTimestamp)}</Td>
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
                            setViewTarget(service);
                          },
                        },
                        {
                          title: 'Edit',
                          isDisabled: !canEdit,
                          onClick: (event) => {
                            event?.stopPropagation();
                            setEditTarget(service);
                          },
                        },
                        { isSeparator: true },
                        {
                          title: 'Delete',
                          isDisabled: !canEdit,
                          onClick: (event) => {
                            event?.stopPropagation();
                            setDeleteTarget(service);
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
        <InferenceServiceFormModal
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
        <InferenceServiceFormModal
          namespace={editTarget.metadata.namespace ?? defaultCreateNamespace}
          service={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            void load();
          }}
        />
      ) : null}
      {viewTarget ? (
        <Modal isOpen variant="medium" onClose={() => setViewTarget(null)} aria-label="InferenceService details">
          <ModalHeader title={viewTarget.metadata.name} />
          <ModalBody>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Project</DescriptionListTerm>
                <DescriptionListDescription>
                  {viewTarget.metadata.namespace ?? '—'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Predictor</DescriptionListTerm>
                <DescriptionListDescription>{predictorType(viewTarget)}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Storage URI</DescriptionListTerm>
                <DescriptionListDescription>{storageUriOf(viewTarget)}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Ready</DescriptionListTerm>
                <DescriptionListDescription>{readyStatus(viewTarget)}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>URL</DescriptionListTerm>
                <DescriptionListDescription>
                  {serviceUrl(viewTarget) || '—'}
                </DescriptionListDescription>
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
            {viewTarget.metadata.namespace && access.forProject(viewTarget.metadata.namespace).canEdit ? (
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
        <Modal isOpen variant="small" onClose={() => setDeleteTarget(null)} aria-label="Delete InferenceService">
          <ModalHeader title="Delete model" />
          <ModalBody>
            Delete InferenceService {deleteTarget.metadata.name}
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
