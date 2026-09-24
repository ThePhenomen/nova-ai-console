import React from 'react';
import {
  Alert,
  Breadcrumb,
  BreadcrumbItem,
  Bullseye,
  Button,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  Flex,
  FlexItem,
  Label,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Spinner,
  TextArea,
} from '@patternfly/react-core';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePlatformAccess } from '../../../auth/usePlatformAccess';
import { K8sApiError } from '../../../cluster/k8sClient';
import { toManifest } from '../../deployments/manifest';
import { deleteSettingsResource, getSettingsResource } from './api';
import {
  settingsKindByName,
  settingsKindByTab,
  settingsListPath,
  type KServeSettingsResource,
  type SettingsKindCatalog,
} from './catalog';
import {
  asRecord,
  canEditSettingsKind,
  containerSummary,
  isPreInstalled,
  isRuntimeDisabled,
  modelFormatSummary,
  runtimeVersionTag,
  uriFormatSummary,
} from './helpers';
import ResourceFormModal from './ResourceFormModal';

const formatCreated = (value?: string): string => {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const ResourceDetails: React.FC = () => {
  const params = useParams<{ tab: string; name: string; namespace?: string }>();
  const kind: SettingsKindCatalog = settingsKindByTab(params.tab);
  const name = params.name ?? '';
  const namespace = kind.scope === 'Namespaced' ? params.namespace : undefined;
  const navigate = useNavigate();
  const { access } = usePlatformAccess();
  const [item, setItem] = React.useState<KServeSettingsResource | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isEditOpen, setIsEditOpen] = React.useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = React.useState(false);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const listPath = settingsListPath(kind);
  const canEdit =
    Boolean(item) &&
    !isPreInstalled(item) &&
    canEditSettingsKind(kind.kind, access.consoleRole) &&
    (kind.scope === 'Cluster' || access.forProject(namespace ?? '').canEdit);

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (kind.scope === 'Namespaced' && !namespace) {
        throw new Error('ServingRuntime details require a project namespace.');
      }
      setItem(await getSettingsResource(kind, name, namespace));
    } catch (err) {
      setError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to load resource.');
      setItem(null);
    } finally {
      setIsLoading(false);
    }
  }, [kind, name, namespace]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const confirmDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteSettingsResource(kind, name, namespace);
      navigate(listPath);
    } catch (err) {
      setError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to delete resource.');
      setIsDeleteOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  const resolvedKind = item?.kind ? settingsKindByName(item.kind) : kind;
  const disabled = item ? isRuntimeDisabled(item) : false;

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <Breadcrumb>
          <BreadcrumbItem>
            <Link to="/settings/kserve">KServe</Link>
          </BreadcrumbItem>
          <BreadcrumbItem>
            <Link to={listPath}>{resolvedKind.title}</Link>
          </BreadcrumbItem>
          <BreadcrumbItem isActive>{name}</BreadcrumbItem>
        </Breadcrumb>
        <Content component="h1">{name}</Content>
        <Content component="p">{resolvedKind.kind}</Content>
        {item && (isPreInstalled(item) || runtimeVersionTag(item)) ? (
          <Flex spaceItems={{ default: 'spaceItemsSm' }} style={{ marginTop: '0.5rem' }}>
            {isPreInstalled(item) ? (
              <FlexItem>
                <Label isCompact>Pre-installed</Label>
              </FlexItem>
            ) : null}
            {runtimeVersionTag(item) ? (
              <FlexItem>
                <Label color="blue" isCompact>
                  {runtimeVersionTag(item)}
                </Label>
              </FlexItem>
            ) : null}
          </Flex>
        ) : null}
      </PageSection>
      <PageSection>
        {error ? (
          <Alert variant="danger" isInline title="Could not load resource" style={{ marginBottom: '1rem' }}>
            {error}
          </Alert>
        ) : null}
        {isLoading ? (
          <Bullseye>
            <Spinner />
          </Bullseye>
        ) : null}
        {!isLoading && item ? (
          <>
            <ToolbarActions canEdit={canEdit} onEdit={() => setIsEditOpen(true)} onDelete={() => setIsDeleteOpen(true)} />
            <DescriptionList isHorizontal style={{ marginTop: '1rem' }}>
              <DescriptionListGroup>
                <DescriptionListTerm>Kind</DescriptionListTerm>
                <DescriptionListDescription>{item.kind}</DescriptionListDescription>
              </DescriptionListGroup>
              {item.metadata.namespace ? (
                <DescriptionListGroup>
                  <DescriptionListTerm>Project</DescriptionListTerm>
                  <DescriptionListDescription>{item.metadata.namespace}</DescriptionListDescription>
                </DescriptionListGroup>
              ) : null}
              <DescriptionListGroup>
                <DescriptionListTerm>Created</DescriptionListTerm>
                <DescriptionListDescription>{formatCreated(item.metadata.creationTimestamp)}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Disabled</DescriptionListTerm>
                <DescriptionListDescription>
                  <Label color={disabled ? 'orange' : 'green'} isCompact>
                    {disabled ? 'Disabled' : 'Enabled'}
                  </Label>
                </DescriptionListDescription>
              </DescriptionListGroup>
              {resolvedKind.kind === 'ClusterStorageContainer' ? (
                <>
                  <DescriptionListGroup>
                    <DescriptionListTerm>Workload type</DescriptionListTerm>
                    <DescriptionListDescription>
                      {String(asRecord(item.spec)?.workloadType ?? 'initContainer')}
                    </DescriptionListDescription>
                  </DescriptionListGroup>
                  <DescriptionListGroup>
                    <DescriptionListTerm>URI formats</DescriptionListTerm>
                    <DescriptionListDescription>{uriFormatSummary(item)}</DescriptionListDescription>
                  </DescriptionListGroup>
                </>
              ) : (
                <DescriptionListGroup>
                  <DescriptionListTerm>Model format</DescriptionListTerm>
                  <DescriptionListDescription>{modelFormatSummary(item)}</DescriptionListDescription>
                </DescriptionListGroup>
              )}
              <DescriptionListGroup>
                <DescriptionListTerm>Containers</DescriptionListTerm>
                <DescriptionListDescription>{containerSummary(item)}</DescriptionListDescription>
              </DescriptionListGroup>
              <DescriptionListGroup>
                <DescriptionListTerm>Labels</DescriptionListTerm>
                <DescriptionListDescription>
                  {item.metadata.labels && Object.keys(item.metadata.labels).length > 0
                    ? Object.entries(item.metadata.labels)
                        .map(([key, value]) => `${key}=${value}`)
                        .join(', ')
                    : '—'}
                </DescriptionListDescription>
              </DescriptionListGroup>
            </DescriptionList>
            <Content component="h2" style={{ marginTop: '1.5rem' }}>
              YAML
            </Content>
            <TextArea
              value={toManifest(item as Record<string, unknown>)}
              readOnly
              rows={22}
              resizeOrientation="vertical"
              aria-label={`${resolvedKind.kind} YAML`}
            />
          </>
        ) : null}
      </PageSection>
      {isEditOpen && item ? (
        <ResourceFormModal
          kind={resolvedKind}
          namespaces={namespace ? [namespace] : undefined}
          resource={item}
          onClose={() => setIsEditOpen(false)}
          onSaved={() => {
            setIsEditOpen(false);
            void load();
          }}
        />
      ) : null}
      {isDeleteOpen ? (
        <Modal isOpen variant="small" onClose={() => setIsDeleteOpen(false)} aria-label="Delete resource">
          <ModalHeader title={`Delete ${resolvedKind.kind}`} />
          <ModalBody>
            Delete {resolvedKind.kind} {name}
            {namespace ? ` in ${namespace}` : ''}? This cannot be undone.
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

const ToolbarActions: React.FC<{ canEdit: boolean; onEdit: () => void; onDelete: () => void }> = ({
  canEdit,
  onEdit,
  onDelete,
}) => {
  if (!canEdit) {
    return null;
  }
  return (
    <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
      <Button
        variant="primary"
        onClick={onEdit}
        style={{
          backgroundColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
          color: 'var(--pf-t--global--text--color--on-brand, #fff)',
        }}
      >
        Edit
      </Button>
      <Button variant="danger" onClick={onDelete}>
        Delete
      </Button>
    </div>
  );
};

export default ResourceDetails;
