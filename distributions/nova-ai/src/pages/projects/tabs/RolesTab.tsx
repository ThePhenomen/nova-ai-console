import React from 'react';
import { Alert, Bullseye, EmptyState, EmptyStateBody, PageSection, Spinner } from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { K8sApiError } from '../../../cluster/k8sClient';
import type { RoleKind } from '../../../cluster/types';
import { listRoles } from '../projectApi';

type RolesTabProps = {
  projectName: string;
};

const formatList = (values?: string[]): string => (values && values.length > 0 ? values.join(', ') : '—');

const RolesTab: React.FC<RolesTabProps> = ({ projectName }) => {
  const [roles, setRoles] = React.useState<RoleKind[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const nextRoles = await listRoles(projectName);
        if (!cancelled) {
          setRoles(nextRoles.toSorted((a, b) => a.metadata.name.localeCompare(b.metadata.name)));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof K8sApiError ? err.message : 'Failed to load roles.');
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

  if (error) {
    return (
      <PageSection>
        <Alert variant="danger" isInline title="Could not load roles">
          {error}
        </Alert>
      </PageSection>
    );
  }

  if (roles.length === 0) {
    return (
      <PageSection>
        <EmptyState headingLevel="h2" titleText="No roles">
          <EmptyStateBody>This project has no namespaced Roles yet.</EmptyStateBody>
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Table aria-label="Roles" variant="compact">
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>API groups</Th>
            <Th>Resources</Th>
            <Th>Verbs</Th>
          </Tr>
        </Thead>
        <Tbody>
          {roles.map((role) => {
            const rules = role.rules ?? [];
            return (
              <Tr key={role.metadata.name}>
                <Td dataLabel="Name">{role.metadata.name}</Td>
                <Td dataLabel="API groups">
                  {formatList(rules.flatMap((rule) => rule.apiGroups ?? []))}
                </Td>
                <Td dataLabel="Resources">
                  {formatList(rules.flatMap((rule) => rule.resources ?? []))}
                </Td>
                <Td dataLabel="Verbs">{formatList(rules.flatMap((rule) => rule.verbs ?? []))}</Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </PageSection>
  );
};

export default RolesTab;
