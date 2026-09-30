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
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  PageSection,
  Popover,
  Spinner,
  TextInput,
  Toolbar,
  ToolbarContent,
  ToolbarItem,
} from '@patternfly/react-core';
import { OutlinedQuestionCircleIcon } from '@patternfly/react-icons';
import { ActionsColumn, Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  bindingAppliesToProject,
  componentOidcApplication,
  CONSOLE_OIDC_APPLICATION,
  CONSOLE_PERSONA_LABEL,
  KUBERNETES_ACCESS_PRESETS,
  OIDC_APPLICATION_NAME,
  kubernetesAccessFromRole,
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

const applicationsForAccess = (accessLevel: RoleCreateAccess, roleName: string): string[] =>
  accessLevel === 'oidc' && roleName
    ? [componentOidcApplication(roleName)]
    : [CONSOLE_OIDC_APPLICATION];

const RolesTab: React.FC<RolesTabProps> = ({ projectName }) => {
  const [roles, setRoles] = React.useState<PlatformRoleKind[]>([]);
  const [boundRoleNames, setBoundRoleNames] = React.useState<Set<string>>(new Set());
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [editingRole, setEditingRole] = React.useState<PlatformRoleKind | null>(null);
  const [name, setName] = React.useState('');
  const [accessLevel, setAccessLevel] = React.useState<RoleCreateAccess>('developer');
  const [applications, setApplications] = React.useState<string[]>([]);
  const [applicationDraft, setApplicationDraft] = React.useState('');

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

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingRole(null);
    setName('');
    setAccessLevel('developer');
    setApplications([]);
    setApplicationDraft('');
    setFormError(null);
  };

  const openCreate = () => {
    setEditingRole(null);
    setName('');
    setAccessLevel('developer');
    setApplications(applicationsForAccess('developer', ''));
    setApplicationDraft('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (role: PlatformRoleKind) => {
    const level = kubernetesAccessFromRole(role);
    setEditingRole(role);
    setName(role.metadata.name);
    setAccessLevel(level === 'none' ? 'oidc' : level);
    setApplications([...(role.spec?.oidc?.applications ?? [])]);
    setApplicationDraft('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const addDraftApplication = () => {
    const next = applicationDraft.trim();
    if (!OIDC_APPLICATION_NAME.test(next)) {
      setFormError(
        'OIDC application name must start with a letter or digit and contain only letters, digits, ".", "_" and "-".',
      );
      return;
    }
    setFormError(null);
    setApplications((current) => (current.includes(next) ? current : [...current, next]));
    setApplicationDraft('');
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const trimmed = name.trim().toLowerCase();
    if (!trimmed) {
      setFormError('Role name is required.');
      return;
    }
    const isOidcClient = accessLevel === 'oidc';
    const roleName = editingRole?.metadata.name ?? (isOidcClient ? trimmed : dns1123Name(trimmed));
    if (
      !editingRole &&
      isOidcClient &&
      !/^nova-ai-(mlflow|airflow|jupyterhub)\.[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(roleName)
    ) {
      setFormError(
        'Name an instance role as nova-ai-mlflow.team-a, nova-ai-airflow.team-a, or nova-ai-jupyterhub.team-a.',
      );
      return;
    }
    const keepsConsole = (editingRole?.spec?.oidc?.applications ?? applications).includes(
      CONSOLE_OIDC_APPLICATION,
    );
    const nextApplications = keepsConsole
      ? oidcApplicationsWithConsole(applications)
      : [...new Set(applications.map((value) => value.trim()).filter((value) => value !== ''))];
    setIsSaving(true);
    try {
      if (editingRole) {
        await updatePlatformRole({
          ...editingRole,
          spec: {
            ...editingRole.spec,
            oidc: { applications: nextApplications },
          },
        });
      } else {
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
        await createPlatformRole({
          apiVersion: 'auth.nova-platform.io/v1alpha1',
          kind: 'PlatformRole',
          metadata: { name: roleName, labels },
          spec: {
            ...(clusterRoleSelectors.length > 0 ? { kubernetes: { clusterRoleSelectors } } : {}),
            oidc: { applications: nextApplications },
          },
        });
      }
      closeModal();
      await load();
    } catch (err) {
      setFormError(
        err instanceof K8sApiError || err instanceof Error
          ? err.message
          : editingRole
            ? 'Failed to update PlatformRole.'
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
      <Toolbar>
        <ToolbarContent>
          <ToolbarItem>
            <Button variant="primary" onClick={openCreate}>
              Create platform role
            </Button>
          </ToolbarItem>
        </ToolbarContent>
      </Toolbar>
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
              <Th>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                  Bound here
                  <Popover
                    aria-label="About Bound here"
                    bodyContent="Yes means a PlatformRoleBinding for this role applies to this project. No means the role exists, but it is not granted here. Grant it on the Permissions tab."
                  >
                    <Button variant="plain" aria-label="About Bound here" style={{ padding: 0 }}>
                      <OutlinedQuestionCircleIcon />
                    </Button>
                  </Popover>
                </span>
              </Th>
              <Th screenReaderText="Actions" />
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
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                      {(role.spec?.oidc?.applications ?? []).length > 0
                        ? (role.spec?.oidc?.applications ?? []).map((application) => (
                            <Label
                              key={application}
                              color={application === CONSOLE_OIDC_APPLICATION ? 'blue' : 'grey'}
                            >
                              {application}
                            </Label>
                          ))
                        : '—'}
                    </div>
                  </Td>
                  <Td dataLabel="Phase">{role.status?.phase ?? '—'}</Td>
                  <Td dataLabel="Bound here">{boundRoleNames.has(role.metadata.name) ? 'Yes' : 'No'}</Td>
                  <Td isActionCell>
                    <ActionsColumn
                      items={[
                        {
                          title: 'Edit',
                          onClick: (event) => {
                            event?.preventDefault();
                            event?.stopPropagation();
                            openEdit(role);
                          },
                        },
                      ]}
                    />
                  </Td>
                </Tr>
              );
            })}
          </Tbody>
        </Table>
      )}
      {isModalOpen ? (
        <Modal
          isOpen
          variant="medium"
          onClose={closeModal}
          aria-label={editingRole ? 'Edit platform role' : 'Create platform role'}
        >
          <ModalHeader title={editingRole ? 'Edit platform role' : 'Create platform role'} />
          <ModalBody>
            <Form id="platform-role-form" onSubmit={save}>
              {formError ? (
                <Alert variant="danger" isInline title={editingRole ? 'Could not update role' : 'Could not create role'}>
                  {formError}
                </Alert>
              ) : null}
              <FormGroup label="Name" isRequired fieldId="role-name">
                <TextInput
                  id="role-name"
                  value={name}
                  onChange={(_event, value) => setName(value)}
                  placeholder={accessLevel === 'oidc' ? 'nova-ai-jupyterhub.team-a' : 'nova-ai-experiments'}
                  isRequired
                  isDisabled={editingRole !== null || isSaving}
                />
              </FormGroup>
              {editingRole ? null : (
                <FormGroup label="Kubernetes access" isRequired fieldId="role-access">
                  <FormSelect
                    id="role-access"
                    value={accessLevel}
                    onChange={(_event, value) => {
                      const next = value as RoleCreateAccess;
                      setAccessLevel(next);
                      setApplications(applicationsForAccess(next, name.trim().toLowerCase()));
                    }}
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
                          ? 'One role per instance, named nova-ai-mlflow.team-a, nova-ai-airflow.team-a, or nova-ai-jupyterhub.team-a. It logs into nova-ai-<component>-<namespace>.'
                          : 'Admin can create projects and manage roles. Developer opens the bound projects.'}
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </FormGroup>
              )}
              <FormGroup label="OIDC applications" fieldId="role-applications">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {applications.map((application) => (
                      <Label
                        key={application}
                        color={application === CONSOLE_OIDC_APPLICATION ? 'blue' : 'grey'}
                        onClose={
                          application === CONSOLE_OIDC_APPLICATION
                            ? undefined
                            : () => setApplications((current) => current.filter((item) => item !== application))
                        }
                      >
                        {application}
                      </Label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <TextInput
                      id="role-applications"
                      aria-label="OIDC application"
                      placeholder="nova-ai-mlflow-team-a"
                      value={applicationDraft}
                      onChange={(_event, value) => setApplicationDraft(value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addDraftApplication();
                        }
                      }}
                    />
                    <Button variant="secondary" type="button" onClick={addDraftApplication}>
                      Add
                    </Button>
                  </div>
                </div>
              </FormGroup>
            </Form>
          </ModalBody>
          <ModalFooter>
            <Button type="submit" form="platform-role-form" variant="primary" isLoading={isSaving} isDisabled={isSaving}>
              {editingRole ? 'Save' : 'Create'}
            </Button>
            <Button variant="link" onClick={closeModal} isDisabled={isSaving}>
              Cancel
            </Button>
          </ModalFooter>
        </Modal>
      ) : null}
    </PageSection>
  );
};

export default RolesTab;
