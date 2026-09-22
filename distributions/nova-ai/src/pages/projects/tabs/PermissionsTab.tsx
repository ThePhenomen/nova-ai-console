import React from 'react';
import { Alert, Bullseye, EmptyState, EmptyStateBody, PageSection, Spinner } from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { K8sApiError } from '../../../cluster/k8sClient';
import type { RoleBindingKind } from '../../../cluster/types';
import { listRoleBindings } from '../projectApi';

type PermissionsTabProps = {
  projectName: string;
};

const formatSubjects = (binding: RoleBindingKind): string => {
  if (!binding.subjects || binding.subjects.length === 0) {
    return '—';
  }
  return binding.subjects
    .map((subject) => {
      if (subject.namespace) {
        return `${subject.kind}/${subject.namespace}/${subject.name}`;
      }
      return `${subject.kind}/${subject.name}`;
    })
    .join(', ');
};

const PermissionsTab: React.FC<PermissionsTabProps> = ({ projectName }) => {
  const [bindings, setBindings] = React.useState<RoleBindingKind[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const nextBindings = await listRoleBindings(projectName);
        if (!cancelled) {
          setBindings(nextBindings.toSorted((a, b) => a.metadata.name.localeCompare(b.metadata.name)));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof K8sApiError ? err.message : 'Failed to load permissions.');
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
        <Alert variant="danger" isInline title="Could not load permissions">
          {error}
        </Alert>
      </PageSection>
    );
  }

  if (bindings.length === 0) {
    return (
      <PageSection>
        <EmptyState headingLevel="h2" titleText="No permissions">
          <EmptyStateBody>This project has no RoleBindings yet.</EmptyStateBody>
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Table aria-label="Permissions" variant="compact">
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Subjects</Th>
          </Tr>
        </Thead>
        <Tbody>
          {bindings.map((binding) => (
            <Tr key={binding.metadata.name}>
              <Td dataLabel="Name">{binding.metadata.name}</Td>
              <Td dataLabel="Role">{`${binding.roleRef.kind}/${binding.roleRef.name}`}</Td>
              <Td dataLabel="Subjects">{formatSubjects(binding)}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </PageSection>
  );
};

export default PermissionsTab;
