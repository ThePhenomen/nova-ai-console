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
  CONSOLE_OIDC_APPLICATION,
  OIDC_APPLICATION_NAME,
} from '../../../auth/access';
import {
  createPlatformRole,
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

type SelectorDraft = { key: string; value: string };

const clusterRolesForRole = (role: PlatformRoleKind): string[] => {
  const resolved = role.status?.resolvedClusterRoles ?? [];
  if (resolved.length > 0) {
    return resolved;
  }
  return role.status?.aggregatedClusterRole ? [role.status.aggregatedClusterRole] : [];
};

const selectorsFromRole = (role: PlatformRoleKind): SelectorDraft[] =>
  (role.spec?.kubernetes?.clusterRoleSelectors ?? []).flatMap((selector) =>
    Object.entries(selector.matchLabels ?? {}).map(([key, value]) => ({ key, value })),
  );

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
  const [selectors, setSelectors] = React.useState<SelectorDraft[]>([]);
  const [selectorKey, setSelectorKey] = React.useState('');
  const [selectorValue, setSelectorValue] = React.useState('true');
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
    setSelectors([]);
    setSelectorKey('');
    setSelectorValue('true');
    setApplications([]);
    setApplicationDraft('');
    setFormError(null);
  };

  const openCreate = () => {
    setEditingRole(null);
    setName('');
    setSelectors([]);
    setSelectorKey('');
    setSelectorValue('true');
    setApplications([]);
    setApplicationDraft('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const openEdit = (role: PlatformRoleKind) => {
    setEditingRole(role);
    setName(role.metadata.name);
    setSelectors(selectorsFromRole(role));
    setSelectorKey('');
    setSelectorValue('true');
    setApplications([...(role.spec?.oidc?.applications ?? [])]);
    setApplicationDraft('');
    setFormError(null);
    setIsModalOpen(true);
  };

  const addSelector = () => {
    const key = selectorKey.trim();
    const value = selectorValue.trim();
    if (!key || !value) {
      setFormError('A ClusterRole selector needs a label key and a value.');
      return;
    }
    setFormError(null);
    setSelectors((current) =>
      current.some((item) => item.key === key && item.value === value) ? current : [...current, { key, value }],
    );
    setSelectorKey('');
    setSelectorValue('true');
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
    const roleName = editingRole?.metadata.name ?? trimmed;
    if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(roleName)) {
      setFormError('Use a name of lowercase letters, digits, "." and "-", starting and ending with a letter or digit.');
      return;
    }
    const nextApplications = [
      ...new Set(applications.map((value) => value.trim()).filter((value) => value !== '')),
    ];
    const clusterRoleSelectors = selectors
      .map((selector) => ({ key: selector.key.trim(), value: selector.value.trim() }))
      .filter((selector) => selector.key !== '' && selector.value !== '')
      .map((selector) => ({ matchLabels: { [selector.key]: selector.value } }));
    if (nextApplications.length === 0 && clusterRoleSelectors.length === 0) {
      setFormError('Add a ClusterRole selector or an OIDC application.');
      return;
    }
    setIsSaving(true);
    try {
      const spec = {
        ...(clusterRoleSelectors.length > 0 ? { kubernetes: { clusterRoleSelectors } } : {}),
        ...(nextApplications.length > 0 ? { oidc: { applications: nextApplications } } : {}),
      };
      if (editingRole) {
        await updatePlatformRole({
          ...editingRole,
          spec: {
            ...editingRole.spec,
            kubernetes: clusterRoleSelectors.length > 0 ? { clusterRoleSelectors } : undefined,
            oidc: nextApplications.length > 0 ? { applications: nextApplications } : undefined,
          },
        });
      } else {
        await createPlatformRole({
          apiVersion: 'auth.nova-platform.io/v1alpha1',
          kind: 'PlatformRole',
          metadata: { name: roleName, labels: consoleScopeLabels() },
          spec,
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
                  placeholder="nova-ai-mlflow.ml-team"
                  isRequired
                  isDisabled={editingRole !== null || isSaving}
                />
              </FormGroup>
              <FormGroup label="ClusterRole selectors" fieldId="role-selectors">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {selectors.map((selector) => (
                      <Label
                        key={`${selector.key}=${selector.value}`}
                        onClose={() =>
                          setSelectors((current) =>
                            current.filter((item) => item.key !== selector.key || item.value !== selector.value),
                          )
                        }
                      >
                        {selector.key}={selector.value}
                      </Label>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <TextInput
                      id="role-selectors"
                      aria-label="ClusterRole selector label"
                      placeholder="nova-ai.io/aggregate-to-admin"
                      value={selectorKey}
                      onChange={(_event, value) => setSelectorKey(value)}
                    />
                    <TextInput
                      aria-label="ClusterRole selector value"
                      placeholder="true"
                      value={selectorValue}
                      onChange={(_event, value) => setSelectorValue(value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addSelector();
                        }
                      }}
                    />
                    <Button variant="secondary" type="button" onClick={addSelector}>
                      Add
                    </Button>
                  </div>
                  <FormHelperText>
                    <HelperText>
                      <HelperTextItem>
                        Each entry is one clusterRoleSelector matchLabels pair. Nothing is added until you press Add.
                      </HelperTextItem>
                    </HelperText>
                  </FormHelperText>
                </div>
              </FormGroup>
              <FormGroup label="OIDC applications" fieldId="role-applications">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {applications.map((application) => (
                      <Label
                        key={application}
                        color="grey"
                        onClose={() => setApplications((current) => current.filter((item) => item !== application))}
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
