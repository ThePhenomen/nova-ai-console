import React from 'react';
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  PageSection,
  Spinner,
  TextInput,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  CONSOLE_PERSONA_LABEL,
  CONSOLE_SERVICE_LABEL,
  personaFromRole,
  servicesFromRole,
} from '../../../auth/access';
import {
  createPlatformRole,
  dns1123Name,
  listPlatformRoleBindings,
  listPlatformRoles,
} from '../../../auth/platformApi';
import type { ConsolePersona, PlatformRoleKind } from '../../../auth/types';
import { K8sApiError } from '../../../cluster/k8sClient';
import { consoleScopeLabels } from '../../../consoleScope';

type RolesTabProps = {
  projectName: string;
};

type PersonaChoice = 'none' | Exclude<ConsolePersona, 'none'>;

const PERSONA_OPTIONS: Array<{ value: PersonaChoice; label: string }> = [
  { value: 'none', label: 'None — service grant only (no console rights)' },
  { value: 'viewer', label: 'Viewer — read projects' },
  { value: 'developer', label: 'Developer — edit workbenches, pipelines, deployments' },
  { value: 'admin', label: 'Admin — create projects and manage roles' },
];

const DEVELOPER_SELECTOR = { matchLabels: { 'nova-ai.io/aggregate-to-developer': 'true' } };
const ADMIN_SELECTOR = { matchLabels: { 'nova-ai.io/aggregate-to-admin': 'true' } };

const formatList = (values: string[]): string => (values.length > 0 ? values.join(', ') : '—');

const parseCsv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

const kubernetesForPersona = (
  persona: PersonaChoice,
): { clusterRoleSelectors: Array<{ matchLabels: Record<string, string> }> } | undefined => {
  if (persona === 'admin') {
    return { clusterRoleSelectors: [DEVELOPER_SELECTOR, ADMIN_SELECTOR] };
  }
  if (persona === 'developer') {
    return { clusterRoleSelectors: [DEVELOPER_SELECTOR] };
  }
  return undefined;
};

const RolesTab: React.FC<RolesTabProps> = ({ projectName }) => {
  const [roles, setRoles] = React.useState<PlatformRoleKind[]>([]);
  const [boundRoleNames, setBoundRoleNames] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [name, setName] = React.useState('');
  const [persona, setPersona] = React.useState<PersonaChoice>('none');
  const [services, setServices] = React.useState('');

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextRoles, nextBindings] = await Promise.all([
        listPlatformRoles(),
        listPlatformRoleBindings(),
      ]);
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
                binding.status?.appliedTarget?.target ?? binding.spec.kubernetes?.target ?? 'None';
              const namespaces =
                binding.status?.appliedTarget?.namespaces ??
                binding.spec.kubernetes?.namespaces ??
                [];
              return (
                target === 'Cluster' || (target === 'Namespaces' && namespaces.includes(projectName))
              );
            })
            .map((binding) => binding.spec.platformRoleRef.name),
        ),
      );
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to load platform roles.');
      setRoles([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectName]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const roleName = dns1123Name(name.trim());
    if (!name.trim()) {
      setFormError('Role name is required.');
      return;
    }
    const serviceList = parseCsv(services);
    const labels: Record<string, string> = { ...consoleScopeLabels() };
    if (persona !== 'none') {
      labels[CONSOLE_PERSONA_LABEL] = persona;
    }
    if (serviceList.length > 0) {
      labels[CONSOLE_SERVICE_LABEL] = serviceList.join(',');
    }
    const kubernetes = kubernetesForPersona(persona);
    setIsSaving(true);
    try {
      await createPlatformRole({
        apiVersion: 'auth.nova-platform.io/v1alpha1',
        kind: 'PlatformRole',
        metadata: { name: roleName, labels },
        spec: {
          ...(kubernetes ? { kubernetes } : {}),
          oidc: {
            applications: ['nova-ai-console'],
          },
        },
      });
      setName('');
      setPersona('none');
      setServices('');
      await load();
    } catch (err) {
      setFormError(
        err instanceof K8sApiError || err instanceof Error
          ? err.message
          : 'Failed to create PlatformRole.',
      );
    } finally {
      setIsSaving(false);
    }
  };

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

  return (
    <PageSection>
      <Form onSubmit={create} style={{ marginBottom: '1.5rem', maxWidth: '40rem' }}>
        {formError ? (
          <Alert variant="danger" isInline title="Could not create role">
            {formError}
          </Alert>
        ) : null}
        <FormGroup label="Name" isRequired fieldId="create-role-name">
          <TextInput
            id="create-role-name"
            value={name}
            onChange={(_event, value) => setName(value)}
            placeholder="nova-ai-mlflow"
            isRequired
          />
        </FormGroup>
        <FormGroup label="Persona" fieldId="create-role-persona">
          <FormSelect
            id="create-role-persona"
            value={persona}
            onChange={(_event, value) => setPersona(value as PersonaChoice)}
            aria-label="Console persona"
          >
            {PERSONA_OPTIONS.map((option) => (
              <FormSelectOption key={option.value} value={option.value} label={option.label} />
            ))}
          </FormSelect>
          <FormHelperText>
            <HelperText>
              <HelperTextItem>
                Persona is a console mapping (`nova-ai.io/console-persona`), not Kubernetes RBAC.
                It decides what the signed-in user may do in Nova AI: create projects and manage
                Roles/Permissions (admin), edit project workloads (developer), or only view
                (viewer). Leave as None for a service role such as MLflow.
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>
        <FormGroup label="Console services" fieldId="create-role-services">
          <TextInput
            id="create-role-services"
            value={services}
            onChange={(_event, value) => setServices(value)}
            placeholder="mlflow"
          />
          <FormHelperText>
            <HelperText>
              <HelperTextItem>
                Optional. Comma-separated values written to `nova-ai.io/console-service`. Use
                mlflow to show the Experiments tab.
              </HelperTextItem>
            </HelperText>
          </FormHelperText>
        </FormGroup>
        <Button type="submit" variant="primary" isLoading={isSaving} isDisabled={isSaving}>
          Create platform role
        </Button>
      </Form>
      {roles.length === 0 ? (
        <EmptyState headingLevel="h2" titleText="No AI platform roles">
          <EmptyStateBody>
            Create a PlatformRole above, then grant it to a User or Group on the Permissions tab.
          </EmptyStateBody>
        </EmptyState>
      ) : (
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
      )}
    </PageSection>
  );
};

export default RolesTab;
