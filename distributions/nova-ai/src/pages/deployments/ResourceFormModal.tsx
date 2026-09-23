import React from 'react';
import {
  Alert,
  Button,
  ExpandableSection,
  Flex,
  FlexItem,
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
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { NAMESPACE_NAME_PATTERN } from '../projects/projectApi';
import { K8sApiError } from '../../cluster/k8sClient';
import {
  KIND_CATALOG,
  MODEL_FORMATS,
  type FieldDef,
  type KindCatalog,
  type KServeResource,
} from './crdCatalog';
import { createKServeResource, updateKServeResource } from './kserveApi';
import {
  applyField,
  emptyResource,
  fieldToString,
  prepareForSave,
  readEnv,
  readGraphSteps,
  readLabels,
  readPorts,
  readStringList,
  resourceValue,
  setStorageMode,
  specResourceValue,
  storageField,
  storageModeOf,
  workerSpecNumber,
  writeEnv,
  writeGraphSteps,
  writeLabels,
  writePorts,
  writeResourceValue,
  writeSpecResourceValue,
  writeStorageField,
  writeStringList,
  writeWorkerSpecNumber,
  type EnvDraft,
  type GraphStepDraft,
  type LabelDraft,
  type PortDraft,
} from './kserveHelpers';
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

type EditorMode = 'fields' | 'yaml';

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
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
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
  const [labelRows, setLabelRows] = React.useState<LabelDraft[]>(() =>
    resource ? readLabels(resource) : [],
  );

  const projectChoices = namespaces && namespaces.length > 0 ? namespaces : [namespace];
  const storageMode = storageModeOf(draft);
  const args = readStringList(draft, 'spec.predictor.model.args');
  const env = readEnv(draft);
  const ports = readPorts(draft);
  const graphSteps = readGraphSteps(draft);

  const addLinkStyle: React.CSSProperties = {
    paddingLeft: 0,
    marginTop: '0.25rem',
    color: 'var(--pf-t--global--color--brand--default, #0066cc)',
  };

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
    setLabelRows([]);
    setError(null);
  };

  const onFieldChange = (field: FieldDef, value: string) => {
    const next = cloneResource(draft);
    applyField(next, field, value);
    applyDraft(next);
  };

  const patchDraft = (mutate: (next: KServeResource) => void) => {
    const next = cloneResource(draft);
    mutate(next);
    applyDraft(next);
  };

  const switchMode = (nextMode: EditorMode) => {
    setError(null);
    if (nextMode === 'yaml') {
      setManifestText(toManifest(draft as Record<string, unknown>));
      setManifestError(null);
      setMode(nextMode);
      return;
    }
    try {
      const parsed = parseManifest(manifestText) as KServeResource;
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
      setLabelRows(readLabels(parsed));
      setManifestError(null);
      setMode(nextMode);
    } catch (err) {
      setManifestError(err instanceof Error ? err.message : 'Could not parse YAML.');
      setError(err instanceof Error ? err.message : 'Could not parse YAML.');
    }
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
      setLabelRows(readLabels(parsed));
      setManifestError(null);
    } catch (err) {
      setManifestError(err instanceof Error ? err.message : 'Could not parse YAML.');
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    if (mode === 'yaml' && manifestError) {
      setError(manifestError);
      return;
    }
    const next = prepareForSave(draft);
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
    writeLabels(next, labelRows);
    if (resource?.metadata.resourceVersion) {
      next.metadata.resourceVersion = resource.metadata.resourceVersion;
    }
    if (mode === 'fields') {
      const missing = kind.fields.find(
        (field) => field.required && fieldToString(next, field).trim() === '',
      );
      if (missing) {
        setError(`${missing.label} is required.`);
        return;
      }
      if (kind.kind === 'InferenceService') {
        const format = fieldToString(next, {
          path: 'spec.predictor.model.modelFormat.name',
          label: 'Model format',
          type: 'select',
          group: 'basic',
        });
        if (format.trim() === '') {
          setError('Model format is required.');
          return;
        }
        if (storageModeOf(next) === 'uri') {
          if (fieldToString(next, {
            path: 'spec.predictor.model.storageUri',
            label: 'Storage URI',
            type: 'string',
            group: 'basic',
          }).trim() === '') {
            setError('Storage URI is required.');
            return;
          }
        } else if (storageField(next, 'key').trim() === '') {
          setError('Storage key is required.');
          return;
        }
      }
      if (kind.kind === 'InferenceGraph') {
        const steps = readGraphSteps(next).filter((step) => step.serviceName.trim() !== '');
        if (steps.length === 0) {
          setError('At least one graph step with a service name is required.');
          return;
        }
      }
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

  const renderCatalogFields = (group: 'basic' | 'advanced') =>
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
                onChange={(_event, nextValue) => onFieldChange(field, nextValue)}
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
              onChange={(_event, nextValue) => onFieldChange(field, nextValue)}
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

  const renderLabels = () => (
    <FormGroup label="Labels" fieldId="kserve-labels">
      {labelRows.map((item, index) => (
        <Flex
          key={`label-${index}`}
          alignItems={{ default: 'alignItemsFlexEnd' }}
          spaceItems={{ default: 'spaceItemsSm' }}
          style={{ marginTop: index === 0 ? 0 : '0.5rem' }}
        >
          <FlexItem grow={{ default: 'grow' }}>
            <TextInput
              id={`kserve-label-key-${index}`}
              value={item.key}
              onChange={(_event, value) => {
                const nextRows: LabelDraft[] = labelRows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, key: value } : row,
                );
                setLabelRows(nextRows);
                patchDraft((next) => writeLabels(next, nextRows));
              }}
              placeholder="key"
              aria-label={`Label key ${index + 1}`}
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }}>
            <TextInput
              id={`kserve-label-value-${index}`}
              value={item.value}
              onChange={(_event, value) => {
                const nextRows: LabelDraft[] = labelRows.map((row, rowIndex) =>
                  rowIndex === index ? { ...row, value } : row,
                );
                setLabelRows(nextRows);
                patchDraft((next) => writeLabels(next, nextRows));
              }}
              placeholder="value"
              aria-label={`Label value ${index + 1}`}
            />
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              icon={<MinusCircleIcon />}
              onClick={() => {
                const nextRows = labelRows.filter((_row, rowIndex) => rowIndex !== index);
                setLabelRows(nextRows);
                patchDraft((next) => writeLabels(next, nextRows));
              }}
              aria-label={`Remove label ${index + 1}`}
            />
          </FlexItem>
        </Flex>
      ))}
      <Button
        variant="link"
        icon={<PlusCircleIcon />}
        onClick={() => setLabelRows([...labelRows, { key: '', value: '' }])}
        style={addLinkStyle}
      >
        Add label
      </Button>
    </FormGroup>
  );

  const renderInferenceServiceBasics = () => (
    <>
      <FormGroup label="Model format" isRequired fieldId="kserve-model-format">
        <FormSelect
          id="kserve-model-format"
          value={fieldToString(draft, {
            path: 'spec.predictor.model.modelFormat.name',
            label: 'Model format',
            type: 'select',
            group: 'basic',
          })}
          onChange={(_event, value) =>
            onFieldChange(
              {
                path: 'spec.predictor.model.modelFormat.name',
                label: 'Model format',
                type: 'select',
                group: 'basic',
              },
              value,
            )
          }
          aria-label="Model format"
        >
          {MODEL_FORMATS.map((option) => (
            <FormSelectOption key={option} value={option} label={option} />
          ))}
        </FormSelect>
      </FormGroup>
      <FormGroup label="Args" fieldId="kserve-args">
        {args.map((value, index) => (
          <Flex
            key={`arg-${index}`}
            alignItems={{ default: 'alignItemsFlexEnd' }}
            spaceItems={{ default: 'spaceItemsSm' }}
            style={{ marginTop: index === 0 ? 0 : '0.5rem' }}
          >
            <FlexItem grow={{ default: 'grow' }}>
              <TextInput
                id={`kserve-arg-${index}`}
                value={value}
                onChange={(_event, nextValue) => {
                  const nextArgs = [...args];
                  nextArgs[index] = nextValue;
                  patchDraft((next) => writeStringList(next, 'spec.predictor.model.args', nextArgs));
                }}
                placeholder="--http-port=8080"
                aria-label={`Argument ${index + 1}`}
              />
            </FlexItem>
            <FlexItem>
              <Button
                variant="plain"
                icon={<MinusCircleIcon />}
                onClick={() =>
                  patchDraft((next) =>
                    writeStringList(
                      next,
                      'spec.predictor.model.args',
                      args.filter((_item, itemIndex) => itemIndex !== index),
                    ),
                  )
                }
                aria-label={`Remove argument ${index + 1}`}
              />
            </FlexItem>
          </Flex>
        ))}
        <Button
          variant="link"
          icon={<PlusCircleIcon />}
          onClick={() =>
            patchDraft((next) => writeStringList(next, 'spec.predictor.model.args', [...args, '']))
          }
          style={addLinkStyle}
        >
          Add argument
        </Button>
      </FormGroup>
      <FormGroup label="Env" fieldId="kserve-env">
        {env.map((item, index) => (
          <Flex
            key={`env-${index}`}
            alignItems={{ default: 'alignItemsFlexEnd' }}
            spaceItems={{ default: 'spaceItemsSm' }}
            style={{ marginTop: index === 0 ? 0 : '0.5rem' }}
          >
            <FlexItem grow={{ default: 'grow' }}>
              <TextInput
                id={`kserve-env-name-${index}`}
                value={item.name}
                onChange={(_event, value) => {
                  const nextEnv: EnvDraft[] = env.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, name: value } : entry,
                  );
                  patchDraft((next) => writeEnv(next, nextEnv));
                }}
                placeholder="NAME"
                aria-label={`Env name ${index + 1}`}
              />
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }}>
              <TextInput
                id={`kserve-env-value-${index}`}
                value={item.value}
                onChange={(_event, value) => {
                  const nextEnv: EnvDraft[] = env.map((entry, entryIndex) =>
                    entryIndex === index ? { ...entry, value } : entry,
                  );
                  patchDraft((next) => writeEnv(next, nextEnv));
                }}
                placeholder="value"
                aria-label={`Env value ${index + 1}`}
              />
            </FlexItem>
            <FlexItem>
              <Button
                variant="plain"
                icon={<MinusCircleIcon />}
                onClick={() =>
                  patchDraft((next) => writeEnv(next, env.filter((_entry, entryIndex) => entryIndex !== index)))
                }
                aria-label={`Remove env ${index + 1}`}
              />
            </FlexItem>
          </Flex>
        ))}
        <Button
          variant="link"
          icon={<PlusCircleIcon />}
          onClick={() => patchDraft((next) => writeEnv(next, [...env, { name: '', value: '' }]))}
          style={addLinkStyle}
        >
          Add env
        </Button>
      </FormGroup>
      <FormGroup role="radiogroup" label="Model location" isRequired fieldId="kserve-storage-mode">
        <Radio
          id="kserve-storage-uri"
          name="kserve-storage-mode"
          label="Storage URI"
          isChecked={storageMode === 'uri'}
          onChange={() => patchDraft((next) => setStorageMode(next, 'uri'))}
        />
        <Radio
          id="kserve-storage-spec"
          name="kserve-storage-mode"
          label="Storage"
          isChecked={storageMode === 'storage'}
          onChange={() => patchDraft((next) => setStorageMode(next, 'storage'))}
        />
      </FormGroup>
      {storageMode === 'uri' ? (
        <FormGroup label="Storage URI" isRequired fieldId="kserve-storage-uri-value">
          <TextInput
            id="kserve-storage-uri-value"
            value={fieldToString(draft, {
              path: 'spec.predictor.model.storageUri',
              label: 'Storage URI',
              type: 'string',
              group: 'basic',
            })}
            onChange={(_event, value) =>
              onFieldChange(
                {
                  path: 'spec.predictor.model.storageUri',
                  label: 'Storage URI',
                  type: 'string',
                  group: 'basic',
                },
                value,
              )
            }
            placeholder="s3://bucket/model or pvc://my-pvc/path"
          />
        </FormGroup>
      ) : (
        <>
          <FormGroup label="Storage key" isRequired fieldId="kserve-storage-key">
            <TextInput
              id="kserve-storage-key"
              value={storageField(draft, 'key')}
              onChange={(_event, value) => patchDraft((next) => writeStorageField(next, 'key', value))}
              placeholder="storage-config"
            />
          </FormGroup>
          <FormGroup label="Storage path" fieldId="kserve-storage-path">
            <TextInput
              id="kserve-storage-path"
              value={storageField(draft, 'path')}
              onChange={(_event, value) => patchDraft((next) => writeStorageField(next, 'path', value))}
              placeholder="models/sklearn"
            />
          </FormGroup>
        </>
      )}
      <FormGroup label="Resources" fieldId="kserve-resources">
        <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }}>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-cpu-request"
              value={resourceValue(draft, 'requests', 'cpu')}
              onChange={(_event, value) =>
                patchDraft((next) => writeResourceValue(next, 'requests', 'cpu', value))
              }
              placeholder="CPU request"
              aria-label="CPU request"
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-memory-request"
              value={resourceValue(draft, 'requests', 'memory')}
              onChange={(_event, value) =>
                patchDraft((next) => writeResourceValue(next, 'requests', 'memory', value))
              }
              placeholder="Memory request"
              aria-label="Memory request"
            />
          </FlexItem>
        </Flex>
        <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: '0.5rem' }}>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-cpu-limit"
              value={resourceValue(draft, 'limits', 'cpu')}
              onChange={(_event, value) =>
                patchDraft((next) => writeResourceValue(next, 'limits', 'cpu', value))
              }
              placeholder="CPU limit"
              aria-label="CPU limit"
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-memory-limit"
              value={resourceValue(draft, 'limits', 'memory')}
              onChange={(_event, value) =>
                patchDraft((next) => writeResourceValue(next, 'limits', 'memory', value))
              }
              placeholder="Memory limit"
              aria-label="Memory limit"
            />
          </FlexItem>
        </Flex>
      </FormGroup>
      <FormGroup label="Ports" fieldId="kserve-ports">
        {ports.map((port, index) => (
          <Flex
            key={`port-${index}`}
            alignItems={{ default: 'alignItemsFlexEnd' }}
            spaceItems={{ default: 'spaceItemsSm' }}
            style={{ marginTop: index === 0 ? 0 : '0.5rem' }}
          >
            <FlexItem grow={{ default: 'grow' }}>
              <TextInput
                id={`kserve-port-${index}`}
                type="number"
                value={port.containerPort}
                onChange={(_event, value) => {
                  const nextPorts: PortDraft[] = ports.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, containerPort: value } : item,
                  );
                  patchDraft((next) => writePorts(next, nextPorts));
                }}
                placeholder="8080"
                aria-label={`Container port ${index + 1}`}
              />
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }}>
              <TextInput
                id={`kserve-port-name-${index}`}
                value={port.name}
                onChange={(_event, value) => {
                  const nextPorts: PortDraft[] = ports.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: value } : item,
                  );
                  patchDraft((next) => writePorts(next, nextPorts));
                }}
                placeholder="http1"
                aria-label={`Port name ${index + 1}`}
              />
            </FlexItem>
            <FlexItem>
              <FormSelect
                id={`kserve-port-protocol-${index}`}
                value={port.protocol}
                onChange={(_event, value) => {
                  const nextPorts: PortDraft[] = ports.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, protocol: value } : item,
                  );
                  patchDraft((next) => writePorts(next, nextPorts));
                }}
                aria-label={`Port protocol ${index + 1}`}
              >
                <FormSelectOption value="TCP" label="TCP" />
                <FormSelectOption value="UDP" label="UDP" />
              </FormSelect>
            </FlexItem>
            <FlexItem>
              <Button
                variant="plain"
                icon={<MinusCircleIcon />}
                onClick={() =>
                  patchDraft((next) => writePorts(next, ports.filter((_item, itemIndex) => itemIndex !== index)))
                }
                aria-label={`Remove port ${index + 1}`}
              />
            </FlexItem>
          </Flex>
        ))}
        <Button
          variant="link"
          icon={<PlusCircleIcon />}
          onClick={() =>
            patchDraft((next) => writePorts(next, [...ports, { containerPort: '', name: '', protocol: 'TCP' }]))
          }
          style={addLinkStyle}
        >
          Add port
        </Button>
      </FormGroup>
    </>
  );

  const renderInferenceGraphBasics = () => (
    <>
      <FormGroup label="Steps" isRequired fieldId="kserve-graph-steps">
        {graphSteps.map((step, index) => (
          <div
            key={`step-${index}`}
            style={{
              marginTop: index === 0 ? 0 : '0.75rem',
              padding: '0.75rem',
              border: '1px solid var(--pf-t--global--border--color--default, #a2a9b4)',
              borderRadius: '8px',
            }}
          >
            <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
              <FlexItem>
                <strong>Step {index + 1}</strong>
              </FlexItem>
              <FlexItem>
                <Button
                  variant="plain"
                  icon={<MinusCircleIcon />}
                  onClick={() =>
                    patchDraft((next) =>
                      writeGraphSteps(
                        next,
                        graphSteps.filter((_item, itemIndex) => itemIndex !== index),
                      ),
                    )
                  }
                  aria-label={`Remove step ${index + 1}`}
                />
              </FlexItem>
            </Flex>
            <FormGroup label="Service name" isRequired fieldId={`kserve-step-service-${index}`}>
              <TextInput
                id={`kserve-step-service-${index}`}
                value={step.serviceName}
                onChange={(_event, value) => {
                  const nextSteps: GraphStepDraft[] = graphSteps.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, serviceName: value } : item,
                  );
                  patchDraft((next) => writeGraphSteps(next, nextSteps));
                }}
                placeholder="cat-dog-classifier"
              />
            </FormGroup>
            <FormGroup label="Step name" fieldId={`kserve-step-name-${index}`}>
              <TextInput
                id={`kserve-step-name-${index}`}
                value={step.name}
                onChange={(_event, value) => {
                  const nextSteps: GraphStepDraft[] = graphSteps.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, name: value } : item,
                  );
                  patchDraft((next) => writeGraphSteps(next, nextSteps));
                }}
                placeholder="cat_dog_classifier"
              />
            </FormGroup>
            <FormGroup label="Data" fieldId={`kserve-step-data-${index}`}>
              <TextInput
                id={`kserve-step-data-${index}`}
                value={step.data}
                onChange={(_event, value) => {
                  const nextSteps: GraphStepDraft[] = graphSteps.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, data: value } : item,
                  );
                  patchDraft((next) => writeGraphSteps(next, nextSteps));
                }}
                placeholder="$request"
              />
            </FormGroup>
            <FormGroup label="Condition" fieldId={`kserve-step-condition-${index}`}>
              <TextInput
                id={`kserve-step-condition-${index}`}
                value={step.condition}
                onChange={(_event, value) => {
                  const nextSteps: GraphStepDraft[] = graphSteps.map((item, itemIndex) =>
                    itemIndex === index ? { ...item, condition: value } : item,
                  );
                  patchDraft((next) => writeGraphSteps(next, nextSteps));
                }}
                placeholder='[@this].#(predictions.0=="dog")'
              />
            </FormGroup>
          </div>
        ))}
        <Button
          variant="link"
          icon={<PlusCircleIcon />}
          onClick={() =>
            patchDraft((next) =>
              writeGraphSteps(next, [
                ...graphSteps,
                { serviceName: '', name: '', data: '', condition: '', extra: {} },
              ]),
            )
          }
          style={addLinkStyle}
        >
          Add step
        </Button>
      </FormGroup>
      <FormGroup label="Resources" fieldId="kserve-graph-resources">
        <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }}>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-graph-cpu-request"
              value={specResourceValue(draft, 'requests', 'cpu')}
              onChange={(_event, value) =>
                patchDraft((next) => writeSpecResourceValue(next, 'requests', 'cpu', value))
              }
              placeholder="CPU request"
              aria-label="CPU request"
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-graph-memory-request"
              value={specResourceValue(draft, 'requests', 'memory')}
              onChange={(_event, value) =>
                patchDraft((next) => writeSpecResourceValue(next, 'requests', 'memory', value))
              }
              placeholder="Memory request"
              aria-label="Memory request"
            />
          </FlexItem>
        </Flex>
        <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: '0.5rem' }}>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-graph-cpu-limit"
              value={specResourceValue(draft, 'limits', 'cpu')}
              onChange={(_event, value) =>
                patchDraft((next) => writeSpecResourceValue(next, 'limits', 'cpu', value))
              }
              placeholder="CPU limit"
              aria-label="CPU limit"
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id="kserve-graph-memory-limit"
              value={specResourceValue(draft, 'limits', 'memory')}
              onChange={(_event, value) =>
                patchDraft((next) => writeSpecResourceValue(next, 'limits', 'memory', value))
              }
              placeholder="Memory limit"
              aria-label="Memory limit"
            />
          </FlexItem>
        </Flex>
      </FormGroup>
    </>
  );

  const renderWorkerSpec = () => (
    <FormGroup label="Worker spec" fieldId="kserve-worker-spec">
      <FormHelperText>
        <HelperText>
          <HelperTextItem>
            Integers starting at 1. Remaining workerSpec keys can be set in the YAML editor.
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
      <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: '0.5rem' }}>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
          <TextInput
            id="kserve-pipeline-parallel"
            type="text"
            inputMode="numeric"
            value={workerSpecNumber(draft, 'pipelineParallelSize')}
            onChange={(_event, value) =>
              patchDraft((next) => writeWorkerSpecNumber(next, 'pipelineParallelSize', value))
            }
            placeholder="Pipeline parallel size"
            aria-label="Pipeline parallel size"
          />
        </FlexItem>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
          <TextInput
            id="kserve-tensor-parallel"
            type="text"
            inputMode="numeric"
            value={workerSpecNumber(draft, 'tensorParallelSize')}
            onChange={(_event, value) =>
              patchDraft((next) => writeWorkerSpecNumber(next, 'tensorParallelSize', value))
            }
            placeholder="Tensor parallel size"
            aria-label="Tensor parallel size"
          />
        </FlexItem>
      </Flex>
    </FormGroup>
  );

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
          <FormGroup role="radiogroup" isInline fieldId="kserve-editor-mode" label="Editor">
            <Radio
              id="kserve-mode-fields"
              name="kserve-editor-mode"
              label="Fields"
              isChecked={mode === 'fields'}
              onChange={() => switchMode('fields')}
            />
            <Radio
              id="kserve-mode-yaml"
              name="kserve-editor-mode"
              label="YAML"
              isChecked={mode === 'yaml'}
              onChange={() => switchMode('yaml')}
            />
          </FormGroup>
          {mode === 'fields' ? (
            <>
              {renderCatalogFields('basic')}
              {renderLabels()}
              {kind.kind === 'InferenceService' ? renderInferenceServiceBasics() : null}
              {kind.kind === 'InferenceGraph' ? renderInferenceGraphBasics() : null}
              <div style={{ marginTop: '1rem' }}>
                <ExpandableSection
                  toggleText="Advanced"
                  isExpanded={advancedOpen}
                  onToggle={(_event, expanded) => setAdvancedOpen(expanded)}
                >
                  {renderCatalogFields('advanced')}
                  {kind.kind === 'InferenceService' ? renderWorkerSpec() : null}
                </ExpandableSection>
              </div>
            </>
          ) : (
            <FormGroup label="YAML" isRequired fieldId="kserve-manifest">
              <TextArea
                id="kserve-manifest"
                value={manifestText}
                onChange={(_event, value) => onManifestChange(value)}
                rows={22}
                resizeOrientation="vertical"
                validated={manifestError ? 'error' : 'default'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>
                    {manifestError ?? `YAML of the full ${kind.title}.`}
                  </HelperTextItem>
                </HelperText>
              </FormHelperText>
            </FormGroup>
          )}
        </Form>
      </ModalBody>
      <ModalFooter>
        <Button
          key="create"
          variant="primary"
          type="submit"
          form="kserve-resource-form"
          isLoading={isSaving}
          isDisabled={isSaving}
          style={{
            backgroundColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
            color: 'var(--pf-t--global--text--color--on-brand, #fff)',
          }}
        >
          {isEdit ? 'Save' : 'Create'}
        </Button>
        <Button key="cancel" variant="link" onClick={onClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ResourceFormModal;
