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
  Radio,
  Tab,
  Tabs,
  TabTitleText,
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

type EditorMode = 'fields' | 'manifest';
type FieldTab = 'basic' | 'advanced';

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
  const [mode, setMode] = React.useState<EditorMode>('fields');
  const [fieldTab, setFieldTab] = React.useState<FieldTab>('basic');
  const [manifestText, setManifestText] = React.useState(() =>
    toManifest(
      (resource ? cloneResource(resource) : emptyResource(initialKind, namespace)) as Record<
        string,
        unknown
      >,
    ),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  const projectChoices = namespaces && namespaces.length > 0 ? namespaces : [namespace];

  const syncKind = (nextKind: KindCatalog) => {
    const next = emptyResource(nextKind, draft.metadata.namespace ?? namespace);
    next.metadata.name = draft.metadata.name;
    setKind(nextKind);
    setDraft(next);
    setManifestText(toManifest(next as Record<string, unknown>));
    setError(null);
  };

  const applyDraftToManifest = (next: KServeResource) => {
    setDraft(next);
    setManifestText(toManifest(next as Record<string, unknown>));
  };

  const switchMode = (nextMode: EditorMode) => {
    setError(null);
    if (nextMode === 'manifest') {
      setManifestText(toManifest(draft as Record<string, unknown>));
      setMode(nextMode);
      return;
    }
    try {
      const parsed = parseManifest(manifestText) as KServeResource;
      if (!parsed.metadata) {
        parsed.metadata = { name: '' };
      }
      setDraft(parsed);
      setMode(nextMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse manifest.');
    }
  };

  const onFieldChange = (field: FieldDef, value: string) => {
    const next = cloneResource(draft);
    applyField(next, field, value);
    applyDraftToManifest(next);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    let next = draft;
    if (mode === 'manifest') {
      try {
        next = parseManifest(manifestText) as KServeResource;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not parse manifest.');
        return;
      }
    }
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
    if (kind.scope === 'Namespaced') {
      const ns = (next.metadata.namespace ?? draft.metadata.namespace ?? namespace).trim();
      if (!ns) {
        setError('Project is required.');
        return;
      }
      next.metadata.namespace = ns;
    }
    if (resource?.metadata.resourceVersion) {
      next.metadata.resourceVersion = resource.metadata.resourceVersion;
    }
    const missing = kind.fields.find((field) => {
      if (!field.required) {
        return false;
      }
      return fieldToString(next, field).trim() === '';
    });
    if (mode === 'fields' && missing) {
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

  const renderFields = (group: FieldTab) =>
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
      aria-label={isEdit ? `Edit ${kind.title}` : `Create ${kind.title}`}
    >
      <ModalHeader title={isEdit ? `Edit ${kind.title}` : `Create ${kind.title}`} />
      <ModalBody>
        <Form id="kserve-resource-form" onSubmit={save}>
          {error ? (
            <Alert variant="danger" isInline title="Could not save resource">
              {error}
            </Alert>
          ) : null}
          {allowKindSwitch && !isEdit ? (
            <FormGroup label="Kind" isRequired fieldId="kserve-kind">
              <FormSelect
                id="kserve-kind"
                value={kind.kind}
                onChange={(_event, value) => {
                  const next = KIND_CATALOG.find((item) => item.kind === value);
                  if (next) {
                    syncKind(next);
                  }
                }}
                aria-label="Kind"
              >
                {KIND_CATALOG.map((item) => (
                  <FormSelectOption key={item.kind} value={item.kind} label={item.title} />
                ))}
              </FormSelect>
            </FormGroup>
          ) : null}
          {kind.scope === 'Namespaced' && projectChoices.length > 1 ? (
            <FormGroup label="Project" isRequired fieldId="kserve-namespace">
              <FormSelect
                id="kserve-namespace"
                value={draft.metadata.namespace ?? namespace}
                onChange={(_event, value) => {
                  const next = cloneResource(draft);
                  next.metadata.namespace = value;
                  applyDraftToManifest(next);
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
          <FormGroup role="radiogroup" isInline fieldId="kserve-editor-mode" label="Editor">
            <Radio
              id="kserve-mode-fields"
              name="kserve-editor-mode"
              label="Fields"
              isChecked={mode === 'fields'}
              onChange={() => switchMode('fields')}
            />
            <Radio
              id="kserve-mode-manifest"
              name="kserve-editor-mode"
              label="Raw manifest"
              isChecked={mode === 'manifest'}
              onChange={() => switchMode('manifest')}
            />
          </FormGroup>
          {mode === 'fields' ? (
            <>
              <Tabs
                activeKey={fieldTab}
                onSelect={(_event, tabKey) => setFieldTab(String(tabKey) as FieldTab)}
              >
                <Tab eventKey="basic" title={<TabTitleText>Basic</TabTitleText>} />
                <Tab eventKey="advanced" title={<TabTitleText>Advanced</TabTitleText>} />
              </Tabs>
              <div style={{ marginTop: '1rem' }}>
                {fieldTab === 'basic' ? renderFields('basic') : renderFields('advanced')}
                {fieldTab === 'advanced' ? (
                  <HelperText>
                    <HelperTextItem>
                      Remaining spec fields (affinity, nodeSelector, extra graph nodes, GPU limits)
                      can be set in the raw manifest.
                    </HelperTextItem>
                  </HelperText>
                ) : null}
              </div>
            </>
          ) : (
            <FormGroup label="Manifest" isRequired fieldId="kserve-manifest">
              <TextArea
                id="kserve-manifest"
                value={manifestText}
                onChange={(_event, value) => setManifestText(value)}
                rows={22}
                resizeOrientation="vertical"
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>YAML or JSON of the full {kind.title}.</HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}
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
