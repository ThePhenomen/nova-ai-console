import React from 'react';
import {
  Alert,
  Button,
  Flex,
  FlexItem,
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
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';
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
  accelerators: [{ resource: '', quantity: '' }],
};

type QuotaScalar = Exclude<keyof ProjectQuotaInput, 'accelerators'>;

const CreateProjectModal: React.FC<CreateProjectModalProps> = ({ onClose, onCreated }) => {
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [quota, setQuota] = React.useState<ProjectQuotaInput>(emptyQuota);
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const updateQuota = (field: QuotaScalar, value: string) => {
    setQuota((current) => ({ ...current, [field]: value }));
  };

  const updateAccelerator = (index: number, field: 'resource' | 'quantity', value: string) => {
    setQuota((current) => ({
      ...current,
      accelerators: current.accelerators.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: value } : row,
      ),
    }));
  };

  const addAccelerator = () => {
    setQuota((current) => ({
      ...current,
      accelerators: [...current.accelerators, { resource: '', quantity: '' }],
    }));
  };

  const removeAccelerator = (index: number) => {
    setQuota((current) => ({
      ...current,
      accelerators: current.accelerators.filter((_row, rowIndex) => rowIndex !== index),
    }));
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
        description="A project is a Kubernetes namespace labeled nova-ai.io/console=nova-ai-console, with a resource quota and optional description."
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
          <FormGroup label="Accelerators" fieldId="quota-accelerators">
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  Any Kubernetes extended resource name, for example nvidia.com/gpu or
                  vgpu/device.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
            {quota.accelerators.map((row, index) => (
              <Flex
                key={`accelerator-${index}`}
                alignItems={{ default: 'alignItemsFlexEnd' }}
                spaceItems={{ default: 'spaceItemsSm' }}
                style={{ marginTop: '0.5rem' }}
              >
                <FlexItem grow={{ default: 'grow' }}>
                  <TextInput
                    id={`quota-accelerator-resource-${index}`}
                    value={row.resource}
                    onChange={(_event, value) => updateAccelerator(index, 'resource', value)}
                    placeholder="nvidia.com/gpu"
                    aria-label={`Accelerator resource ${index + 1}`}
                  />
                </FlexItem>
                <FlexItem>
                  <TextInput
                    id={`quota-accelerator-quantity-${index}`}
                    value={row.quantity}
                    onChange={(_event, value) => updateAccelerator(index, 'quantity', value)}
                    placeholder="1"
                    aria-label={`Accelerator quantity ${index + 1}`}
                  />
                </FlexItem>
                <FlexItem>
                  <Button
                    variant="plain"
                    icon={<MinusCircleIcon />}
                    onClick={() => removeAccelerator(index)}
                    aria-label={`Remove accelerator ${index + 1}`}
                  />
                </FlexItem>
              </Flex>
            ))}
            <Button
              variant="link"
              icon={<PlusCircleIcon />}
              onClick={addAccelerator}
              style={{ paddingLeft: 0, marginTop: '0.25rem' }}
            >
              Add accelerator
            </Button>
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
