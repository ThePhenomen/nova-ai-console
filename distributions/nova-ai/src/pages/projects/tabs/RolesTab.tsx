import React from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Checkbox,
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
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  CONSOLE_PERSONA_LABEL,
  CONSOLE_SERVICE_LABEL,
  consoleRoleFromPlatformRole,
  servicesFromRole,
} from '../../../auth/access';
import {
  createPlatformRole,
  dns1123Name,
  listPlatformRoleBindings,
  listPlatformRoles,
} from '../../../auth/platformApi';
import type { PlatformRoleKind } from '../../../auth/types';
import { K8sApiError } from '../../../cluster/k8sClient';
import { consoleScopeLabels } from '../../../consoleScope';

type RolesTabProps = {
  projectName: string;
};

type RoleKindChoice = 'service' | 'contributor';

const ROLE_KIND_OPTIONS: Array<{ value: RoleKindChoice; label: string }> = [
  { value: 'contributor', label: 'Contributor — Kubernetes project access' },
  { value: 'service', label: 'Service only — extra sidebar tabs (for example MLflow)' },
];

const CONTRIBUTOR_SELECTOR = { matchLabels: { 'nova-ai.io/aggregate-to-developer': 'true' } };
const ADMIN_SELECTOR = { matchLabels: { 'nova-ai.io/aggregate-to-admin': 'true' } };

const formatList = (values: string[]): string => (values.length > 0 ? values.join(', ') : '—');

const parseCsv = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');

const kubernetesForKind = (
  kind: RoleKindChoice,
  isAdminUi: boolean,
): { clusterRoleSelectors: Array<{ matchLabels: Record<string, string> }> } | undefined => {
  if (isAdminUi) {
    return { clusterRoleSelectors: [CONTRIBUTOR_SELECTOR, ADMIN_SELECTOR] };
  }
  if (kind === 'contributor') {
    return { clusterRoleSelectors: [CONTRIBUTOR_SELECTOR] };
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
  const [roleKind, setRoleKind] = React.useState<RoleKindChoice>('contributor');
  const [isAdminUi, setIsAdminUi] = React.useState(false);
  const [services, setServices] = React.useState('');
  const [isFormOpen, setIsFormOpen] = React.useState(false);

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
    if (isAdminUi) {
      labels[CONSOLE_PERSONA_LABEL] = 'admin';
    }
    if (serviceList.length > 0) {
      labels[CONSOLE_SERVICE_LABEL] = serviceList.join(',');
    }
    const kubernetes = kubernetesForKind(roleKind, isAdminUi);
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
      setRoleKind('contributor');
      setIsAdminUi(false);
      setServices('');
      setIsFormOpen(false);
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
      {formError ? (
        <Alert variant="danger" isInline title="Could not create role" style={{ marginBottom: '1rem' }}>
          {formError}
        </Alert>
      ) : null}
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Button
              variant="primary"
              onClick={() => {
                setFormError(null);
                setIsFormOpen(true);
              }}
              isDisabled={isFormOpen}
            >
              Create platform role
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
      {isFormOpen ? (
        <Form onSubmit={create} style={{ marginBottom: '1.5rem', maxWidth: '40rem' }}>
          <FormGroup label="Name" isRequired fieldId="create-role-name">
            <TextInput
              id="create-role-name"
              value={name}
              onChange={(_event, value) => setName(value)}
              placeholder="nova-ai-mlflow"
              isRequired
            />
          </FormGroup>
          <FormGroup label="Kubernetes access" fieldId="create-role-kind">
            <FormSelect
              id="create-role-kind"
              value={isAdminUi ? 'contributor' : roleKind}
              onChange={(_event, value) => setRoleKind(value as RoleKindChoice)}
              aria-label="Kubernetes access"
              isDisabled={isAdminUi}
            >
              {ROLE_KIND_OPTIONS.map((option) => (
                <FormSelectOption key={option.value} value={option.value} label={option.label} />
              ))}
            </FormSelect>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Aggregation selectors for Kubernetes RBAC. Independent of the admin console
                  marker below.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup fieldId="create-role-admin-ui">
            <Checkbox
              id="create-role-admin-ui"
              label="Admin in console"
              description="Adds nova-ai.io/console-persona: admin. Bound users can create projects and manage Roles/Permissions. Leave unchecked for normal contributor UI."
              isChecked={isAdminUi}
              onChange={(_event, checked) => setIsAdminUi(checked)}
            />
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
                  Optional. Comma-separated values for extra sidebar tabs. Use mlflow for
                  Experiments. The Projects tab is always shown.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button type="submit" variant="primary" isLoading={isSaving} isDisabled={isSaving}>
              Create
            </Button>
            <Button
              type="button"
              variant="link"
              onClick={() => {
                setIsFormOpen(false);
                setFormError(null);
              }}
              isDisabled={isSaving}
            >
              Cancel
            </Button>
          </div>
        </Form>
      ) : null}
      {roles.length === 0 ? (
        <EmptyState headingLevel="h2" titleText="No AI platform roles">
          <EmptyStateBody>
            Create a PlatformRole, then grant it to a User or Group on the Permissions tab.
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="Platform roles" variant="compact">
          <Thead>
            <Tr>
              <Th>Name</Th>
              <Th>Console access</Th>
              <Th>Console services</Th>
              <Th>OIDC applications</Th>
              <Th>Phase</Th>
              <Th>Bound here</Th>
            </Tr>
          </Thead>
          <Tbody>
            {roles.map((role) => {
              const access = consoleRoleFromPlatformRole(role);
              return (
                <Tr key={role.metadata.name}>
                  <Td dataLabel="Name">{role.metadata.name}</Td>
                  <Td dataLabel="Console access">{access === 'none' ? 'service' : access}</Td>
                  <Td dataLabel="Console services">{formatList(servicesFromRole(role))}</Td>
                  <Td dataLabel="OIDC applications">
                    {formatList(role.spec?.oidc?.applications ?? [])}
                  </Td>
                  <Td dataLabel="Phase">{role.status?.phase ?? '—'}</Td>
                  <Td dataLabel="Bound here">
                    {boundRoleNames.has(role.metadata.name) ? 'Yes' : 'No'}
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
    </PageSection>
  );
};

export default RolesTab;
