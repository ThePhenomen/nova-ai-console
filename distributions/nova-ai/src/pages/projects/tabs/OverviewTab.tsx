import React from 'react';
import {
  Alert,
  Bullseye,
  Card,
  CardBody,
  CardTitle,
  DescriptionList,
  DescriptionListDescription,
  DescriptionListGroup,
  DescriptionListTerm,
  PageSection,
  Spinner,
  Stack,
  StackItem,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { K8sApiError } from '../../../cluster/k8sClient';
import type { NamespaceKind, ResourceQuotaKind } from '../../../cluster/types';
import { getNamespace, getProjectDescription, listNamespaceQuotas } from '../projectApi';

type OverviewTabProps = {
  projectName: string;
};

const OverviewTab: React.FC<OverviewTabProps> = ({ projectName }) => {
  const [namespace, setNamespace] = React.useState<NamespaceKind | null>(null);
  const [quotas, setQuotas] = React.useState<ResourceQuotaKind[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

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
          setNamespace(nextNamespace);
          setQuotas(nextQuotas);
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
      </Stack>
    </PageSection>
  );
};

export default OverviewTab;
