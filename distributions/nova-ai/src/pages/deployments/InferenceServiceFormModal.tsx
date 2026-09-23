import React from 'react';
import {
  Alert,
  Button,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  TextInput,
} from '@patternfly/react-core';
import { NAMESPACE_NAME_PATTERN } from '../projects/projectApi';
import { K8sApiError } from '../../cluster/k8sClient';
import { createInferenceService, updateInferenceService } from './kserveApi';
import { formValuesFromService } from './kserveHelpers';
import {
  MODEL_FORMATS,
  type InferenceServiceFormValues,
  type InferenceServiceKind,
} from './types';

type InferenceServiceFormModalProps = {
  namespace: string;
  namespaces?: string[];
  service?: InferenceServiceKind;
  onClose: () => void;
  onSaved: (name: string) => void;
};

const emptyValues = (namespace: string): InferenceServiceFormValues => ({
  name: '',
  namespace,
  format: 'sklearn',
  storageUri: '',
  runtime: '',
  minReplicas: '1',
  cpu: '100m',
  memory: '256Mi',
});

const InferenceServiceFormModal: React.FC<InferenceServiceFormModalProps> = ({
  namespace,
  namespaces,
  service,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(service);
  const [values, setValues] = React.useState<InferenceServiceFormValues>(
    service ? formValuesFromService(service) : emptyValues(namespace),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const setField = <K extends keyof InferenceServiceFormValues>(
    field: K,
    value: InferenceServiceFormValues[K],
  ) => {
    setValues((current) => ({ ...current, [field]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const name = values.name.trim();
    const ns = values.namespace.trim();
    if (!NAMESPACE_NAME_PATTERN.test(name) || name.length > 63) {
      setError('Name must be a lowercase DNS-1123 label (max 63 characters).');
      return;
    }
    if (!ns) {
      setError('Project is required.');
      return;
    }
    if (!values.storageUri.trim()) {
      setError('Storage URI is required.');
      return;
    }
    setIsSaving(true);
    try {
      if (service) {
        await updateInferenceService(service, values);
      } else {
        await createInferenceService(values);
      }
      onSaved(name);
    } catch (err) {
      setError(
        err instanceof K8sApiError || err instanceof Error
          ? err.message
          : 'Failed to save InferenceService.',
      );
    } finally {
      setIsSaving(false);
    }
  };

  const projectChoices = namespaces && namespaces.length > 0 ? namespaces : [namespace];

  return (
    <Modal
      isOpen
      variant="medium"
      onClose={onClose}
      aria-label={isEdit ? 'Edit InferenceService' : 'Create InferenceService'}
    >
      <ModalHeader title={isEdit ? 'Edit model' : 'Deploy model'} />
      <ModalBody>
        <Form id="inference-service-form" onSubmit={save}>
          {error ? (
            <Alert variant="danger" isInline title="Could not save model">
              {error}
            </Alert>
          ) : null}
          <FormGroup label="Name" isRequired fieldId="isvc-name">
            <TextInput
              id="isvc-name"
              value={values.name}
              onChange={(_event, value) => setField('name', value)}
              isDisabled={isEdit}
              isRequired
            />
          </FormGroup>
          {projectChoices.length > 1 ? (
            <FormGroup label="Project" isRequired fieldId="isvc-namespace">
              <FormSelect
                id="isvc-namespace"
                value={values.namespace}
                onChange={(_event, value) => setField('namespace', value)}
                isDisabled={isEdit}
                aria-label="Project"
              >
                {projectChoices.map((item) => (
                  <FormSelectOption key={item} value={item} label={item} />
                ))}
              </FormSelect>
            </FormGroup>
          ) : null}
          <FormGroup label="Model format" isRequired fieldId="isvc-format">
            <FormSelect
              id="isvc-format"
              value={values.format}
              onChange={(_event, value) => setField('format', value)}
              aria-label="Model format"
            >
              {MODEL_FORMATS.map((format) => (
                <FormSelectOption key={format} value={format} label={format} />
              ))}
            </FormSelect>
          </FormGroup>
          <FormGroup label="Storage URI" isRequired fieldId="isvc-storage">
            <TextInput
              id="isvc-storage"
              value={values.storageUri}
              onChange={(_event, value) => setField('storageUri', value)}
              placeholder="s3://bucket/model or pvc://my-pvc/path"
              isRequired
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>
                  URI of the model artifact. Supports s3://, gs://, pvc://, and http(s)://.
                </HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
          <FormGroup label="Serving runtime" fieldId="isvc-runtime">
            <TextInput
              id="isvc-runtime"
              value={values.runtime}
              onChange={(_event, value) => setField('runtime', value)}
              placeholder="Optional ServingRuntime name"
            />
          </FormGroup>
          <FormGroup label="Min replicas" fieldId="isvc-replicas">
            <TextInput
              id="isvc-replicas"
              value={values.minReplicas}
              onChange={(_event, value) => setField('minReplicas', value)}
            />
          </FormGroup>
          <FormGroup label="CPU request" fieldId="isvc-cpu">
            <TextInput
              id="isvc-cpu"
              value={values.cpu}
              onChange={(_event, value) => setField('cpu', value)}
              placeholder="100m"
            />
          </FormGroup>
          <FormGroup label="Memory request" fieldId="isvc-memory">
            <TextInput
              id="isvc-memory"
              value={values.memory}
              onChange={(_event, value) => setField('memory', value)}
              placeholder="256Mi"
            />
          </FormGroup>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          type="submit"
          form="inference-service-form"
          isLoading={isSaving}
          isDisabled={isSaving}
        >
          {isEdit ? 'Save' : 'Deploy'}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default InferenceServiceFormModal;
