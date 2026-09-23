import React from 'react';
import {
  Alert,
  Button,
  ExpandableSection,
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
  Radio,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { NAMESPACE_NAME_PATTERN } from '../projects/projectApi';
import { K8sApiError } from '../../cluster/k8sClient';
import { KIND_CATALOG, type FieldDef, type KindCatalog, type KServeResource } from './crdCatalog';
import { createKServeResource, updateKServeResource } from './kserveApi';
import { applyField, emptyResource, fieldToString } from './kserveHelpers';
import { cloneResource, parseManifest, toManifest } from './manifest';

type ResourceFormModalProps = {
  kind: KindCatalog;
  namespace: string;
  namespaces?: string[];
  allowKindSwitch?: boolean;
  resource?: KServeResource;
  onClose: () => void;
  onSaved: (name: string) => void;
};

const ResourceFormModal: React.FC<ResourceFormModalProps> = ({
  kind: initialKind,
  namespace,
  namespaces,
  allowKindSwitch = false,
  resource,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(resource);
  const [kind, setKind] = React.useState<KindCatalog>(initialKind);
  const [draft, setDraft] = React.useState<KServeResource>(() =>
    resource ? cloneResource(resource) : emptyResource(initialKind, namespace),
  );
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [manifestOpen, setManifestOpen] = React.useState(false);
  const [manifestText, setManifestText] = React.useState(() =>
    toManifest(
      (resource ? cloneResource(resource) : emptyResource(initialKind, namespace)) as Record<
        string,
        unknown
      >,
    ),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [manifestError, setManifestError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const projectChoices = namespaces && namespaces.length > 0 ? namespaces : [namespace];

  const applyDraft = (next: KServeResource, nextKind = kind) => {
    setDraft(next);
    setManifestText(toManifest(next as Record<string, unknown>));
    setManifestError(null);
    if (nextKind.kind !== kind.kind) {
      setKind(nextKind);
    }
  };

  const syncKind = (nextKind: KindCatalog) => {
    const next = emptyResource(nextKind, draft.metadata.namespace ?? namespace);
    next.metadata.name = draft.metadata.name;
    applyDraft(next, nextKind);
    setError(null);
  };

  const onFieldChange = (field: FieldDef, value: string) => {
    const next = cloneResource(draft);
    applyField(next, field, value);
    applyDraft(next);
  };

  const onManifestChange = (value: string) => {
    setManifestText(value);
    try {
      const parsed = parseManifest(value) as KServeResource;
      if (!parsed.metadata) {
        parsed.metadata = { name: '' };
      }
      const nextKind = KIND_CATALOG.find((item) => item.kind === parsed.kind) ?? kind;
      if (!parsed.apiVersion) {
        parsed.apiVersion = nextKind.apiVersion;
      }
      if (!parsed.kind) {
        parsed.kind = nextKind.kind;
      }
      setDraft(parsed);
      setKind(nextKind);
      setManifestError(null);
    } catch (err) {
      setManifestError(err instanceof Error ? err.message : 'Could not parse manifest.');
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (manifestError) {
      setError(manifestError);
      setManifestOpen(true);
      return;
    }
    const next = cloneResource(draft);
    if (!next.apiVersion) {
      next.apiVersion = kind.apiVersion;
    }
    if (!next.kind) {
      next.kind = kind.kind;
    }
    if (!next.metadata) {
      next.metadata = { name: '' };
    }
    const name = next.metadata.name?.trim() ?? '';
    if (!NAMESPACE_NAME_PATTERN.test(name) || name.length > 63) {
      setError('Name must be a lowercase DNS-1123 label (max 63 characters).');
      return;
    }
    next.metadata.name = name;
    const ns = (next.metadata.namespace ?? draft.metadata.namespace ?? namespace).trim();
    if (!ns) {
      setError('Project is required.');
      return;
    }
    next.metadata.namespace = ns;
    if (resource?.metadata.resourceVersion) {
      next.metadata.resourceVersion = resource.metadata.resourceVersion;
    }
    const missing = kind.fields.find((field) => field.required && fieldToString(next, field).trim() === '');
    if (missing) {
      setError(`${missing.label} is required.`);
      return;
    }
    setIsSaving(true);
    try {
      if (isEdit) {
        await updateKServeResource(kind, next);
      } else {
        await createKServeResource(kind, next);
      }
      onSaved(name);
    } catch (err) {
      setError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to save resource.');
    } finally {
      setIsSaving(false);
    }
  };

  const renderFields = (group: 'basic' | 'advanced') =>
    kind.fields
      .filter((field) => field.group === group)
      .map((field) => {
        const id = `kserve-field-${field.path}`;
        const value = fieldToString(draft, field);
        if (field.type === 'select') {
          return (
            <FormGroup key={field.path} label={field.label} isRequired={field.required} fieldId={id}>
              <FormSelect
                id={id}
                value={value}
                onChange={(_event, next) => onFieldChange(field, next)}
                aria-label={field.label}
              >
                {field.required ? null : <FormSelectOption value="" label="Not set" />}
                {(field.options ?? []).map((option) => (
                  <FormSelectOption key={option} value={option} label={option} />
                ))}
              </FormSelect>
              {field.helperText ? (
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>{field.helperText}</HelperTextItem>
                  </HelperText>
                </FormHelperText>
              ) : null}
            </FormGroup>
          );
        }
        return (
          <FormGroup key={field.path} label={field.label} isRequired={field.required} fieldId={id}>
            <TextInput
              id={id}
              value={value}
              onChange={(_event, next) => onFieldChange(field, next)}
              placeholder={field.placeholder}
              isRequired={field.required}
              isDisabled={field.path === 'metadata.name' && isEdit}
            />
            {field.helperText ? (
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>{field.helperText}</HelperTextItem>
                </HelperText>
              </FormHelperText>
            ) : null}
          </FormGroup>
        );
      });

  return (
    <Modal
      isOpen
      variant="large"
      onClose={onClose}
      aria-label={isEdit ? `Edit ${kind.title}` : 'Create Deployment'}
    >
      <ModalHeader title={isEdit ? `Edit ${kind.title}` : 'Create Deployment'} />
      <ModalBody>
        <Form id="kserve-resource-form" onSubmit={save}>
          {error ? (
            <Alert variant="danger" isInline title="Could not save deployment">
              {error}
            </Alert>
          ) : null}
          {allowKindSwitch && !isEdit ? (
            <FormGroup role="radiogroup" label="Type" isRequired fieldId="kserve-kind">
              {KIND_CATALOG.map((item) => (
                <Radio
                  key={item.kind}
                  id={`kserve-kind-${item.kind}`}
                  name="kserve-kind"
                  label={item.title}
                  description={item.description}
                  isChecked={kind.kind === item.kind}
                  onChange={() => syncKind(item)}
                />
              ))}
            </FormGroup>
          ) : null}
          {projectChoices.length > 1 ? (
            <FormGroup label="Project" isRequired fieldId="kserve-namespace">
              <FormSelect
                id="kserve-namespace"
                value={draft.metadata.namespace ?? namespace}
                onChange={(_event, value) => {
                  const next = cloneResource(draft);
                  next.metadata.namespace = value;
                  applyDraft(next);
                }}
                isDisabled={isEdit}
                aria-label="Project"
              >
                {projectChoices.map((item) => (
                  <FormSelectOption key={item} value={item} label={item} />
                ))}
              </FormSelect>
            </FormGroup>
          ) : null}
          {renderFields('basic')}
          <div style={{ marginTop: '1rem' }}>
            <ExpandableSection
              toggleText="Advanced"
              isExpanded={advancedOpen}
              onToggle={(_event, expanded) => setAdvancedOpen(expanded)}
            >
              {renderFields('advanced')}
              <HelperText>
                <HelperTextItem>
                  Extra spec fields such as GPU limits, affinity, and additional graph nodes can be
                  set in the raw manifest.
                </HelperTextItem>
              </HelperText>
            </ExpandableSection>
          </div>
          <div style={{ marginTop: '0.5rem' }}>
            <ExpandableSection
              toggleText="Raw manifest"
              isExpanded={manifestOpen}
              onToggle={(_event, expanded) => setManifestOpen(expanded)}
            >
              <FormGroup label="Manifest" fieldId="kserve-manifest">
                <TextArea
                  id="kserve-manifest"
                  value={manifestText}
                  onChange={(_event, value) => onManifestChange(value)}
                  rows={18}
                  resizeOrientation="vertical"
                  validated={manifestError ? 'error' : 'default'}
                />
                <FormHelperText>
                  <HelperText>
                    <HelperTextItem>
                      {manifestError ??
                        `YAML or JSON of the full ${kind.title}. Edits sync back to the fields above.`}
                    </HelperTextItem>
                  </HelperText>
                </FormHelperText>
              </FormGroup>
            </ExpandableSection>
          </div>
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          variant="primary"
          type="submit"
          form="kserve-resource-form"
          isLoading={isSaving}
          isDisabled={isSaving}
        >
          {isEdit ? 'Save' : 'Create'}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ResourceFormModal;
