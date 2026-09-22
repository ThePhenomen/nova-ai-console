import React from 'react';
import {
  Alert,
  Bullseye,
  Button,
  EmptyState,
  EmptyStateBody,
  Form,
  FormGroup,
  FormSelect,
  FormSelectOption,
  PageSection,
  Radio,
  Spinner,
  TextInput,
} from '@patternfly/react-core';
import { Table, Thead, Tr, Th, Tbody, Td } from '@patternfly/react-table';
import {
  createPlatformRoleBinding,
  deletePlatformRoleBinding,
  dns1123Name,
  listPlatformRoleBindings,
  listPlatformRoles,
} from '../../../auth/platformApi';
import type { PlatformRoleBindingKind, PlatformRoleKind } from '../../../auth/types';
import { K8sApiError } from '../../../cluster/k8sClient';
import { consoleScopeLabels } from '../../../consoleScope';

type PermissionsTabProps = {
  projectName: string;
};

const formatSubjects = (binding: PlatformRoleBindingKind): string => {
  const subjects =
    binding.status?.resolvedSubjects && binding.status.resolvedSubjects.length > 0
      ? binding.status.resolvedSubjects
      : binding.spec.subjects;
  if (subjects.length === 0) {
    return '—';
  }
  return subjects
    .map((subject) => {
      if (subject.identity) {
        return `${subject.kind}/${subject.name} (${subject.identity})`;
      }
      if (subject.namespace) {
        return `${subject.kind}/${subject.namespace}/${subject.name}`;
      }
      return `${subject.kind}/${subject.name}`;
    })
    .join(', ');
};

const bindingTarget = (binding: PlatformRoleBindingKind): string => {
  const target = binding.status?.appliedTarget?.target ?? binding.spec.kubernetes?.target ?? 'None';
  const namespaces =
    binding.status?.appliedTarget?.namespaces ?? binding.spec.kubernetes?.namespaces ?? [];
  if (target === 'Namespaces') {
    return `Namespaces (${namespaces.join(', ') || '—'})`;
  }
  return String(target);
};

const appliesToProject = (binding: PlatformRoleBindingKind, projectName: string): boolean => {
  const target = binding.status?.appliedTarget?.target ?? binding.spec.kubernetes?.target ?? 'None';
  const namespaces =
    binding.status?.appliedTarget?.namespaces ?? binding.spec.kubernetes?.namespaces ?? [];
  return target === 'Cluster' || (target === 'Namespaces' && namespaces.includes(projectName));
};

const canRevokeInProject = (binding: PlatformRoleBindingKind, projectName: string): boolean => {
  const target = binding.spec.kubernetes?.target ?? 'None';
  const namespaces = binding.spec.kubernetes?.namespaces ?? [];
  return target === 'Namespaces' && namespaces.length === 1 && namespaces[0] === projectName;
};

const PermissionsTab: React.FC<PermissionsTabProps> = ({ projectName }) => {
  const [roles, setRoles] = React.useState<PlatformRoleKind[]>([]);
  const [bindings, setBindings] = React.useState<PlatformRoleBindingKind[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSaving, setIsSaving] = React.useState(false);
  const [subjectKind, setSubjectKind] = React.useState<'User' | 'Group'>('User');
  const [subjectName, setSubjectName] = React.useState('');
  const [roleName, setRoleName] = React.useState('');

  const load = React.useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [nextRoles, nextBindings] = await Promise.all([
        listPlatformRoles(),
        listPlatformRoleBindings(),
      ]);
      const sortedRoles = nextRoles.toSorted((a, b) =>
        a.metadata.name.localeCompare(b.metadata.name),
      );
      const consoleRoleNames = new Set(sortedRoles.map((role) => role.metadata.name));
      setRoles(sortedRoles);
      setBindings(
        nextBindings
          .filter(
            (binding) =>
              consoleRoleNames.has(binding.spec.platformRoleRef.name) &&
              appliesToProject(binding, projectName),
          )
          .toSorted((a, b) => a.metadata.name.localeCompare(b.metadata.name)),
      );
      setRoleName((current) => current || sortedRoles[0]?.metadata.name || '');
    } catch (err) {
      setError(err instanceof K8sApiError ? err.message : 'Failed to load permissions.');
      setBindings([]);
    } finally {
      setIsLoading(false);
    }
  }, [projectName]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const grant = async (event: React.FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const name = subjectName.trim();
    if (!name || !roleName) {
      setFormError('Subject name and platform role are required.');
      return;
    }
    setIsSaving(true);
    try {
      await createPlatformRoleBinding({
        apiVersion: 'auth.nova-platform.io/v1alpha1',
        kind: 'PlatformRoleBinding',
        metadata: {
          name: dns1123Name(`${projectName}-${name}-${roleName}`),
          labels: consoleScopeLabels(),
        },
        spec: {
          platformRoleRef: { name: roleName },
          subjects: [{ kind: subjectKind, name }],
          kubernetes: {
            target: 'Namespaces',
            namespaces: [projectName],
          },
        },
      });
      setSubjectName('');
      await load();
    } catch (err) {
      setFormError(
        err instanceof K8sApiError || err instanceof Error
          ? err.message
          : 'Failed to create PlatformRoleBinding.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const revoke = async (name: string) => {
    setFormError(null);
    setIsSaving(true);
    try {
      await deletePlatformRoleBinding(name);
      await load();
    } catch (err) {
      setFormError(
        err instanceof K8sApiError || err instanceof Error
          ? err.message
          : 'Failed to delete PlatformRoleBinding.',
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
        <Alert variant="danger" isInline title="Could not load permissions">
          {error}
        </Alert>
      </PageSection>
    );
  }

  return (
    <PageSection>
      <Form onSubmit={grant} style={{ marginBottom: '1.5rem', maxWidth: '40rem' }}>
        {formError ? (
          <Alert variant="danger" isInline title="Could not update permissions">
            {formError}
          </Alert>
        ) : null}
        <FormGroup role="radiogroup" isInline fieldId="grant-subject-kind" label="Subject">
          <Radio
            id="grant-subject-user"
            name="grant-subject-kind"
            label="User"
            isChecked={subjectKind === 'User'}
            onChange={() => setSubjectKind('User')}
          />
          <Radio
            id="grant-subject-group"
            name="grant-subject-kind"
            label="Group"
            isChecked={subjectKind === 'Group'}
            onChange={() => setSubjectKind('Group')}
          />
        </FormGroup>
        <FormGroup label="Name" isRequired fieldId="grant-subject-name">
          <TextInput
            id="grant-subject-name"
            value={subjectName}
            onChange={(_event, value) => setSubjectName(value)}
            placeholder={subjectKind === 'Group' ? 'platform-admins' : 'alice'}
            isRequired
          />
        </FormGroup>
        <FormGroup label="Platform role" isRequired fieldId="grant-role">
          <FormSelect
            id="grant-role"
            value={roleName}
            onChange={(_event, value) => setRoleName(value)}
            aria-label="Platform role"
          >
            {roles.map((role) => (
              <FormSelectOption key={role.metadata.name} value={role.metadata.name} label={role.metadata.name} />
            ))}
          </FormSelect>
        </FormGroup>
        <Button type="submit" variant="primary" isLoading={isSaving} isDisabled={isSaving || roles.length === 0}>
          Grant access in this project
        </Button>
      </Form>
      {bindings.length === 0 ? (
        <EmptyState headingLevel="h2" titleText="No permissions">
          <EmptyStateBody>
            Grant a Nova AI PlatformRole to a User or Group in this project. Use nova-ai-mlflow
            for the MLflow tab in this project only.
          </EmptyStateBody>
        </EmptyState>
      ) : (
        <Table aria-label="Platform role bindings" variant="compact">
          <Thead>
            <Tr>
              <Th>Binding</Th>
              <Th>Role</Th>
              <Th>Subjects</Th>
              <Th>Target</Th>
              <Th>Phase</Th>
              <Th>Actions</Th>
            </Tr>
          </Thead>
          <Tbody>
            {bindings.map((binding) => (
              <Tr key={binding.metadata.name}>
                <Td dataLabel="Binding">{binding.metadata.name}</Td>
                <Td dataLabel="Role">{binding.spec.platformRoleRef.name}</Td>
                <Td dataLabel="Subjects">{formatSubjects(binding)}</Td>
                <Td dataLabel="Target">{bindingTarget(binding)}</Td>
                <Td dataLabel="Phase">{binding.status?.phase ?? '—'}</Td>
                <Td dataLabel="Actions">
                  {canRevokeInProject(binding, projectName) ? (
                    <Button
                      variant="link"
                      isDanger
                      isDisabled={isSaving}
                      onClick={() => void revoke(binding.metadata.name)}
                    >
                      Revoke
                    </Button>
                  ) : (
                    'Inherited'
                  )}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </PageSection>
  );
};

export default PermissionsTab;
