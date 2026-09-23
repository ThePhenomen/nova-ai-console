import React from 'react';
import {
  Alert,
  Bullseye,
  Button,
  Checkbox,
  EmptyState,
  EmptyStateBody,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  PageSection,
  Spinner,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  CONSOLE_OIDC_APPLICATION,
  CONSOLE_PERSONA_LABEL,
  canonicalConsoleService,
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
import { CONSOLE_TAB_SERVICES, consoleServiceEnabledLabel } from '../../../consoleServices';
import { consoleScopeLabels } from '../../../consoleScope';

type RolesTabProps = {
  projectName: string;
};

type SelectorRow = {
  key: string;
  value: string;
};

const emptySelector = (): SelectorRow => ({ key: '', value: '' });

const formatList = (values: string[]): string => (values.length > 0 ? values.join(', ') : '—');

const formatServices = (values: string[]): string =>
  formatList(
    values.map(
      (value) =>
        CONSOLE_TAB_SERVICES.find((item) => item.id === canonicalConsoleService(value))?.title ??
        value,
    ),
  );

const selectorsFromRows = (
  rows: SelectorRow[],
): Array<{ matchLabels: Record<string, string> }> =>
  rows
    .map((row) => ({ key: row.key.trim(), value: row.value.trim() }))
    .filter((row) => row.key !== '' && row.value !== '')
    .map((row) => ({ matchLabels: { [row.key]: row.value } }));

const RolesTab: React.FC<RolesTabProps> = ({ projectName }) => {
  const [roles, setRoles] = React.useState<PlatformRoleKind[]>([]);
  const [boundRoleNames, setBoundRoleNames] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [name, setName] = React.useState('');
  const [isAdminUi, setIsAdminUi] = React.useState(false);
  const [selectors, setSelectors] = React.useState<SelectorRow[]>([emptySelector()]);
  const [enabledServices, setEnabledServices] = React.useState<string[]>([]);
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

  const resetForm = () => {
    setName('');
    setIsAdminUi(false);
    setSelectors([emptySelector()]);
    setEnabledServices([]);
    setIsFormOpen(false);
    setFormError(null);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const roleName = dns1123Name(name.trim());
    if (!name.trim()) {
      setFormError('Role name is required.');
      return;
    }
    const labels: Record<string, string> = { ...consoleScopeLabels() };
    if (isAdminUi) {
      labels[CONSOLE_PERSONA_LABEL] = 'admin';
    }
    enabledServices.forEach((serviceId) => {
      labels[consoleServiceEnabledLabel(serviceId)] = 'true';
    });
    const clusterRoleSelectors = selectorsFromRows(selectors);
    setIsSaving(true);
    try {
      await createPlatformRole({
        apiVersion: 'auth.nova-platform.io/v1alpha1',
        kind: 'PlatformRole',
        metadata: { name: roleName, labels },
        spec: {
          ...(clusterRoleSelectors.length > 0 ? { kubernetes: { clusterRoleSelectors } } : {}),
          oidc: {
            applications: [CONSOLE_OIDC_APPLICATION],
          },
        },
      });
      resetForm();
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
              placeholder="nova-ai-experiments"
              isRequired
            />
          </FormGroup>
          <FormGroup fieldId="create-role-admin-ui">
            <Checkbox
              id="create-role-admin-ui"
              label="Admin in console"
              description="Adds nova-ai.io/console-persona: admin. Bound users can create projects and manage Roles/Permissions."
              isChecked={isAdminUi}
              onChange={(_event, checked) => setIsAdminUi(checked)}
            />
          </FormGroup>
          <FormGroup label="Cluster role selectors" fieldId="create-role-selectors">
            {selectors.map((row, index) => (
              <Flex
                key={`selector-${index}`}
                spaceItems={{ default: 'spaceItemsSm' }}
                style={{ marginBottom: '0.5rem' }}
              >
                <FlexItem flex={{ default: 'flex_1' }}>
                  <TextInput
                    aria-label={`Selector ${index + 1} key`}
                    value={row.key}
                    onChange={(_event, value) =>
                      setSelectors((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, key: value } : item,
                        ),
                      )
                    }
                    placeholder="nova-ai.io/aggregate-to-developer"
                  />
                </FlexItem>
                <FlexItem flex={{ default: 'flex_1' }}>
                  <TextInput
                    aria-label={`Selector ${index + 1} value`}
                    value={row.value}
                    onChange={(_event, value) =>
                      setSelectors((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, value } : item,
                        ),
                      )
                    }
                    placeholder="true"
                  />
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="plain"
                    icon={<MinusCircleIcon />}
                    onClick={() =>
                      setSelectors((current) =>
                        current.length === 1
                          ? [emptySelector()]
                          : current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    aria-label={`Remove selector ${index + 1}`}
                  />
                </FlexItem>
              </Flex>
            ))}
            <Button
              variant="link"
              icon={<PlusCircleIcon />}
              onClick={() => setSelectors((current) => [...current, emptySelector()])}
            >
              Add selector
            </Button>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Each row becomes one `matchLabels` entry in spec.kubernetes.clusterRoleSelectors.
                  Leave empty for an OIDC-only role.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Console services" fieldId="create-role-services">
            {CONSOLE_TAB_SERVICES.map((service) => (
              <Checkbox
                key={service.id}
                id={`create-role-service-${service.id}`}
                label={service.title}
                description={`Adds ${consoleServiceEnabledLabel(service.id)}: "true"`}
                isChecked={enabledServices.includes(service.id)}
                onChange={(_event, checked) =>
                  setEnabledServices((current) =>
                    checked
                      ? [...current, service.id]
                      : current.filter((item) => item !== service.id),
                  )
                }
              />
            ))}
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Unlocks the matching sidebar and project tabs. Projects is always shown.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <Button type="submit" variant="primary" isLoading={isSaving} isDisabled={isSaving}>
              Create
            </Button>
            <Button type="button" variant="link" onClick={resetForm} isDisabled={isSaving}>
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
                  <Td dataLabel="Console services">{formatServices(servicesFromRole(role))}</Td>
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
