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
  Label,
  PageSection,
  Spinner,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  bindingAppliesToProject,
  componentOidcApplication,
  CONSOLE_OIDC_APPLICATION,
  CONSOLE_PERSONA_LABEL,
  KUBERNETES_ACCESS_PRESETS,
  OIDC_APPLICATION_NAME,
  oidcApplicationsWithConsole,
  type KubernetesAccessLevel,
} from '../../../auth/access';
import {
  createPlatformRole,
  dns1123Name,
  listPlatformRoleBindings,
  listPlatformRoles,
  updatePlatformRole,
} from '../../../auth/platformApi';
import type { PlatformRoleKind } from '../../../auth/types';
import { K8sApiError } from '../../../cluster/k8sClient';
import { consoleScopeLabels } from '../../../consoleScope';

type RolesTabProps = {
  projectName: string;
};

type RoleCreateAccess = Exclude<KubernetesAccessLevel, 'none'> | 'oidc';

const ACCESS_OPTIONS: Array<{ id: RoleCreateAccess; title: string }> = [
  ...(Object.keys(KUBERNETES_ACCESS_PRESETS) as Array<Exclude<KubernetesAccessLevel, 'none'>>).map(
    (id) => ({
      id,
      title: KUBERNETES_ACCESS_PRESETS[id].title,
    }),
  ),
  { id: 'oidc', title: 'OIDC client' },
];

const clusterRolesForRole = (role: PlatformRoleKind): string[] => {
  const resolved = role.status?.resolvedClusterRoles ?? [];
  if (resolved.length > 0) {
    return resolved;
  }
  return role.status?.aggregatedClusterRole ? [role.status.aggregatedClusterRole] : [];
};

const RolesTab: React.FC<RolesTabProps> = ({ projectName }) => {
  const [roles, setRoles] = React.useState<PlatformRoleKind[]>([]);
  const [boundRoleNames, setBoundRoleNames] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [name, setName] = React.useState('');
  const [accessLevel, setAccessLevel] = React.useState<RoleCreateAccess>('developer');
  const [isFormOpen, setIsFormOpen] = React.useState(false);
  const [applicationDrafts, setApplicationDrafts] = React.useState<Record<string, string>>({});
  const [savingRole, setSavingRole] = React.useState<string | null>(null);
  const [applicationError, setApplicationError] = React.useState<string | null>(null);

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
            .filter(
              (binding) =>
                consoleRoleNames.has(binding.spec.platformRoleRef.name) &&
                bindingAppliesToProject(binding, projectName),
            )
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
    setAccessLevel('developer');
    setIsFormOpen(false);
    setFormError(null);
  };

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setFormError('Role name is required.');
      return;
    }
    const isOidcClient = accessLevel === 'oidc';
    const roleName = isOidcClient ? trimmed : dns1123Name(trimmed);
    if (
      isOidcClient &&
      !/^nova-ai-(mlflow|airflow|jupyterhub)\.[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(roleName)
    ) {
      setFormError(
        'Name an instance role as nova-ai-mlflow.team-a, nova-ai-airflow.team-a, or nova-ai-jupyterhub.team-a.',
      );
      return;
    }
    const preset = isOidcClient ? undefined : KUBERNETES_ACCESS_PRESETS[accessLevel];
    const labels: Record<string, string> = { ...consoleScopeLabels() };
    if (preset?.persona) {
      labels[CONSOLE_PERSONA_LABEL] = preset.persona;
    }
    const clusterRoleSelectors = isOidcClient
      ? []
      : (preset?.selectors ?? []).map((key) => ({
          matchLabels: { [key]: 'true' },
        }));
    const applications = isOidcClient
      ? [componentOidcApplication(roleName)]
      : [CONSOLE_OIDC_APPLICATION];
    setIsSaving(true);
    try {
      await createPlatformRole({
        apiVersion: 'auth.nova-platform.io/v1alpha1',
        kind: 'PlatformRole',
        metadata: { name: roleName, labels },
        spec: {
          ...(clusterRoleSelectors.length > 0 ? { kubernetes: { clusterRoleSelectors } } : {}),
          oidc: {
            applications,
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

  const saveApplications = async (role: PlatformRoleKind, applications: string[]) => {
    const keepsConsole = (role.spec?.oidc?.applications ?? []).includes(CONSOLE_OIDC_APPLICATION);
    const next = keepsConsole
      ? oidcApplicationsWithConsole(applications)
      : [...new Set(applications.map((value) => value.trim()).filter((value) => value !== ''))];
    setApplicationError(null);
    setSavingRole(role.metadata.name);
    try {
      await updatePlatformRole({
        ...role,
        spec: {
          ...role.spec,
          oidc: { applications: next },
        },
      });
      setApplicationDrafts((current) => ({ ...current, [role.metadata.name]: '' }));
      await load();
    } catch (err) {
      setApplicationError(
        err instanceof K8sApiError || err instanceof Error
          ? err.message
          : 'Failed to update OIDC applications.',
      );
    } finally {
      setSavingRole(null);
    }
  };

  const addApplication = (role: PlatformRoleKind) => {
    const next = (applicationDrafts[role.metadata.name] ?? '').trim();
    if (!OIDC_APPLICATION_NAME.test(next)) {
      setApplicationError(
        'OIDC application name must start with a letter or digit and contain only letters, digits, ".", "_" and "-".',
      );
      return;
    }
    const current = role.spec?.oidc?.applications ?? [];
    if (current.includes(next)) {
      setApplicationDrafts((drafts) => ({ ...drafts, [role.metadata.name]: '' }));
      return;
    }
    void saveApplications(role, [...current, next]);
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
              placeholder={accessLevel === 'oidc' ? 'nova-ai-jupyterhub.team-a' : 'nova-ai-experiments'}
              isRequired
            />
          </FormGroup>
          <FormGroup label="Kubernetes access" isRequired fieldId="create-role-access">
            <FormSelect
              id="create-role-access"
              value={accessLevel}
              onChange={(_event, value) => setAccessLevel(value as RoleCreateAccess)}
              aria-label="Kubernetes access"
            >
              {ACCESS_OPTIONS.map((option) => (
                <FormSelectOption key={option.id} value={option.id} label={option.title} />
              ))}
            </FormSelect>
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  {accessLevel === 'oidc'
                    ? 'One role per instance, named nova-ai-mlflow.team-a, nova-ai-airflow.team-a, or nova-ai-jupyterhub.team-a. It logs into nova-ai-<component>-<namespace>. Bind admins, developers, and viewers to it. JupyterHub has no viewers group.'
                    : 'Admin can create projects and manage roles. Developer opens the bound projects. Component tabs follow OIDC groups, and KServe follows its own roles.'}
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
      {applicationError ? (
        <Alert variant="danger" isInline title="Could not update OIDC applications">
          {applicationError}
        </Alert>
      ) : null}
      <HelperText>
        <HelperTextItem>
          Console login stays on nova-ai-admin and nova-ai-developer. An instance role such as
          nova-ai-jupyterhub.team-a lists only nova-ai-jupyterhub-team-a. Groups
          nova-ai-jupyterhub.team-a.admins and .developers bind to it. MLflow and Airflow also
          have a .viewers group. The client must already exist in StarVault.
        </HelperTextItem>
      </HelperText>
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
              <Th>ClusterRole</Th>
              <Th>OIDC applications</Th>
              <Th>Phase</Th>
              <Th>Bound here</Th>
            </Tr>
          </Thead>
          <Tbody>
            {roles.map((role) => {
              return (
                <Tr key={role.metadata.name}>
                  <Td dataLabel="Name">{role.metadata.name}</Td>
                  <Td dataLabel="ClusterRole">
                    {clusterRolesForRole(role).join(', ') || '—'}
                  </Td>
                  <Td dataLabel="OIDC applications">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                        {(role.spec?.oidc?.applications ?? []).map((application) => (
                            <Label
                              key={application}
                              color={application === CONSOLE_OIDC_APPLICATION ? 'blue' : 'grey'}
                              onClose={
                                application === CONSOLE_OIDC_APPLICATION
                                  ? undefined
                                  : () => {
                                      void saveApplications(
                                        role,
                                        (role.spec?.oidc?.applications ?? []).filter(
                                          (item) => item !== application,
                                        ),
                                      );
                                    }
                              }
                            >
                              {application}
                            </Label>
                        ))}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <TextInput
                          aria-label={`OIDC application for ${role.metadata.name}`}
                          placeholder="nova-ai-mlflow-team-a"
                          value={applicationDrafts[role.metadata.name] ?? ''}
                          onChange={(_event, value) =>
                            setApplicationDrafts((drafts) => ({
                              ...drafts,
                              [role.metadata.name]: value,
                            }))
                          }
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              event.preventDefault();
                              addApplication(role);
                            }
                          }}
                        />
                        <Button
                          variant="secondary"
                          isDisabled={savingRole === role.metadata.name}
                          isLoading={savingRole === role.metadata.name}
                          onClick={() => addApplication(role)}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
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
