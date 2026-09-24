import React from 'react';
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  Bullseye,
} from '@patternfly/react-core';
import { Table, Tbody, Td, Th, Thead, Tr } from '@patternfly/react-table';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePlatformAccess } from '../../auth/usePlatformAccess';
import { K8sApiError } from '../../cluster/k8sClient';
import { kindByName, type KindCatalog, type KServeResource } from './crdCatalog';
import { deleteKServeResource, getKServeResource } from './kserveApi';
import { readyStatus, resourceSummary, serviceUrl, storageUriOf } from './kserveHelpers';
import ResourceFormModal from './ResourceFormModal';

type DeploymentDetailsProps = {
  projectScoped?: boolean;
};

const formatCreated = (value?: string): string => {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const DeploymentDetails: React.FC<DeploymentDetailsProps> = ({ projectScoped = false }) => {
  const params = useParams<{ projectName?: string; namespace?: string; kind?: string; name?: string }>();
  const namespace = params.projectName ?? params.namespace ?? '';
  const kindName = params.kind ?? '';
  const name = params.name ?? '';
  const navigate = useNavigate();
  const { access } = usePlatformAccess();
  const [item, setItem] = React.useState<KServeResource | null>(null);
  const [kind, setKind] = React.useState<KindCatalog | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const listPath = projectScoped ? `/projects/${namespace}/deployments` : '/deployments';
  const canEdit = access.forProject(namespace).canEdit;

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const catalog = kindByName(kindName);
      setKind(catalog);
      setItem(await getKServeResource(catalog, namespace, name));
    } catch (err) {
      setError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to load deployment.');
      setItem(null);
    } finally {
      setIsLoading(false);
    }
  }, [kindName, name, namespace]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    if (!kind) {
      return;
    }
    setIsDeleting(true);
    try {
      await deleteKServeResource(kind, name, namespace);
      navigate(listPath);
    } catch (err) {
      setError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to delete deployment.');
      setIsDeleteOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const labels = Object.entries(item?.metadata.labels ?? {});

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <Breadcrumb>
          {projectScoped ? (
            <>
              <BreadcrumbItem>
                <Link to="/projects">Projects</Link>
              </BreadcrumbItem>
              <BreadcrumbItem>
                <Link to={`/projects/${namespace}/overview`}>{namespace}</Link>
              </BreadcrumbItem>
              <BreadcrumbItem>
                <Link to={listPath}>Deployments</Link>
              </BreadcrumbItem>
            </>
          ) : (
            <BreadcrumbItem>
              <Link to="/deployments">Deployments</Link>
            </BreadcrumbItem>
          )}
          <BreadcrumbItem isActive>{name}</BreadcrumbItem>
        </Breadcrumb>
        <Content component="h1">{name}</Content>
      </PageSection>
      <PageSection>
        {isLoading ? (
          <Bullseye>
            <Spinner />
          </Bullseye>
        ) : null}
        {error ? (
          <Alert variant="danger" isInline title="Could not load deployment">
            {error}
          </Alert>
        ) : null}
        {!isLoading && item && kind ? (
          <>
            <div style={{ marginBottom: '1rem' }}>
              {canEdit ? (
                <Button
                  variant="primary"
                  onClick={() => setIsEditOpen(true)}
                  style={{
                    backgroundColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
                    color: 'var(--pf-t--global--text--color--on-brand, #fff)',
                    marginRight: '0.5rem',
                  }}
                >
                  Edit
                </Button>
              ) : null}
              {canEdit ? (
                <Button variant="danger" onClick={() => setIsDeleteOpen(true)}>
                  Delete
                </Button>
              ) : null}
            </div>
            <DescriptionList isHorizontal>
              <DescriptionListGroup>
                <DescriptionListTerm>Kind</DescriptionListTerm>
                <DescriptionListDescription>{kind.title}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Project</DescriptionListTerm>
                <DescriptionListDescription>{namespace || '—'}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Model format</DescriptionListTerm>
                <DescriptionListDescription>
                  {kind.kind === 'InferenceService' ? resourceSummary(kind, item) : '—'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>
                  {kind.kind === 'InferenceService' ? 'Storage URI' : 'Graph'}
                </DescriptionListTerm>
                <DescriptionListDescription>
                  {kind.kind === 'InferenceService' ? storageUriOf(item) : resourceSummary(kind, item)}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Status</DescriptionListTerm>
                <DescriptionListDescription>
                  <Label color={readyStatus(item) === 'True' ? 'green' : readyStatus(item) === 'False' ? 'red' : 'grey'} isCompact>
                    {readyStatus(item) === 'True' ? 'Ready' : readyStatus(item) === 'False' ? 'Not ready' : 'Unknown'}
                  </Label>
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>URL</DescriptionListTerm>
                <DescriptionListDescription>
                  {serviceUrl(item) ? (
                    <a href={serviceUrl(item)} target="_blank" rel="noopener noreferrer">
                      {serviceUrl(item)}
                    </a>
                  ) : (
                    '—'
                  )}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Labels</DescriptionListTerm>
                <DescriptionListDescription>
                  {labels.length > 0
                    ? labels.map(([key, value]) => (
                        <Label key={key} isCompact style={{ marginRight: '0.25rem' }}>
                          {key}={value}
                        </Label>
                      ))
                    : '—'}
                </DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Created</DescriptionListTerm>
                <DescriptionListDescription>
                  {formatCreated(item.metadata.creationTimestamp)}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
            {(item.status?.conditions ?? []).length > 0 ? (
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
                  {(item.status?.conditions ?? []).map((condition) => (
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
          </>
        ) : null}
      </PageSection>
      {isEditOpen && item && kind ? (
        <ResourceFormModal
          kind={kind}
          namespace={namespace}
          resource={item}
          onClose={() => setIsEditOpen(false)}
          onSaved={() => {
            setIsEditOpen(false);
            void load();
          }}
        />
      ) : null}
      {isDeleteOpen ? (
        <Modal isOpen variant="small" onClose={() => setIsDeleteOpen(false)} aria-label="Delete deployment">
          <ModalHeader title={`Delete ${kind?.title ?? 'deployment'}`} />
          <ModalBody>
            Delete {kind?.title} {name} in {namespace}? This cannot be undone.
          </ModalBody>
          <ModalFooter>
            <Button variant="danger" onClick={() => void confirmDelete()} isLoading={isDeleting}>
              Delete
            </Button>
            <Button variant="link" onClick={() => setIsDeleteOpen(false)} isDisabled={isDeleting}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </>
  );
};

export default DeploymentDetails;
