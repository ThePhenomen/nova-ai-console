import React from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { K8sApiError } from '../../cluster/k8sClient';
import { createProject, NAMESPACE_NAME_PATTERN, type ProjectQuotaInput } from './projectApi';

type CreateProjectModalProps = {
  onClose: () => void;
  onCreated: (name: string) => void;
};

const emptyQuota: ProjectQuotaInput = {
  cpuRequest: '2',
  cpuLimit: '4',
  memoryRequest: '4Gi',
  memoryLimit: '8Gi',
  pods: '20',
};

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ onClose, onCreated }) => {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [quota, setQuota] = React.useState<ProjectQuotaInput>(emptyQuota);
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const updateQuota = (field: keyof ProjectQuotaInput, value: string) => {
    setQuota((current) => ({ ...current, [field]: value }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    if (!NAMESPACE_NAME_PATTERN.test(trimmedName) || trimmedName.length > 63) {
      setError(
        'Name must be 1-63 characters, start and end with a lowercase letter or number, and may contain hyphens.',
      );
      return;
    }

    setIsSaving(true);
    try {
      await createProject({ name: trimmedName, description, quota });
      onCreated(trimmedName);
    } catch (err) {
      setError(
        err instanceof K8sApiError || err instanceof Error
          ? err.message
          : 'Failed to create project.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal isOpen variant="medium" onClose={onClose} aria-label="Create project">
      <ModalHeader
        title="Create project"
        description="A project is a Kubernetes namespace with a resource quota and optional description."
      />
      <ModalBody>
        <Form id="create-project-form" onSubmit={submit}>
          {error ? (
            <Alert variant="danger" isInline title="Could not create project">
              {error}
            </Alert>
          ) : null}
          <FormGroup label="Name" isRequired fieldId="project-name">
            <TextInput
              id="project-name"
              value={name}
              onChange={(_event, value) => setName(value)}
              placeholder="ml-team"
              isRequired
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>Lowercase Kubernetes namespace name.</HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Description" fieldId="project-description">
            <TextArea
              id="project-description"
              value={description}
              onChange={(_event, value) => setDescription(value)}
              rows={3}
            />
          </FormGroup>
          <FormGroup label="CPU request" fieldId="quota-cpu-request">
            <TextInput
              id="quota-cpu-request"
              value={quota.cpuRequest}
              onChange={(_event, value) => updateQuota('cpuRequest', value)}
              placeholder="2"
            />
          </FormGroup>
          <FormGroup label="CPU limit" fieldId="quota-cpu-limit">
            <TextInput
              id="quota-cpu-limit"
              value={quota.cpuLimit}
              onChange={(_event, value) => updateQuota('cpuLimit', value)}
              placeholder="4"
            />
          </FormGroup>
          <FormGroup label="Memory request" fieldId="quota-memory-request">
            <TextInput
              id="quota-memory-request"
              value={quota.memoryRequest}
              onChange={(_event, value) => updateQuota('memoryRequest', value)}
              placeholder="4Gi"
            />
          </FormGroup>
          <FormGroup label="Memory limit" fieldId="quota-memory-limit">
            <TextInput
              id="quota-memory-limit"
              value={quota.memoryLimit}
              onChange={(_event, value) => updateQuota('memoryLimit', value)}
              placeholder="8Gi"
            />
          </FormGroup>
          <FormGroup label="Max pods" fieldId="quota-pods">
            <TextInput
              id="quota-pods"
              value={quota.pods}
              onChange={(_event, value) => updateQuota('pods', value)}
              placeholder="20"
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          key="create"
          variant="primary"
          type="submit"
          form="create-project-form"
          isLoading={isSaving}
          isDisabled={isSaving}
        >
          Create
        </Button>
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default CreateProjectModal;
