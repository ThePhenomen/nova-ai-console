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
import { useNavigate, useParams } from 'react-router-dom';
import { canI } from '../../../cluster/accessReview';
import { K8sApiError } from '../../../cluster/k8sClient';
import { useSelectedProject } from '../../projects/selectedProjectStore';
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
  containerSummary,
  duplicateResource,
  isPreInstalled,
  runtimeDisplayName,
  runtimeEngineTags,
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
  const globalProject = useSelectedProject();
  const scope = kind.scope === 'Namespaced' ? globalProject : '';
  const [items, setItems] = React.useState<KServeSettingsResource[]>([]);
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

  const [canCreate, setCanCreate] = React.useState(false);
  const [canUpdateCluster, setCanUpdateCluster] = React.useState(false);
  const [canUpdateNamespaced, setCanUpdateNamespaced] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (kind.scope === 'Cluster') {
        const [create, update] = await Promise.all([
          canI('create', kind.group, kind.plural),
          canI('update', kind.group, kind.plural),
        ]);
        if (!cancelled) {
          setCanCreate(create);
          setCanUpdateCluster(update);
          setCanUpdateNamespaced(false);
        }
        return;
      }
      if (!scope) {
        if (!cancelled) {
          setCanCreate(false);
          setCanUpdateCluster(false);
          setCanUpdateNamespaced(false);
        }
        return;
      }
      const [create, update] = await Promise.all([
        canI('create', kind.group, kind.plural, scope),
        canI('update', kind.group, kind.plural, scope),
      ]);
      if (!cancelled) {
        setCanCreate(create);
        setCanUpdateCluster(false);
        setCanUpdateNamespaced(update);
      }
    };
    void check();
    return () => {
      cancelled = true;
    };
  }, [kind.group, kind.plural, kind.scope, scope]);

  const canEditItem = (item: KServeSettingsResource): boolean => {
    if (isPreInstalled(item)) {
      return false;
    }
    if (kind.scope === 'Namespaced') {
      return canUpdateNamespaced && item.metadata.namespace === scope;
    }
    return canUpdateCluster;
  };

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      if (kind.scope === 'Cluster') {
        setItems(await listSettingsResources(kind));
        return;
      }
      if (!scope) {
        setItems([]);
        return;
      }
      setItems(await listSettingsResources(kind, scope));
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to load KServe settings.');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [kind, scope]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const displayedItems = React.useMemo(
    () => items.toSorted((left, right) => compareItems(left, right, sortColumn, sortDirection)),
    [items, sortColumn, sortDirection],
  );

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

  const createNamespaces = scope ? [scope] : [];
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
              {kind.scope === 'Namespaced' && !scope
                ? 'Select a project in the page header to view serving runtimes.'
                : canCreate
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
                const preInstalled = isPreInstalled(item);
                const engines = runtimeEngineTags(item);
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
                    key={`${kind.kind}/${item.metadata.namespace ?? ''}/${item.metadata.name}`}
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
                        {engines.map((engine) => (
                          <FlexItem key={`engine-${engine}`}>
                            <Label color="teal" isCompact>
                              {engine}
                            </Label>
                          </FlexItem>
                        ))}
                        {version ? (
                          <FlexItem>
                            <Label color="blue" isCompact>
                              {version}
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
                            <Label color="yellow" isCompact>
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
                const engines = runtimeEngineTags(item);
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
                        {engines.map((engine) => (
                          <FlexItem key={`engine-${engine}`}>
                            <Label color="teal" isCompact>
                              {engine}
                            </Label>
                          </FlexItem>
                        ))}
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
