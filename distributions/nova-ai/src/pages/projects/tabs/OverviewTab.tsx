import React from 'react';
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  Content,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  ExpandableSection,
  Flex,
  FlexItem,
  PageSection,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { CubeIcon, KeyIcon, UsersIcon } from '@patternfly/react-icons';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { Link } from 'react-router-dom';
import { K8sApiError } from '../../../cluster/k8sClient';
import type { NamespaceKind, ResourceQuotaKind } from '../../../cluster/types';
import { hasConsoleScope } from '../../../consoleScope';
import { getCreateMlClusterUrl } from '../../../envNovaConsole';
import { getNamespace, getProjectDescription, listNamespaceQuotas } from '../projectApi';

type OverviewTabProps = {
  projectName: string;
  canManageRbac?: boolean;
};

const ConfigLinkCard: React.FC<{
  to: string;
  title: string;
  description: string;
  icon: React.ReactNode;
  isExternal?: boolean;
}> = ({ to, title, description, icon, isExternal = false }) => (
  <FlexItem flex={{ default: 'flex_1' }} style={{ minWidth: '16rem' }}>
    <Flex alignItems={{ default: 'alignItemsFlexStart' }} spaceItems={{ default: 'spaceItemsMd' }}>
      <FlexItem>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '2.5rem',
            height: '2.5rem',
            borderRadius: '50%',
            background: 'var(--pf-t--global--color--nonstatus--orange--default, #c4610e)',
            color: 'var(--pf-t--global--icon--color--inverse, #fff)',
          }}
        >
          {icon}
        </span>
      </FlexItem>
      <FlexItem flex={{ default: 'flex_1' }}>
        <Content>
          {isExternal ? (
            <a href={to} target="_blank" rel="noopener noreferrer">
              {title}
            </a>
          ) : (
            <Link to={to}>{title}</Link>
          )}
        </Content>
        <Content component="small">{description}</Content>
      </FlexItem>
    </Flex>
  </FlexItem>
);

const OverviewTab: React.FC<OverviewTabProps> = ({ projectName, canManageRbac = false }) => {
  const mlClusterUrl = getCreateMlClusterUrl(projectName);
  const [namespace, setNamespace] = React.useState<NamespaceKind | null>(null);
  const [quotas, setQuotas] = React.useState<ResourceQuotaKind[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isConfigOpen, setIsConfigOpen] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [nextNamespace, nextQuotas] = await Promise.all([
          getNamespace(projectName),
          listNamespaceQuotas(projectName),
        ]);
        if (!cancelled) {
          if (!hasConsoleScope(nextNamespace.metadata.labels)) {
            setError('This namespace is not a Nova AI Console project.');
            setNamespace(null);
            setQuotas([]);
          } else {
            setNamespace(nextNamespace);
            setQuotas(nextQuotas);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof K8sApiError ? err.message : 'Failed to load project.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectName]);

  if (isLoading) {
    return (
      <PageSection>
        <Bullseye>
          <Spinner />
        </Bullseye>
      </PageSection>
    );
  }

  if (error || !namespace) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Could not load project">
          {error}
        </Alert>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Stack hasGutter>
        <StackItem>
          <Card>
            <CardTitle>Details</CardTitle>
            <CardBody>
              <DescriptionList isHorizontal>
                <DescriptionListGroup>
                  <DescriptionListTerm>Name</DescriptionListTerm>
                  <DescriptionListDescription>{namespace.metadata.name}</DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Description</DescriptionListTerm>
                  <DescriptionListDescription>
                    {getProjectDescription(namespace) || '—'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Status</DescriptionListTerm>
                  <DescriptionListDescription>
                    {namespace.status?.phase ?? 'Unknown'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
                <DescriptionListGroup>
                  <DescriptionListTerm>Created</DescriptionListTerm>
                  <DescriptionListDescription>
                    {namespace.metadata.creationTimestamp ?? '—'}
                  </DescriptionListDescription>
                </DescriptionListGroup>
              </DescriptionList>
            </CardBody>
          </Card>
        </StackItem>
        <StackItem>
          <Card>
            <CardTitle>Resource quotas</CardTitle>
            <CardBody>
              {quotas.length === 0 ? (
                'No resource quota is set on this project.'
              ) : (
                quotas.map((quota) => {
                  const hard = quota.status?.hard ?? quota.spec?.hard ?? {};
                  const used = quota.status?.used ?? {};
                  const keys = Object.keys(hard).toSorted();
                  return (
                    <Table
                      key={quota.metadata.name}
                      aria-label={`Quota ${quota.metadata.name}`}
                      variant="compact"
                    >
                      <Thead>
                        <Tr>
                          <Th>Resource</Th>
                          <Th>Used</Th>
                          <Th>Hard limit</Th>
                        </Tr>
                      </Thead>
                      <Tbody>
                        {keys.map((key) => (
                          <Tr key={key}>
                            <Td dataLabel="Resource">{key}</Td>
                            <Td dataLabel="Used">{used[key] ?? '—'}</Td>
                            <Td dataLabel="Hard limit">{hard[key]}</Td>
                          </Tr>
                        ))}
                      </Tbody>
                    </Table>
                  );
                })
              )}
            </CardBody>
          </Card>
        </StackItem>
        {canManageRbac ? (
          <StackItem>
            <ExpandableSection
              toggleText="Project configuration"
              isExpanded={isConfigOpen}
              onToggle={(_event, expanded) => setIsConfigOpen(expanded)}
            >
              <div
                style={{
                  border: '1px solid var(--pf-t--global--border--color--default, #a2a9b4)',
                  borderRadius: '8px',
                  padding: '1.25rem 1.5rem',
                }}
              >
                <Flex
                  spaceItems={{ default: 'spaceItemsXl' }}
                  alignItems={{ default: 'alignItemsStretch' }}
                  flexWrap={{ default: 'wrap' }}
                >
                  <ConfigLinkCard
                    to={`/projects/${projectName}/roles`}
                    title="Roles"
                    description="Create and view Nova AI PlatformRoles used by this console."
                    icon={<KeyIcon />}
                  />
                  <ConfigLinkCard
                    to={`/projects/${projectName}/permissions`}
                    title="Permissions"
                    description="Add users and groups to share access to your project."
                    icon={<UsersIcon />}
                  />
                  {mlClusterUrl ? (
                    <ConfigLinkCard
                      to={mlClusterUrl}
                      title="MLCluster"
                      description="Create an MLCluster instance in this project."
                      icon={<CubeIcon />}
                      isExternal
                    />
                  ) : null}
                </Flex>
              </div>
            </ExpandableSection>
          </StackItem>
        ) : null}
      </Stack>
    </PageSection>
  );
};

export default OverviewTab;
