import React from 'react';
import {
  Alert,
  Bullseye,
  EmptyState,
  EmptyStateBody,
  PageSection,
  Spinner,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import { personaFromRole, servicesFromRole } from '../../../auth/access';
import { listPlatformRoleBindings, listPlatformRoles } from '../../../auth/platformApi';
import type { PlatformRoleKind } from '../../../auth/types';
import { K8sApiError } from '../../../cluster/k8sClient';

type RolesTabProps = {
  projectName: string;
};

const formatList = (values: string[]): string => (values.length > 0 ? values.join(', ') : '—');

const RolesTab: React.FC<RolesTabProps> = ({ projectName }) => {
  const [roles, setRoles] = React.useState<PlatformRoleKind[]>([]);
  const [boundRoleNames, setBoundRoleNames] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const [nextRoles, nextBindings] = await Promise.all([
          listPlatformRoles(),
          listPlatformRoleBindings(),
        ]);
        if (!cancelled) {
          setRoles(nextRoles.toSorted((a, b) => a.metadata.name.localeCompare(b.metadata.name)));
          const consoleRoleNames = new Set(nextRoles.map((role) => role.metadata.name));
          setBoundRoleNames(
            new Set(
              nextBindings
                .filter((binding) => {
                  if (!consoleRoleNames.has(binding.spec.platformRoleRef.name)) {
                    return false;
                  }
                  const target =
                    binding.status?.appliedTarget?.target ??
                    binding.spec.kubernetes?.target ??
                    'None';
                  const namespaces =
                    binding.status?.appliedTarget?.namespaces ??
                    binding.spec.kubernetes?.namespaces ??
                    [];
                  return (
                    target === 'Cluster' ||
                    (target === 'Namespaces' && namespaces.includes(projectName))
                  );
                })
                .map((binding) => binding.spec.platformRoleRef.name),
            ),
          );
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof K8sApiError ? err.message : 'Failed to load platform roles.');
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
        <EmptyState headingLevel="h2" titleText="No AI platform roles">
          <EmptyStateBody>
            Only PlatformRoles labeled nova-ai-console are shown. Apply nova-ai-admin,
            nova-ai-developer, or nova-ai-mlflow, then grant them on the Permissions tab.
          </EmptyStateBody>
        </EmptyState>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Table aria-label="Platform roles" variant="compact">
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>Persona</Th>
            <Th>Console services</Th>
            <Th>OIDC applications</Th>
            <Th>Phase</Th>
            <Th>Bound here</Th>
          </Tr>
        </Thead>
        <Tbody>
          {roles.map((role) => (
            <Tr key={role.metadata.name}>
              <Td dataLabel="Name">{role.metadata.name}</Td>
              <Td dataLabel="Persona">{personaFromRole(role) ?? '—'}</Td>
              <Td dataLabel="Console services">{formatList(servicesFromRole(role))}</Td>
              <Td dataLabel="OIDC applications">
                {formatList(role.spec?.oidc?.applications ?? [])}
              </Td>
              <Td dataLabel="Phase">{role.status?.phase ?? '—'}</Td>
              <Td dataLabel="Bound here">{boundRoleNames.has(role.metadata.name) ? 'Yes' : 'No'}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </PageSection>
  );
};

export default RolesTab;
