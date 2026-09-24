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
  Tab,
  Tabs,
  TabTitleText,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { CubesIcon, FolderIcon } from '@patternfly/react-icons';
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
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { usePlatformAccess } from '../../../auth/usePlatformAccess';
import { K8sApiError } from '../../../cluster/k8sClient';
import { listProjects } from '../../projects/projectApi';
import { deleteSettingsResource, listSettingsResources } from './api';
import {
  SETTINGS_KIND_CATALOG,
  settingsDetailsPath,
  settingsKindByTab,
  settingsListPath,
  type KServeSettingsResource,
  type SettingsKindCatalog,
} from './catalog';
import {
  canEditSettingsKind,
  containerSummary,
  duplicateResource,
  isPreInstalled,
  runtimeDisplayName,
  runtimeVersionTag,
  servingPlatformLabel,
  apiProtocolLabels,
  uriFormatSummary,
} from './helpers';
import ResourceFormModal from './ResourceFormModal';

type SortColumn = 'name' | 'created';

const SORT_COLUMNS: SortColumn[] = ['name', 'created'];

const formatCreated = (value?: string): string => {
  if (!value) {
    return '—';
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
};

const compareItems = (
  left: KServeSettingsResource,
  right: KServeSettingsResource,
  column: SortColumn,
  direction: 'asc' | 'desc',
): number => {
  const order = direction === 'asc' ? 1 : -1;
  if (column === 'created') {
    return (left.metadata.creationTimestamp ?? '').localeCompare(right.metadata.creationTimestamp ?? '') * order;
  }
  return left.metadata.name.localeCompare(right.metadata.name) * order;
};

const KServeSettings: React.FC = () => {
  const { tab } = useParams<{ tab?: string }>();
  const kind = settingsKindByTab(tab);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { access } = usePlatformAccess();
  const [items, setItems] = React.useState<KServeSettingsResource[]>([]);
  const [namespaces, setNamespaces] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isCreateOpen, setIsCreateOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState<KServeSettingsResource | null>(null);
  const [duplicateTarget, setDuplicateTarget] = React.useState<KServeSettingsResource | null>(null);
  const [deleteTarget, setDeleteTarget] = React.useState<KServeSettingsResource | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [sortColumn, setSortColumn] = React.useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('asc');

  const requestedProject = searchParams.get('project') ?? '';
  const selectedProject =
    kind.scope === 'Namespaced' && requestedProject && namespaces.includes(requestedProject)
      ? requestedProject
      : '';

  const canEditCluster = access.consoleRole === 'admin';
  const editableNamespaces = namespaces.filter((namespace) => access.forProject(namespace).canEdit);
  const canCreate =
    kind.scope === 'Cluster'
      ? canEditCluster
      : selectedProject
        ? access.forProject(selectedProject).canEdit
        : editableNamespaces.length > 0;
  const canEditItem = (item: KServeSettingsResource): boolean => {
    if (isPreInstalled(item)) {
      return false;
    }
    if (!canEditSettingsKind(kind.kind, access.consoleRole)) {
      return false;
    }
    if (kind.scope === 'Namespaced') {
      return access.forProject(item.metadata.namespace ?? '').canEdit;
    }
    return canEditCluster;
  };

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (kind.scope === 'Cluster') {
        setNamespaces([]);
        const listed = await listSettingsResources(kind);
        setItems(listed);
        return;
      }
      const scoped =
        access.consoleRole === 'admin'
          ? (await listProjects()).map((project) => project.name)
          : access.visibleProjects.filter((name) => access.canViewProject(name));
      setNamespaces(scoped);
      const lists = await Promise.all(
        scoped.map(async (namespace) => {
          try {
            return await listSettingsResources(kind, namespace);
          } catch {
            return [];
          }
        }),
      );
      setItems(lists.flat());
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to load KServe settings.');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [access, kind]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const displayedItems = React.useMemo(() => {
    const scoped = selectedProject
      ? items.filter((item) => item.metadata.namespace === selectedProject)
      : items;
    return scoped.toSorted((left, right) => compareItems(left, right, sortColumn, sortDirection));
  }, [items, selectedProject, sortColumn, sortDirection]);

  const getSortParams = (column: SortColumn): ThProps['sort'] => ({
    sortBy: {
      index: SORT_COLUMNS.indexOf(sortColumn),
      direction: sortDirection,
    },
    onSort: (_event, index, direction) => {
      setSortColumn(SORT_COLUMNS[index] ?? 'name');
      setSortDirection(direction);
    },
    columnIndex: SORT_COLUMNS.indexOf(column),
  });

  const openDetails = (item: KServeSettingsResource) => {
    navigate(settingsDetailsPath(kind, item.metadata.name, item.metadata.namespace));
  };

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }
    setIsDeleting(true);
    setActionError(null);
    try {
      await deleteSettingsResource(kind, deleteTarget.metadata.name, deleteTarget.metadata.namespace);
      setDeleteTarget(null);
      await load();
    } catch (err) {
      setActionError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to delete resource.');
    } finally {
      setIsDeleting(false);
    }
  };

  const createNamespaces = selectedProject ? [selectedProject] : editableNamespaces;
  const selectKind = (next: SettingsKindCatalog) => {
    setIsCreateOpen(false);
    setEditTarget(null);
    setDuplicateTarget(null);
    setDeleteTarget(null);
    navigate(settingsListPath(next));
  };

  return (
    <>
      <PageSection hasBodyWrapper={false}>
        <Content component="h1">KServe</Content>
        <Content component="p">View and configure serving runtimes and storage containers.</Content>
      </PageSection>
      <PageSection type="tabs" hasBodyWrapper={false}>
        <Tabs
          activeKey={kind.tabId}
          onSelect={(_event, tabKey) => {
            const next = SETTINGS_KIND_CATALOG.find((item) => item.tabId === String(tabKey));
            if (next) {
              selectKind(next);
            }
          }}
        >
          {SETTINGS_KIND_CATALOG.map((item) => (
            <Tab key={item.tabId} eventKey={item.tabId} title={<TabTitleText>{item.title}</TabTitleText>} />
          ))}
        </Tabs>
      </PageSection>
      <PageSection>
        <Content component="p" style={{ marginBottom: '0.75rem' }}>
          {kind.description}
        </Content>
        {kind.scope === 'Namespaced' ? (
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
                id="settings-project-filter"
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
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontWeight: 600 }}
                >
                  <FolderIcon />
                  {selectedProject}
                </Link>
              </FlexItem>
            ) : null}
          </Flex>
        ) : null}
        {error ? (
          <Alert variant="danger" isInline title="Could not load resources" style={{ marginBottom: '1rem' }}>
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
                  style={{
                    backgroundColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
                    color: 'var(--pf-t--global--text--color--on-brand, #fff)',
                  }}
                >
                  Create {kind.kind}
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
          <EmptyState headingLevel="h2" titleText={`No ${kind.title.toLowerCase()}`} icon={CubesIcon}>
            <EmptyStateBody>
              {canCreate
                ? `Create a ${kind.kind} from fields or paste a YAML manifest.`
                : `No ${kind.kind} resources are visible with your current role.`}
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
                    Create {kind.kind}
                  </Button>
                </EmptyStateActions>
              </EmptyStateFooter>
            ) : null}
          </EmptyState>
        ) : null}
        {!isLoading && displayedItems.length > 0 && kind.kind !== 'ClusterStorageContainer' ? (
          <Table aria-label={kind.title} variant="compact">
            <Thead>
              <Tr>
                <Th sort={getSortParams('name')}>Name</Th>
                <Th>Serving platforms supported</Th>
                <Th>API protocol</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {displayedItems.map((item) => {
                const namespace = item.metadata.namespace ?? '';
                const preInstalled = isPreInstalled(item);
                const version = runtimeVersionTag(item);
                const canMutate = canEditItem(item);
                const actions = preInstalled
                  ? canCreate
                    ? [
                        {
                          title: 'Duplicate',
                          onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                            event?.stopPropagation();
                            setDuplicateTarget(duplicateResource(item));
                          },
                        },
                      ]
                    : []
                  : [
                      {
                        title: 'View',
                        onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                          event?.stopPropagation();
                          openDetails(item);
                        },
                      },
                      {
                        title: 'Edit',
                        isDisabled: !canMutate,
                        onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                          event?.stopPropagation();
                          setEditTarget(item);
                        },
                      },
                      { isSeparator: true },
                      {
                        title: 'Delete',
                        isDisabled: !canMutate,
                        onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                          event?.stopPropagation();
                          setDeleteTarget(item);
                        },
                      },
                    ];
                return (
                  <Tr
                    key={`${kind.kind}/${namespace}/${item.metadata.name}`}
                    isClickable
                    onRowClick={() => openDetails(item)}
                  >
                    <Td dataLabel="Name">
                      <div style={{ fontWeight: 600 }}>{runtimeDisplayName(item)}</div>
                      <Flex
                        spaceItems={{ default: 'spaceItemsSm' }}
                        flexWrap={{ default: 'wrap' }}
                        style={{ marginTop: '0.35rem' }}
                      >
                        {preInstalled ? (
                          <FlexItem>
                            <Label isCompact>Pre-installed</Label>
                          </FlexItem>
                        ) : null}
                        {version ? (
                          <FlexItem>
                            <Label color="blue" isCompact>
                              {version}
                            </Label>
                          </FlexItem>
                        ) : null}
                        {kind.scope === 'Namespaced' && !selectedProject && namespace ? (
                          <FlexItem>
                            <Label color="grey" isCompact>
                              {namespace}
                            </Label>
                          </FlexItem>
                        ) : null}
                      </Flex>
                    </Td>
                    <Td dataLabel="Serving platforms supported">
                      <Label color="purple" isCompact>
                        {servingPlatformLabel(item)}
                      </Label>
                    </Td>
                    <Td dataLabel="API protocol">
                      <Flex spaceItems={{ default: 'spaceItemsSm' }}>
                        {apiProtocolLabels(item).map((protocol) => (
                          <FlexItem key={protocol}>
                            <Label color="gold" isCompact>
                              {protocol}
                            </Label>
                          </FlexItem>
                        ))}
                      </Flex>
                    </Td>
                    <Td
                      isActionCell
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      {actions.length > 0 ? <ActionsColumn items={actions} /> : null}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        ) : null}
        {!isLoading && displayedItems.length > 0 && kind.kind === 'ClusterStorageContainer' ? (
          <Table aria-label={kind.title} variant="compact">
            <Thead>
              <Tr>
                <Th sort={getSortParams('name')}>Name</Th>
                <Th>URI formats</Th>
                <Th>Containers</Th>
                <Th sort={getSortParams('created')}>Created</Th>
                <Th screenReaderText="Actions" />
              </Tr>
            </Thead>
            <Tbody>
              {displayedItems.map((item) => {
                const preInstalled = isPreInstalled(item);
                const version = runtimeVersionTag(item);
                const canMutate = canEditItem(item);
                const actions = preInstalled
                  ? canCreate
                    ? [
                        {
                          title: 'Duplicate',
                          onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                            event?.stopPropagation();
                            setDuplicateTarget(duplicateResource(item));
                          },
                        },
                      ]
                    : []
                  : [
                      {
                        title: 'View',
                        onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                          event?.stopPropagation();
                          openDetails(item);
                        },
                      },
                      {
                        title: 'Edit',
                        isDisabled: !canMutate,
                        onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                          event?.stopPropagation();
                          setEditTarget(item);
                        },
                      },
                      { isSeparator: true },
                      {
                        title: 'Delete',
                        isDisabled: !canMutate,
                        onClick: (event?: React.KeyboardEvent | React.MouseEvent) => {
                          event?.stopPropagation();
                          setDeleteTarget(item);
                        },
                      },
                    ];
                return (
                  <Tr
                    key={`${kind.kind}/${item.metadata.name}`}
                    isClickable
                    onRowClick={() => openDetails(item)}
                  >
                    <Td dataLabel="Name">
                      <div style={{ fontWeight: 600 }}>{runtimeDisplayName(item)}</div>
                      <Flex
                        spaceItems={{ default: 'spaceItemsSm' }}
                        flexWrap={{ default: 'wrap' }}
                        style={{ marginTop: '0.35rem' }}
                      >
                        {preInstalled ? (
                          <FlexItem>
                            <Label isCompact>Pre-installed</Label>
                          </FlexItem>
                        ) : null}
                        {version ? (
                          <FlexItem>
                            <Label color="blue" isCompact>
                              {version}
                            </Label>
                          </FlexItem>
                        ) : null}
                      </Flex>
                    </Td>
                    <Td dataLabel="URI formats">{uriFormatSummary(item)}</Td>
                    <Td dataLabel="Containers">{containerSummary(item)}</Td>
                    <Td dataLabel="Created">{formatCreated(item.metadata.creationTimestamp)}</Td>
                    <Td
                      isActionCell
                      onClick={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                    >
                      {actions.length > 0 ? <ActionsColumn items={actions} /> : null}
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        ) : null}
        {isCreateOpen && canCreate ? (
          <ResourceFormModal
            kind={kind}
            namespaces={kind.scope === 'Namespaced' ? createNamespaces : undefined}
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
            namespaces={kind.scope === 'Namespaced' ? createNamespaces : undefined}
            resource={editTarget}
            onClose={() => setEditTarget(null)}
            onSaved={() => {
              setEditTarget(null);
              void load();
            }}
          />
        ) : null}
        {duplicateTarget && canCreate ? (
          <ResourceFormModal
            kind={kind}
            duplicate
            namespaces={
              kind.scope === 'Namespaced'
                ? duplicateTarget.metadata.namespace
                  ? [duplicateTarget.metadata.namespace]
                  : createNamespaces
                : undefined
            }
            resource={duplicateTarget}
            onClose={() => setDuplicateTarget(null)}
            onSaved={() => {
              setDuplicateTarget(null);
              void load();
            }}
          />
        ) : null}
        {deleteTarget ? (
          <Modal isOpen variant="small" onClose={() => setDeleteTarget(null)} aria-label="Delete resource">
            <ModalHeader title={`Delete ${kind.kind}`} />
            <ModalBody>
              Delete {kind.kind} {deleteTarget.metadata.name}
              {deleteTarget.metadata.namespace ? ` in ${deleteTarget.metadata.namespace}` : ''}? This cannot
              be undone.
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
    </>
  );
};

export default KServeSettings;
