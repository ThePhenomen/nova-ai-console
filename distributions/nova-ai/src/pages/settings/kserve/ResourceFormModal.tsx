import React from 'react';
import {
  Alert,
  Button,
  Checkbox,
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
  Switch,
  TextArea,
  TextInput,
} from '@patternfly/react-core';
import { MinusCircleIcon, PlusCircleIcon } from '@patternfly/react-icons';
import { K8sApiError } from '../../../cluster/k8sClient';
import { NAMESPACE_NAME_PATTERN } from '../../projects/projectApi';
import { cloneResource, parseManifest, toManifest } from '../../deployments/manifest';
import { createSettingsResource, updateSettingsResource } from './api';
import {
  PROTOCOL_VERSIONS,
  WORKLOAD_TYPES,
  type KServeSettingsResource,
  type SettingsKindCatalog,
} from './catalog';
import {
  asRecord,
  emptyContainer,
  emptyProbe,
  emptyResource,
  ensureSpec,
  prepareForSave,
  prometheusAnnotation,
  readContainer,
  readContainers,
  readContainersOrBlank,
  readLabels,
  readModelFormats,
  readProtocolVersions,
  readUriFormats,
  readVolumes,
  workerParallel,
  writeContainer,
  writeContainers,
  writeLabels,
  writeModelFormats,
  writePrometheusAnnotation,
  writeUriFormats,
  writeVolumes,
  writeWorkerParallel,
  type ContainerDraft,
  type EnvDraft,
  type LabelDraft,
  type ModelFormatDraft,
  type ProbeDraft,
  type UriFormatDraft,
  type VolumeDraft,
  type VolumeMountDraft,
} from './helpers';

type ResourceFormModalProps = {
  kind: SettingsKindCatalog;
  namespaces?: string[];
  resource?: KServeSettingsResource;
  duplicate?: boolean;
  onClose: () => void;
  onSaved: () => void;
};

type EditorMode = 'fields' | 'yaml';

const addLinkStyle: React.CSSProperties = {
  paddingLeft: 0,
  marginTop: '0.25rem',
  color: 'var(--pf-t--global--color--brand--default, #0066cc)',
};

const cardStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.75rem',
  border: '1px solid var(--pf-t--global--border--color--default, #a2a9b4)',
  borderRadius: '8px',
};

const ResourceFormModal: React.FC<ResourceFormModalProps> = ({
  kind,
  namespaces,
  resource,
  duplicate = false,
  onClose,
  onSaved,
}) => {
  const isEdit = Boolean(resource) && !duplicate;
  const defaultNamespace = resource?.metadata.namespace ?? namespaces?.[0] ?? '';
  const [draft, setDraft] = React.useState<KServeSettingsResource>(() =>
    resource ? cloneResource(resource) : emptyResource(kind, defaultNamespace),
  );
  const [mode, setMode] = React.useState<EditorMode>('fields');
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [manifestText, setManifestText] = React.useState(() =>
    toManifest(
      (resource ? cloneResource(resource) : emptyResource(kind, defaultNamespace)) as Record<
        string,
        unknown
      >,
    ),
  );
  const [error, setError] = React.useState<string | null>(null);
  const [manifestError, setManifestError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [labelRows, setLabelRows] = React.useState<LabelDraft[]>(() =>
    readLabels(resource?.metadata.labels),
  );

  const isStorage = kind.kind === 'ClusterStorageContainer';
  const isRuntime = !isStorage;
  const spec = asRecord(draft.spec) ?? {};
  const storageContainer = readContainer(spec.container, 'storage-initializer');
  const runtimeContainers = readContainersOrBlank(spec.containers, 'kserve-container');
  const workerContainers = readContainers(
    asRecord(spec.workerSpec)?.containers,
    'worker-container',
  );
  const volumes = readVolumes(spec.volumes);
  const workerVolumes = readVolumes(asRecord(spec.workerSpec)?.volumes);
  const uriFormats = readUriFormats(spec.supportedUriFormats);
  const modelFormats = readModelFormats(spec.supportedModelFormats);
  const protocolVersions = readProtocolVersions(spec.protocolVersions);

  const applyDraft = (next: KServeSettingsResource) => {
    setDraft(next);
    setManifestText(toManifest(next as Record<string, unknown>));
    setManifestError(null);
  };

  const patchDraft = (mutate: (next: KServeSettingsResource) => void) => {
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
      const parsed = parseManifest(manifestText) as KServeSettingsResource;
      if (!parsed.metadata) {
        parsed.metadata = { name: '' };
      }
      parsed.apiVersion = parsed.apiVersion ?? kind.apiVersion;
      parsed.kind = parsed.kind ?? kind.kind;
      setDraft(parsed);
      setLabelRows(readLabels(parsed.metadata.labels));
      setManifestError(null);
      setMode(nextMode);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not parse YAML.';
      setManifestError(message);
      setError(message);
    }
  };

  const onManifestChange = (value: string) => {
    setManifestText(value);
    try {
      const parsed = parseManifest(value) as KServeSettingsResource;
      if (!parsed.metadata) {
        parsed.metadata = { name: '' };
      }
      parsed.apiVersion = parsed.apiVersion ?? kind.apiVersion;
      parsed.kind = parsed.kind ?? kind.kind;
      setDraft(parsed);
      setLabelRows(readLabels(parsed.metadata.labels));
      setManifestError(null);
    } catch (err) {
      setManifestError(err instanceof Error ? err.message : 'Could not parse YAML.');
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    const name = draft.metadata.name.trim();
    if (!NAMESPACE_NAME_PATTERN.test(name) || name.length > 63) {
      setError('Name must be a DNS-1123 label: lowercase alphanumeric or hyphen, max 63 characters.');
      return;
    }
    if (kind.scope === 'Namespaced' && !draft.metadata.namespace) {
      setError('Select a project for this ServingRuntime.');
      return;
    }
    if (kind.kind === 'ClusterStorageContainer') {
      const formats = writeUriFormats(readUriFormats(asRecord(draft.spec)?.supportedUriFormats));
      const container = readContainer(asRecord(draft.spec)?.container, 'storage-initializer');
      if (!container.image.trim()) {
        setError('Image is required.');
        return;
      }
      if (formats.length === 0) {
        setError('Add at least one supported URI prefix or regex.');
        return;
      }
    }
    if (kind.kind !== 'ClusterStorageContainer' && mode === 'fields') {
      const formats = writeModelFormats(readModelFormats(asRecord(draft.spec)?.supportedModelFormats));
      const containers = readContainersOrBlank(asRecord(draft.spec)?.containers, 'kserve-container');
      if (!formats || formats.length === 0) {
        setError('Add at least one supported model format.');
        return;
      }
      if (!containers.some((item) => item.image.trim())) {
        setError('Container image is required.');
        return;
      }
    }
    setIsSaving(true);
    try {
      const payload = prepareForSave(draft, kind);
      payload.metadata.name = name;
      payload.metadata.labels = writeLabels(labelRows);
      if (mode === 'yaml') {
        const parsed = parseManifest(manifestText) as KServeSettingsResource;
        parsed.apiVersion = parsed.apiVersion ?? kind.apiVersion;
        parsed.kind = parsed.kind ?? kind.kind;
        if (isEdit) {
          await updateSettingsResource(kind, parsed);
        } else {
          await createSettingsResource(kind, parsed);
        }
      } else if (isEdit) {
        await updateSettingsResource(kind, payload);
      } else {
        await createSettingsResource(kind, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof K8sApiError || err instanceof Error ? err.message : 'Failed to save resource.');
    } finally {
      setIsSaving(false);
    }
  };

  const writeStorageContainer = (nextContainer: ContainerDraft) => {
    patchDraft((next) => {
      const nextSpec = ensureSpec(next);
      const written = writeContainer(nextContainer);
      if (written) {
        nextSpec.container = written;
      }
    });
  };

  const writeRuntimeContainers = (rows: ContainerDraft[]) => {
    patchDraft((next) => {
      const nextSpec = ensureSpec(next);
      const written = writeContainers(rows);
      if (written) {
        nextSpec.containers = written;
      } else {
        delete nextSpec.containers;
      }
    });
  };

  const writeWorkerContainers = (rows: ContainerDraft[]) => {
    patchDraft((next) => {
      const nextSpec = ensureSpec(next);
      const workerSpec = { ...(asRecord(nextSpec.workerSpec) ?? {}) };
      const written = writeContainers(rows);
      if (written) {
        workerSpec.containers = written;
      } else {
        delete workerSpec.containers;
      }
      if (Object.keys(workerSpec).length === 0) {
        delete nextSpec.workerSpec;
      } else {
        nextSpec.workerSpec = workerSpec;
      }
    });
  };

  const renderStringList = (
    label: string,
    id: string,
    items: string[],
    onChange: (next: string[]) => void,
    placeholder: string,
    useArea = false,
  ) => (
    <FormGroup label={label} fieldId={id}>
      {items.map((item, index) => (
        <Flex key={`${id}-${index}`} spaceItems={{ default: 'spaceItemsSm' }} style={{ marginTop: index === 0 ? 0 : '0.35rem' }}>
          <FlexItem grow={{ default: 'grow' }}>
            {useArea ? (
              <TextArea
                id={`${id}-${index}`}
                value={item}
                onChange={(_event, value) =>
                  onChange(items.map((current, itemIndex) => (itemIndex === index ? value : current)))
                }
                rows={Math.min(8, Math.max(3, item.split('\n').length))}
                resizeOrientation="vertical"
                aria-label={`${label} ${index + 1}`}
              />
            ) : (
              <TextInput
                id={`${id}-${index}`}
                value={item}
                onChange={(_event, value) =>
                  onChange(items.map((current, itemIndex) => (itemIndex === index ? value : current)))
                }
                placeholder={placeholder}
              />
            )}
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              icon={<MinusCircleIcon />}
              onClick={() => onChange(items.filter((_current, itemIndex) => itemIndex !== index))}
              aria-label={`Remove ${label} ${index + 1}`}
            />
          </FlexItem>
        </Flex>
      ))}
      <Button variant="link" icon={<PlusCircleIcon />} onClick={() => onChange([...items, ''])} style={addLinkStyle}>
        Add {label.toLowerCase()}
      </Button>
    </FormGroup>
  );

  const renderEnv = (container: ContainerDraft, onChange: (next: ContainerDraft) => void, idPrefix: string) => (
    <FormGroup label="Env" fieldId={`${idPrefix}-env`}>
      {container.env.map((row, index) => (
        <Flex
          key={`${idPrefix}-env-${index}`}
          spaceItems={{ default: 'spaceItemsSm' }}
          flexWrap={{ default: 'wrap' }}
          style={{ marginTop: index === 0 ? 0 : '0.35rem' }}
        >
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
            <TextInput
              id={`${idPrefix}-env-name-${index}`}
              value={row.name}
              onChange={(_event, value) => {
                const env: EnvDraft[] = container.env.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, name: value } : item,
                );
                onChange({ ...container, env });
              }}
              placeholder="Name"
              aria-label={`Env name ${index + 1}`}
            />
          </FlexItem>
          <FlexItem style={{ minWidth: '8rem' }}>
            <FormSelect
              id={`${idPrefix}-env-mode-${index}`}
              value={row.fieldPath ? 'fieldRef' : 'value'}
              onChange={(_event, value) => {
                const env: EnvDraft[] = container.env.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, fieldPath: value === 'fieldRef' ? item.fieldPath || 'metadata.namespace' : '', value: value === 'value' ? item.value : '' }
                    : item,
                );
                onChange({ ...container, env });
              }}
              aria-label={`Env source ${index + 1}`}
            >
              <FormSelectOption value="value" label="Value" />
              <FormSelectOption value="fieldRef" label="Field ref" />
            </FormSelect>
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id={`${idPrefix}-env-value-${index}`}
              value={row.fieldPath || row.value}
              onChange={(_event, value) => {
                const env: EnvDraft[] = container.env.map((item, itemIndex) =>
                  itemIndex === index
                    ? item.fieldPath
                      ? { ...item, fieldPath: value }
                      : { ...item, value }
                    : item,
                );
                onChange({ ...container, env });
              }}
              placeholder={row.fieldPath ? 'metadata.namespace' : 'value'}
              aria-label={`Env value ${index + 1}`}
            />
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              icon={<MinusCircleIcon />}
              onClick={() => onChange({ ...container, env: container.env.filter((_item, itemIndex) => itemIndex !== index) })}
              aria-label={`Remove env ${index + 1}`}
            />
          </FlexItem>
        </Flex>
      ))}
      <Button
        variant="link"
        icon={<PlusCircleIcon />}
        onClick={() => onChange({ ...container, env: [...container.env, { name: '', value: '', fieldPath: '' }] })}
        style={addLinkStyle}
      >
        Add env
      </Button>
    </FormGroup>
  );

  const renderResources = (container: ContainerDraft, onChange: (next: ContainerDraft) => void, idPrefix: string) => (
    <FormGroup label="Resources" fieldId={`${idPrefix}-resources`}>
      <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }}>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
          <TextInput
            id={`${idPrefix}-cpu-request`}
            value={container.cpuRequest}
            onChange={(_event, value) => onChange({ ...container, cpuRequest: value })}
            placeholder="CPU request"
            aria-label="CPU request"
          />
        </FlexItem>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
          <TextInput
            id={`${idPrefix}-memory-request`}
            value={container.memoryRequest}
            onChange={(_event, value) => onChange({ ...container, memoryRequest: value })}
            placeholder="Memory request"
            aria-label="Memory request"
          />
        </FlexItem>
      </Flex>
      <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: '0.5rem' }}>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
          <TextInput
            id={`${idPrefix}-cpu-limit`}
            value={container.cpuLimit}
            onChange={(_event, value) => onChange({ ...container, cpuLimit: value })}
            placeholder="CPU limit"
            aria-label="CPU limit"
          />
        </FlexItem>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
          <TextInput
            id={`${idPrefix}-memory-limit`}
            value={container.memoryLimit}
            onChange={(_event, value) => onChange({ ...container, memoryLimit: value })}
            placeholder="Memory limit"
            aria-label="Memory limit"
          />
        </FlexItem>
      </Flex>
    </FormGroup>
  );

  const renderSecurity = (container: ContainerDraft, onChange: (next: ContainerDraft) => void, idPrefix: string) => (
    <FormGroup label="Security context" fieldId={`${idPrefix}-security`}>
      <Checkbox
        id={`${idPrefix}-nonroot`}
        label="Run as non-root"
        isChecked={container.security.runAsNonRoot}
        onChange={(_event, checked) =>
          onChange({ ...container, security: { ...container.security, runAsNonRoot: checked } })
        }
      />
      <Checkbox
        id={`${idPrefix}-privileged`}
        label="Privileged"
        isChecked={container.security.privileged}
        onChange={(_event, checked) =>
          onChange({ ...container, security: { ...container.security, privileged: checked } })
        }
      />
      <Checkbox
        id={`${idPrefix}-escalation`}
        label="Allow privilege escalation"
        isChecked={container.security.allowPrivilegeEscalation}
        onChange={(_event, checked) =>
          onChange({ ...container, security: { ...container.security, allowPrivilegeEscalation: checked } })
        }
      />
      {renderStringList(
        'Drop capabilities',
        `${idPrefix}-drop`,
        container.security.dropCapabilities,
        (dropCapabilities) => onChange({ ...container, security: { ...container.security, dropCapabilities } }),
        'ALL',
      )}
    </FormGroup>
  );

  const renderProbe = (
    title: string,
    probe: ProbeDraft,
    onChange: (next: ProbeDraft) => void,
    idPrefix: string,
  ) => (
    <div style={cardStyle}>
      <Checkbox
        id={`${idPrefix}-enabled`}
        label={title}
        isChecked={probe.enabled}
        onChange={(_event, checked) => onChange({ ...probe, enabled: checked })}
      />
      {probe.enabled ? (
        <>
          <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: '0.5rem' }}>
            <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
              <TextInput
                id={`${idPrefix}-failure`}
                value={probe.failureThreshold}
                onChange={(_event, value) => onChange({ ...probe, failureThreshold: value })}
                placeholder="Failure threshold"
                aria-label="Failure threshold"
              />
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
              <TextInput
                id={`${idPrefix}-period`}
                value={probe.periodSeconds}
                onChange={(_event, value) => onChange({ ...probe, periodSeconds: value })}
                placeholder="Period seconds"
                aria-label="Period seconds"
              />
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
              <TextInput
                id={`${idPrefix}-timeout`}
                value={probe.timeoutSeconds}
                onChange={(_event, value) => onChange({ ...probe, timeoutSeconds: value })}
                placeholder="Timeout seconds"
                aria-label="Timeout seconds"
              />
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
              <TextInput
                id={`${idPrefix}-initial`}
                value={probe.initialDelaySeconds}
                onChange={(_event, value) => onChange({ ...probe, initialDelaySeconds: value })}
                placeholder="Initial delay seconds"
                aria-label="Initial delay seconds"
              />
            </FlexItem>
          </Flex>
          <FormGroup label="Exec command" fieldId={`${idPrefix}-exec`} style={{ marginTop: '0.5rem' }}>
            <TextArea
              id={`${idPrefix}-exec`}
              value={probe.execCommand}
              onChange={(_event, value) => onChange({ ...probe, execCommand: value })}
              rows={6}
              resizeOrientation="vertical"
            />
            <FormHelperText>
              <HelperText>
                <HelperTextItem>One argv item per line, for example bash then -c then the script.</HelperTextItem>
              </HelperText>
            </FormHelperText>
          </FormGroup>
        </>
      ) : null}
    </div>
  );

  const renderVolumeMounts = (container: ContainerDraft, onChange: (next: ContainerDraft) => void, idPrefix: string) => (
    <FormGroup label="Volume mounts" fieldId={`${idPrefix}-mounts`}>
      {container.volumeMounts.map((row, index) => (
        <Flex key={`${idPrefix}-mount-${index}`} spaceItems={{ default: 'spaceItemsSm' }} style={{ marginTop: index === 0 ? 0 : '0.35rem' }}>
          <FlexItem grow={{ default: 'grow' }}>
            <TextInput
              value={row.name}
              onChange={(_event, value) => {
                const volumeMounts: VolumeMountDraft[] = container.volumeMounts.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, name: value } : item,
                );
                onChange({ ...container, volumeMounts });
              }}
              placeholder="Name"
              aria-label={`Volume mount name ${index + 1}`}
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }}>
            <TextInput
              value={row.mountPath}
              onChange={(_event, value) => {
                const volumeMounts: VolumeMountDraft[] = container.volumeMounts.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, mountPath: value } : item,
                );
                onChange({ ...container, volumeMounts });
              }}
              placeholder="/dev/shm"
              aria-label={`Volume mount path ${index + 1}`}
            />
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              icon={<MinusCircleIcon />}
              onClick={() =>
                onChange({
                  ...container,
                  volumeMounts: container.volumeMounts.filter((_item, itemIndex) => itemIndex !== index),
                })
              }
              aria-label={`Remove volume mount ${index + 1}`}
            />
          </FlexItem>
        </Flex>
      ))}
      <Button
        variant="link"
        icon={<PlusCircleIcon />}
        onClick={() => onChange({ ...container, volumeMounts: [...container.volumeMounts, { name: '', mountPath: '' }] })}
        style={addLinkStyle}
      >
        Add volume mount
      </Button>
    </FormGroup>
  );

  const renderVolumes = (
    label: string,
    id: string,
    rows: VolumeDraft[],
    onChange: (next: VolumeDraft[]) => void,
  ) => (
    <FormGroup label={label} fieldId={id}>
      {rows.map((row, index) => (
        <Flex key={`${id}-${index}`} spaceItems={{ default: 'spaceItemsSm' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: index === 0 ? 0 : '0.35rem' }}>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
            <TextInput
              value={row.name}
              onChange={(_event, value) =>
                onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, name: value } : item)))
              }
              placeholder="Name"
              aria-label={`${label} name ${index + 1}`}
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
            <TextInput
              value={row.medium}
              onChange={(_event, value) =>
                onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, medium: value } : item)))
              }
              placeholder="Medium (Memory)"
              aria-label={`${label} medium ${index + 1}`}
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
            <TextInput
              value={row.sizeLimit}
              onChange={(_event, value) =>
                onChange(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, sizeLimit: value } : item)))
              }
              placeholder="Size limit"
              aria-label={`${label} size ${index + 1}`}
            />
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              icon={<MinusCircleIcon />}
              onClick={() => onChange(rows.filter((_item, itemIndex) => itemIndex !== index))}
              aria-label={`Remove ${label} ${index + 1}`}
            />
          </FlexItem>
        </Flex>
      ))}
      <Button
        variant="link"
        icon={<PlusCircleIcon />}
        onClick={() => onChange([...rows, { name: '', medium: 'Memory', sizeLimit: '' }])}
        style={addLinkStyle}
      >
        Add volume
      </Button>
    </FormGroup>
  );

  const renderContainerBasics = (
    title: string,
    container: ContainerDraft,
    onChange: (next: ContainerDraft) => void,
    idPrefix: string,
    onRemove?: () => void,
  ) => (
    <div style={cardStyle}>
      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
        <FlexItem>
          <strong>{title}</strong>
        </FlexItem>
        {onRemove ? (
          <FlexItem>
            <Button variant="plain" icon={<MinusCircleIcon />} onClick={onRemove} aria-label={`Remove ${title}`} />
          </FlexItem>
        ) : null}
      </Flex>
      <FormGroup label="Container name" isRequired fieldId={`${idPrefix}-name`}>
        <TextInput
          id={`${idPrefix}-name`}
          value={container.name}
          onChange={(_event, value) => onChange({ ...container, name: value })}
        />
      </FormGroup>
      <FormGroup label="Image" isRequired fieldId={`${idPrefix}-image`}>
        <TextInput
          id={`${idPrefix}-image`}
          value={container.image}
          onChange={(_event, value) => onChange({ ...container, image: value })}
          placeholder="registry/kserve/lgbserver:v0.15.2"
        />
      </FormGroup>
      {renderStringList('Args', `${idPrefix}-args`, container.args, (args) => onChange({ ...container, args }), '--model_name={{.Name}}')}
      {renderEnv(container, onChange, idPrefix)}
      {renderResources(container, onChange, idPrefix)}
    </div>
  );

  const renderContainerAdvanced = (
    container: ContainerDraft,
    onChange: (next: ContainerDraft) => void,
    idPrefix: string,
  ) => (
    <>
      {renderStringList(
        'Command',
        `${idPrefix}-command`,
        container.command,
        (command) => onChange({ ...container, command }),
        'bash',
        true,
      )}
      {renderSecurity(container, onChange, idPrefix)}
      {renderVolumeMounts(container, onChange, idPrefix)}
      {renderProbe('Liveness probe', container.livenessProbe, (livenessProbe) => onChange({ ...container, livenessProbe }), `${idPrefix}-live`)}
      {renderProbe('Readiness probe', container.readinessProbe, (readinessProbe) => onChange({ ...container, readinessProbe }), `${idPrefix}-ready`)}
      {renderProbe('Startup probe', container.startupProbe, (startupProbe) => onChange({ ...container, startupProbe }), `${idPrefix}-start`)}
    </>
  );

  const renderLabels = () => (
    <FormGroup label="Labels" fieldId="settings-labels">
      {labelRows.map((row, index) => (
        <Flex key={`label-${index}`} spaceItems={{ default: 'spaceItemsSm' }} style={{ marginTop: index === 0 ? 0 : '0.35rem' }}>
          <FlexItem grow={{ default: 'grow' }}>
            <TextInput
              value={row.key}
              onChange={(_event, value) =>
                setLabelRows(labelRows.map((item, itemIndex) => (itemIndex === index ? { ...item, key: value } : item)))
              }
              placeholder="Key"
              aria-label={`Label key ${index + 1}`}
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }}>
            <TextInput
              value={row.value}
              onChange={(_event, value) =>
                setLabelRows(labelRows.map((item, itemIndex) => (itemIndex === index ? { ...item, value } : item)))
              }
              placeholder="Value"
              aria-label={`Label value ${index + 1}`}
            />
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              icon={<MinusCircleIcon />}
              onClick={() => setLabelRows(labelRows.filter((_item, itemIndex) => itemIndex !== index))}
              aria-label={`Remove label ${index + 1}`}
            />
          </FlexItem>
        </Flex>
      ))}
      <Button variant="link" icon={<PlusCircleIcon />} onClick={() => setLabelRows([...labelRows, { key: '', value: '' }])} style={addLinkStyle}>
        Add label
      </Button>
    </FormGroup>
  );

  return (
    <Modal
      isOpen
      variant="large"
      onClose={onClose}
      aria-label={isEdit ? `Edit ${kind.kind}` : duplicate ? `Duplicate ${kind.kind}` : `Create ${kind.kind}`}
    >
      <ModalHeader
        title={isEdit ? `Edit ${kind.kind}` : duplicate ? `Duplicate ${kind.kind}` : `Create ${kind.kind}`}
      />
      <ModalBody>
        <Form id="kserve-settings-form" onSubmit={save}>
          {error ? (
            <Alert variant="danger" isInline title="Could not save resource">
              {error}
            </Alert>
          ) : null}
          {kind.scope === 'Namespaced' && namespaces && namespaces.length > 0 ? (
            <FormGroup label="Project" isRequired fieldId="settings-namespace">
              <FormSelect
                id="settings-namespace"
                value={draft.metadata.namespace ?? ''}
                onChange={(_event, value) =>
                  patchDraft((next) => {
                    next.metadata.namespace = value;
                  })
                }
                isDisabled={isEdit}
                aria-label="Project"
              >
                {namespaces.map((item) => (
                  <FormSelectOption key={item} value={item} label={item} />
                ))}
              </FormSelect>
            </FormGroup>
          ) : null}
          <FormGroup role="radiogroup" isInline fieldId="settings-editor-mode" label="Editor">
            <Radio
              id="settings-mode-fields"
              name="settings-editor-mode"
              label="Fields"
              isChecked={mode === 'fields'}
              onChange={() => switchMode('fields')}
            />
            <Radio
              id="settings-mode-yaml"
              name="settings-editor-mode"
              label="YAML"
              isChecked={mode === 'yaml'}
              onChange={() => switchMode('yaml')}
            />
          </FormGroup>
          {mode === 'fields' ? (
            <>
              <FormGroup label="Name" isRequired fieldId="settings-name">
                <TextInput
                  id="settings-name"
                  value={draft.metadata.name}
                  onChange={(_event, value) =>
                    patchDraft((next) => {
                      next.metadata.name = value;
                    })
                  }
                  isDisabled={isEdit}
                />
              </FormGroup>
              {renderLabels()}
              {isStorage ? (
                <>
                  {renderContainerBasics('Storage initializer', storageContainer, writeStorageContainer, 'storage')}
                  <FormGroup label="Supported URI formats" isRequired fieldId="settings-uri">
                    {uriFormats.map((row, index) => (
                      <Flex key={`uri-${index}`} spaceItems={{ default: 'spaceItemsSm' }} style={{ marginTop: index === 0 ? 0 : '0.35rem' }}>
                        <FlexItem style={{ minWidth: '8rem' }}>
                          <FormSelect
                            value={row.mode}
                            onChange={(_event, value) => {
                              const nextRows: UriFormatDraft[] = uriFormats.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, mode: value === 'regex' ? 'regex' : 'prefix' } : item,
                              );
                              patchDraft((next) => {
                                ensureSpec(next).supportedUriFormats = writeUriFormats(nextRows);
                              });
                            }}
                            aria-label={`URI format type ${index + 1}`}
                          >
                            <FormSelectOption value="prefix" label="Prefix" />
                            <FormSelectOption value="regex" label="Regex" />
                          </FormSelect>
                        </FlexItem>
                        <FlexItem grow={{ default: 'grow' }}>
                          <TextInput
                            value={row.value}
                            onChange={(_event, value) => {
                              const nextRows: UriFormatDraft[] = uriFormats.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, value } : item,
                              );
                              patchDraft((next) => {
                                ensureSpec(next).supportedUriFormats = writeUriFormats(nextRows);
                              });
                            }}
                            placeholder={row.mode === 'regex' ? 'hf://' : 's3://'}
                          />
                        </FlexItem>
                        <FlexItem>
                          <Button
                            variant="plain"
                            icon={<MinusCircleIcon />}
                            onClick={() =>
                              patchDraft((next) => {
                                ensureSpec(next).supportedUriFormats = writeUriFormats(
                                  uriFormats.filter((_item, itemIndex) => itemIndex !== index),
                                );
                              })
                            }
                            aria-label={`Remove URI format ${index + 1}`}
                          />
                        </FlexItem>
                      </Flex>
                    ))}
                    <Button
                      variant="link"
                      icon={<PlusCircleIcon />}
                      onClick={() =>
                        patchDraft((next) => {
                          ensureSpec(next).supportedUriFormats = writeUriFormats([
                            ...uriFormats,
                            { mode: 'prefix', value: '' },
                          ]);
                        })
                      }
                      style={addLinkStyle}
                    >
                      Add URI format
                    </Button>
                  </FormGroup>
                  <FormGroup label="Workload type" fieldId="settings-workload">
                    <FormSelect
                      id="settings-workload"
                      value={String(spec.workloadType ?? 'initContainer')}
                      onChange={(_event, value) =>
                        patchDraft((next) => {
                          ensureSpec(next).workloadType = value;
                        })
                      }
                      aria-label="Workload type"
                    >
                      {WORKLOAD_TYPES.map((item) => (
                        <FormSelectOption key={item} value={item} label={item} />
                      ))}
                    </FormSelect>
                  </FormGroup>
                </>
              ) : null}
              {isRuntime ? (
                <>
                  <FormGroup label="Prometheus port" fieldId="settings-prom-port">
                    <TextInput
                      id="settings-prom-port"
                      value={prometheusAnnotation(draft, 'port')}
                      onChange={(_event, value) =>
                        patchDraft((next) => writePrometheusAnnotation(next, 'port', value))
                      }
                      placeholder="8080"
                    />
                  </FormGroup>
                  <FormGroup label="Prometheus path" fieldId="settings-prom-path">
                    <TextInput
                      id="settings-prom-path"
                      value={prometheusAnnotation(draft, 'path')}
                      onChange={(_event, value) =>
                        patchDraft((next) => writePrometheusAnnotation(next, 'path', value))
                      }
                      placeholder="/metrics"
                    />
                  </FormGroup>
                  <FormGroup label="Supported model formats" isRequired fieldId="settings-formats">
                    {modelFormats.map((row, index) => (
                      <div key={`format-${index}`} style={cardStyle}>
                        <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }}>
                          <FlexItem>
                            <strong>Format {index + 1}</strong>
                          </FlexItem>
                          <FlexItem>
                            <Button
                              variant="plain"
                              icon={<MinusCircleIcon />}
                              onClick={() =>
                                patchDraft((next) => {
                                  ensureSpec(next).supportedModelFormats = writeModelFormats(
                                    modelFormats.filter((_item, itemIndex) => itemIndex !== index),
                                  );
                                })
                              }
                              aria-label={`Remove format ${index + 1}`}
                            />
                          </FlexItem>
                        </Flex>
                        <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }}>
                          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
                            <TextInput
                              value={row.name}
                              onChange={(_event, value) => {
                                const nextRows: ModelFormatDraft[] = modelFormats.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, name: value } : item,
                                );
                                patchDraft((next) => {
                                  ensureSpec(next).supportedModelFormats = writeModelFormats(nextRows);
                                });
                              }}
                              placeholder="lightgbm"
                              aria-label={`Format name ${index + 1}`}
                            />
                          </FlexItem>
                          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '6rem' }}>
                            <TextInput
                              value={row.version}
                              onChange={(_event, value) => {
                                const nextRows: ModelFormatDraft[] = modelFormats.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, version: value } : item,
                                );
                                patchDraft((next) => {
                                  ensureSpec(next).supportedModelFormats = writeModelFormats(nextRows);
                                });
                              }}
                              placeholder="Version"
                              aria-label={`Format version ${index + 1}`}
                            />
                          </FlexItem>
                          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '6rem' }}>
                            <TextInput
                              value={row.priority}
                              onChange={(_event, value) => {
                                const nextRows: ModelFormatDraft[] = modelFormats.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, priority: value } : item,
                                );
                                patchDraft((next) => {
                                  ensureSpec(next).supportedModelFormats = writeModelFormats(nextRows);
                                });
                              }}
                              placeholder="Priority"
                              aria-label={`Format priority ${index + 1}`}
                            />
                          </FlexItem>
                          <FlexItem>
                            <Checkbox
                              id={`format-auto-${index}`}
                              label="Auto select"
                              isChecked={row.autoSelect}
                              onChange={(_event, checked) => {
                                const nextRows: ModelFormatDraft[] = modelFormats.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, autoSelect: checked } : item,
                                );
                                patchDraft((next) => {
                                  ensureSpec(next).supportedModelFormats = writeModelFormats(nextRows);
                                });
                              }}
                            />
                          </FlexItem>
                        </Flex>
                      </div>
                    ))}
                    <Button
                      variant="link"
                      icon={<PlusCircleIcon />}
                      onClick={() =>
                        patchDraft((next) => {
                          ensureSpec(next).supportedModelFormats = writeModelFormats([
                            ...modelFormats,
                            { name: '', version: '', autoSelect: true, priority: '1' },
                          ]);
                        })
                      }
                      style={addLinkStyle}
                    >
                      Add model format
                    </Button>
                  </FormGroup>
                  <FormGroup label="Protocol versions" fieldId="settings-protocol">
                    <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }}>
                      {PROTOCOL_VERSIONS.map((item) => (
                        <FlexItem key={item}>
                          <Checkbox
                            id={`protocol-${item}`}
                            label={item}
                            isChecked={protocolVersions.includes(item)}
                            onChange={(_event, checked) =>
                              patchDraft((next) => {
                                const current = new Set(readProtocolVersions(ensureSpec(next).protocolVersions));
                                if (checked) {
                                  current.add(item);
                                } else {
                                  current.delete(item);
                                }
                                ensureSpec(next).protocolVersions = [...current];
                              })
                            }
                          />
                        </FlexItem>
                      ))}
                    </Flex>
                  </FormGroup>
                  {runtimeContainers.map((container, index) => (
                    <React.Fragment key={`runtime-container-${index}`}>
                      {renderContainerBasics(
                        `Container ${index + 1}`,
                        container,
                        (nextContainer) =>
                          writeRuntimeContainers(
                            runtimeContainers.map((item, itemIndex) =>
                              itemIndex === index ? nextContainer : item,
                            ),
                          ),
                        `runtime-${index}`,
                        runtimeContainers.length > 1
                          ? () => writeRuntimeContainers(runtimeContainers.filter((_item, itemIndex) => itemIndex !== index))
                          : undefined,
                      )}
                    </React.Fragment>
                  ))}
                  <Button
                    variant="link"
                    icon={<PlusCircleIcon />}
                    onClick={() => writeRuntimeContainers([...runtimeContainers, emptyContainer('kserve-container')])}
                    style={addLinkStyle}
                  >
                    Add container
                  </Button>
                </>
              ) : null}
              <div style={{ marginTop: '1rem' }}>
                <ExpandableSection
                  toggleText="Advanced"
                  isExpanded={advancedOpen}
                  onToggle={(_event, expanded) => setAdvancedOpen(expanded)}
                >
                  {isStorage ? (
                    <>
                      <Switch
                        id="settings-disabled"
                        label="Disabled"
                        isChecked={draft.disabled === true}
                        onChange={(_event, checked) =>
                          patchDraft((next) => {
                            if (checked) {
                              next.disabled = true;
                            } else {
                              delete next.disabled;
                            }
                          })
                        }
                      />
                      {renderContainerAdvanced(storageContainer, writeStorageContainer, 'storage-advanced')}
                    </>
                  ) : (
                    <>
                      <Switch
                        id="settings-disabled"
                        label="Disabled"
                        isChecked={spec.disabled === true}
                        onChange={(_event, checked) =>
                          patchDraft((next) => {
                            const nextSpec = ensureSpec(next);
                            if (checked) {
                              nextSpec.disabled = true;
                            } else {
                              delete nextSpec.disabled;
                            }
                          })
                        }
                      />
                      {runtimeContainers.map((container, index) => (
                        <div key={`runtime-advanced-${index}`} style={{ marginTop: '0.75rem' }}>
                          <strong>{container.name || `Container ${index + 1}`} advanced</strong>
                          {renderContainerAdvanced(
                            container,
                            (nextContainer) =>
                              writeRuntimeContainers(
                                runtimeContainers.map((item, itemIndex) =>
                                  itemIndex === index ? nextContainer : item,
                                ),
                              ),
                            `runtime-advanced-${index}`,
                          )}
                        </div>
                      ))}
                      {renderVolumes('Volumes', 'settings-volumes', volumes, (nextVolumes) =>
                        patchDraft((next) => {
                          const nextSpec = ensureSpec(next);
                          const written = writeVolumes(nextVolumes);
                          if (written) {
                            nextSpec.volumes = written;
                          } else {
                            delete nextSpec.volumes;
                          }
                        }),
                      )}
                      <FormGroup label="Worker spec" fieldId="settings-worker">
                        <FormHelperText>
                          <HelperText>
                            <HelperTextItem>
                              Pipeline and tensor parallel sizes are integers starting at 1. Worker containers,
                              volumes and probes belong here for multi-node runtimes.
                            </HelperTextItem>
                          </HelperText>
                        </FormHelperText>
                        <Flex spaceItems={{ default: 'spaceItemsMd' }} flexWrap={{ default: 'wrap' }} style={{ marginTop: '0.5rem' }}>
                          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
                            <TextInput
                              id="settings-pipeline-parallel"
                              type="text"
                              inputMode="numeric"
                              value={workerParallel(draft, 'pipelineParallelSize')}
                              onChange={(_event, value) =>
                                patchDraft((next) => writeWorkerParallel(next, 'pipelineParallelSize', value))
                              }
                              placeholder="Pipeline parallel size"
                              aria-label="Pipeline parallel size"
                            />
                          </FlexItem>
                          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
                            <TextInput
                              id="settings-tensor-parallel"
                              type="text"
                              inputMode="numeric"
                              value={workerParallel(draft, 'tensorParallelSize')}
                              onChange={(_event, value) =>
                                patchDraft((next) => writeWorkerParallel(next, 'tensorParallelSize', value))
                              }
                              placeholder="Tensor parallel size"
                              aria-label="Tensor parallel size"
                            />
                          </FlexItem>
                        </Flex>
                      </FormGroup>
                      {workerContainers.map((container, index) => (
                        <React.Fragment key={`worker-${index}`}>
                          {renderContainerBasics(
                            `Worker container ${index + 1}`,
                            container,
                            (nextContainer) =>
                              writeWorkerContainers(
                                workerContainers.map((item, itemIndex) =>
                                  itemIndex === index ? nextContainer : item,
                                ),
                              ),
                            `worker-${index}`,
                            () => writeWorkerContainers(workerContainers.filter((_item, itemIndex) => itemIndex !== index)),
                          )}
                          {renderContainerAdvanced(
                            container,
                            (nextContainer) =>
                              writeWorkerContainers(
                                workerContainers.map((item, itemIndex) =>
                                  itemIndex === index ? nextContainer : item,
                                ),
                              ),
                            `worker-advanced-${index}`,
                          )}
                        </React.Fragment>
                      ))}
                      <Button
                        variant="link"
                        icon={<PlusCircleIcon />}
                        onClick={() =>
                          writeWorkerContainers([...workerContainers, emptyContainer('worker-container')])
                        }
                        style={addLinkStyle}
                      >
                        Add worker container
                      </Button>
                      {renderVolumes('Worker volumes', 'settings-worker-volumes', workerVolumes, (nextVolumes) =>
                        patchDraft((next) => {
                          const nextSpec = ensureSpec(next);
                          const workerSpec = { ...(asRecord(nextSpec.workerSpec) ?? {}) };
                          const written = writeVolumes(nextVolumes);
                          if (written) {
                            workerSpec.volumes = written;
                          } else {
                            delete workerSpec.volumes;
                          }
                          if (Object.keys(workerSpec).length === 0) {
                            delete nextSpec.workerSpec;
                          } else {
                            nextSpec.workerSpec = workerSpec;
                          }
                        }),
                      )}
                    </>
                  )}
                </ExpandableSection>
              </div>
            </>
          ) : (
            <FormGroup label="YAML" isRequired fieldId="settings-manifest">
              <TextArea
                id="settings-manifest"
                value={manifestText}
                onChange={(_event, value) => onManifestChange(value)}
                rows={22}
                resizeOrientation="vertical"
                validated={manifestError ? 'error' : 'default'}
              />
              <FormHelperText>
                <HelperText>
                  <HelperTextItem>{manifestError ?? `YAML of the full ${kind.kind}.`}</HelperTextItem>
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
          form="kserve-settings-form"
          isLoading={isSaving}
          isDisabled={isSaving}
          style={{
            backgroundColor: 'var(--pf-t--global--color--brand--default, #0066cc)',
            color: 'var(--pf-t--global--text--color--on-brand, #fff)',
          }}
        >
          {isEdit ? 'Save' : duplicate ? 'Duplicate' : 'Create'}
        </Button>
        <Button variant="link" onClick={onClose} isDisabled={isSaving}>
          Cancel
        </Button>
      </ModalFooter>
    </Modal>
  );
};

export default ResourceFormModal;
