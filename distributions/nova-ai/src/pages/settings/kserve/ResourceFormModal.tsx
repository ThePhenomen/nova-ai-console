import React from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Flex,
  FlexItem,
  Form,
  FormGroup,
  FormHelperText,
  FormSelect,
  FormSelectOption,
  HelperText,
  HelperTextItem,
  Content,
  ExpandableSection,
  Modal,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Radio,
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
  DEFAULT_CONTAINER_NAME,
  emptyContainer,
  emptyResource,
  ensureSpec,
  prepareForSave,
  readContainer,
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
  writeUriFormats,
  writeVolumes,
  writeWorkerParallel,
  type ContainerDraft,
  type EnvDraft,
  type HttpHeaderDraft,
  type LabelDraft,
  type ModelFormatDraft,
  type ProbeDraft,
  type ResourceRowDraft,
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
  const [specLabelRows, setSpecLabelRows] = React.useState<LabelDraft[]>(() =>
    readLabels(asRecord(resource?.spec)?.labels),
  );
  const [specAnnotationRows, setSpecAnnotationRows] = React.useState<LabelDraft[]>(() =>
    readLabels(asRecord(resource?.spec)?.annotations),
  );

  const isStorage = kind.kind === 'ClusterStorageContainer';
  const isRuntime = !isStorage;
  const spec = asRecord(draft.spec) ?? {};
  const storageContainer = readContainer(spec.container, 'storage-initializer');
  const runtimeContainers = readContainersOrBlank(spec.containers, DEFAULT_CONTAINER_NAME);
  const workerContainers = readContainersOrBlank(
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

  const syncKeyValueRows = (parsed: KServeSettingsResource) => {
    setLabelRows(readLabels(parsed.metadata.labels));
    setSpecLabelRows(readLabels(asRecord(parsed.spec)?.labels));
    setSpecAnnotationRows(readLabels(asRecord(parsed.spec)?.annotations));
  };

  const writeSpecMap = (field: 'labels' | 'annotations', rows: LabelDraft[]) => {
    patchDraft((next) => {
      const nextSpec = ensureSpec(next);
      const written = writeLabels(rows);
      if (written) {
        nextSpec[field] = written;
      } else {
        delete nextSpec[field];
      }
    });
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
      syncKeyValueRows(parsed);
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
      syncKeyValueRows(parsed);
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
      const containers = readContainersOrBlank(asRecord(draft.spec)?.containers, DEFAULT_CONTAINER_NAME);
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
      if (!isStorage) {
        const payloadSpec = ensureSpec(payload);
        const nextSpecLabels = writeLabels(specLabelRows);
        if (nextSpecLabels) {
          payloadSpec.labels = nextSpecLabels;
        } else {
          delete payloadSpec.labels;
        }
        const nextSpecAnnotations = writeLabels(specAnnotationRows);
        if (nextSpecAnnotations) {
          payloadSpec.annotations = nextSpecAnnotations;
        } else {
          delete payloadSpec.annotations;
        }
      }
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
      <FormHelperText>
        <HelperText>
          <HelperTextItem>
            Optional. Empty values are omitted. Add a custom name for GPUs or other resources, for example
            nvidia.com/gpu.
          </HelperTextItem>
        </HelperText>
      </FormHelperText>
      <Flex spaceItems={{ default: 'spaceItemsSm' }} style={{ marginTop: '0.5rem', fontWeight: 600 }}>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
          Resource
        </FlexItem>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
          Request
        </FlexItem>
        <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
          Limit
        </FlexItem>
        <FlexItem style={{ width: '2rem' }} />
      </Flex>
      {container.resources.map((row, index) => (
        <Flex
          key={`${idPrefix}-resource-${index}`}
          spaceItems={{ default: 'spaceItemsSm' }}
          style={{ marginTop: '0.35rem' }}
        >
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '10rem' }}>
            <TextInput
              id={`${idPrefix}-resource-name-${index}`}
              value={row.name}
              onChange={(_event, value) => {
                const resources: ResourceRowDraft[] = container.resources.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, name: value } : item,
                );
                onChange({ ...container, resources });
              }}
              placeholder="cpu"
              aria-label={`Resource name ${index + 1}`}
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
            <TextInput
              id={`${idPrefix}-resource-request-${index}`}
              value={row.request}
              onChange={(_event, value) => {
                const resources: ResourceRowDraft[] = container.resources.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, request: value } : item,
                );
                onChange({ ...container, resources });
              }}
              placeholder="Request"
              aria-label={`Resource request ${index + 1}`}
            />
          </FlexItem>
          <FlexItem grow={{ default: 'grow' }} style={{ minWidth: '8rem' }}>
            <TextInput
              id={`${idPrefix}-resource-limit-${index}`}
              value={row.limit}
              onChange={(_event, value) => {
                const resources: ResourceRowDraft[] = container.resources.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, limit: value } : item,
                );
                onChange({ ...container, resources });
              }}
              placeholder="Limit"
              aria-label={`Resource limit ${index + 1}`}
            />
          </FlexItem>
          <FlexItem>
            <Button
              variant="plain"
              icon={<MinusCircleIcon />}
              onClick={() =>
                onChange({
                  ...container,
                  resources: container.resources.filter((_item, itemIndex) => itemIndex !== index),
                })
              }
              aria-label={`Remove resource ${index + 1}`}
            />
          </FlexItem>
        </Flex>
      ))}
      <Button
        variant="link"
        icon={<PlusCircleIcon />}
        onClick={() =>
          onChange({ ...container, resources: [...container.resources, { name: '', request: '', limit: '' }] })
        }
        style={addLinkStyle}
      >
        Add resource
      </Button>
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
  ) => {
    const patch = (partial: Partial<ProbeDraft>) => onChange({ ...probe, enabled: true, ...partial });
    return (
      <ExpandableSection
        toggleText={title}
        isExpanded={probe.enabled}
        onToggle={(_event, expanded) => onChange({ ...probe, enabled: expanded })}
        style={{ marginTop: '0.75rem' }}
      >
        <FormGroup label="Failure threshold" fieldId={`${idPrefix}-failure`}>
          <TextInput
            id={`${idPrefix}-failure`}
            value={probe.failureThreshold}
            onChange={(_event, value) => patch({ failureThreshold: value })}
            placeholder="2"
          />
        </FormGroup>
        <FormGroup label="Period seconds" fieldId={`${idPrefix}-period`}>
          <TextInput
            id={`${idPrefix}-period`}
            value={probe.periodSeconds}
            onChange={(_event, value) => patch({ periodSeconds: value })}
            placeholder="5"
          />
        </FormGroup>
        <FormGroup label="Success threshold" fieldId={`${idPrefix}-success`}>
          <TextInput
            id={`${idPrefix}-success`}
            value={probe.successThreshold}
            onChange={(_event, value) => patch({ successThreshold: value })}
            placeholder="1"
          />
        </FormGroup>
        <FormGroup label="Timeout seconds" fieldId={`${idPrefix}-timeout`}>
          <TextInput
            id={`${idPrefix}-timeout`}
            value={probe.timeoutSeconds}
            onChange={(_event, value) => patch({ timeoutSeconds: value })}
            placeholder="15"
          />
        </FormGroup>
        <FormGroup label="Initial delay seconds" fieldId={`${idPrefix}-initial`}>
          <TextInput
            id={`${idPrefix}-initial`}
            value={probe.initialDelaySeconds}
            onChange={(_event, value) => patch({ initialDelaySeconds: value })}
            placeholder="60"
          />
        </FormGroup>
        <FormGroup label="Termination grace period seconds" fieldId={`${idPrefix}-grace`}>
          <TextInput
            id={`${idPrefix}-grace`}
            value={probe.terminationGracePeriodSeconds}
            onChange={(_event, value) => patch({ terminationGracePeriodSeconds: value })}
          />
        </FormGroup>
        {renderStringList(
          'Exec command',
          `${idPrefix}-exec`,
          probe.execCommand,
          (execCommand) => patch({ execCommand }),
          'bash',
          true,
        )}
        <FormGroup label="HTTP GET path" fieldId={`${idPrefix}-http-path`}>
          <TextInput
            id={`${idPrefix}-http-path`}
            value={probe.httpGetPath}
            onChange={(_event, value) => patch({ httpGetPath: value })}
            placeholder="/health"
          />
        </FormGroup>
        <FormGroup label="HTTP GET port" fieldId={`${idPrefix}-http-port`}>
          <TextInput
            id={`${idPrefix}-http-port`}
            value={probe.httpGetPort}
            onChange={(_event, value) => patch({ httpGetPort: value })}
            placeholder="8080"
          />
        </FormGroup>
        <FormGroup label="HTTP GET host" fieldId={`${idPrefix}-http-host`}>
          <TextInput
            id={`${idPrefix}-http-host`}
            value={probe.httpGetHost}
            onChange={(_event, value) => patch({ httpGetHost: value })}
          />
        </FormGroup>
        <FormGroup label="HTTP GET scheme" fieldId={`${idPrefix}-http-scheme`}>
          <TextInput
            id={`${idPrefix}-http-scheme`}
            value={probe.httpGetScheme}
            onChange={(_event, value) => patch({ httpGetScheme: value })}
            placeholder="HTTP"
          />
        </FormGroup>
        <FormGroup label="HTTP GET headers" fieldId={`${idPrefix}-http-headers`}>
          {probe.httpGetHeaders.map((row, index) => (
            <Flex
              key={`${idPrefix}-header-${index}`}
              spaceItems={{ default: 'spaceItemsSm' }}
              style={{ marginTop: index === 0 ? 0 : '0.35rem' }}
            >
              <FlexItem grow={{ default: 'grow' }}>
                <TextInput
                  value={row.name}
                  onChange={(_event, value) => {
                    const httpGetHeaders: HttpHeaderDraft[] = probe.httpGetHeaders.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, name: value } : item,
                    );
                    patch({ httpGetHeaders });
                  }}
                  placeholder="Name"
                  aria-label={`${title} header name ${index + 1}`}
                />
              </FlexItem>
              <FlexItem grow={{ default: 'grow' }}>
                <TextInput
                  value={row.value}
                  onChange={(_event, value) => {
                    const httpGetHeaders: HttpHeaderDraft[] = probe.httpGetHeaders.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, value } : item,
                    );
                    patch({ httpGetHeaders });
                  }}
                  placeholder="Value"
                  aria-label={`${title} header value ${index + 1}`}
                />
              </FlexItem>
              <FlexItem>
                <Button
                  variant="plain"
                  icon={<MinusCircleIcon />}
                  onClick={() =>
                    patch({
                      httpGetHeaders: probe.httpGetHeaders.filter((_item, itemIndex) => itemIndex !== index),
                    })
                  }
                  aria-label={`Remove ${title} header ${index + 1}`}
                />
              </FlexItem>
            </Flex>
          ))}
          <Button
            variant="link"
            icon={<PlusCircleIcon />}
            onClick={() => patch({ httpGetHeaders: [...probe.httpGetHeaders, { name: '', value: '' }] })}
            style={addLinkStyle}
          >
            Add header
          </Button>
        </FormGroup>
        <FormGroup label="TCP socket host" fieldId={`${idPrefix}-tcp-host`}>
          <TextInput
            id={`${idPrefix}-tcp-host`}
            value={probe.tcpHost}
            onChange={(_event, value) => patch({ tcpHost: value })}
          />
        </FormGroup>
        <FormGroup label="TCP socket port" fieldId={`${idPrefix}-tcp-port`}>
          <TextInput
            id={`${idPrefix}-tcp-port`}
            value={probe.tcpPort}
            onChange={(_event, value) => patch({ tcpPort: value })}
          />
        </FormGroup>
        <FormGroup label="gRPC port" fieldId={`${idPrefix}-grpc-port`}>
          <TextInput
            id={`${idPrefix}-grpc-port`}
            value={probe.grpcPort}
            onChange={(_event, value) => patch({ grpcPort: value })}
          />
        </FormGroup>
        <FormGroup label="gRPC service" fieldId={`${idPrefix}-grpc-service`}>
          <TextInput
            id={`${idPrefix}-grpc-service`}
            value={probe.grpcService}
            onChange={(_event, value) => patch({ grpcService: value })}
          />
        </FormGroup>
      </ExpandableSection>
    );
  };

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
      <Flex justifyContent={{ default: 'justifyContentSpaceBetween' }} alignItems={{ default: 'alignItemsCenter' }}>
        <FlexItem>
          <Content component="h3" style={{ margin: 0, fontSize: '1rem' }}>
            {title}
          </Content>
        </FlexItem>
        {onRemove ? (
          <FlexItem>
            <Button variant="plain" icon={<MinusCircleIcon />} onClick={onRemove} aria-label={`Remove ${title}`} />
          </FlexItem>
        ) : null}
      </Flex>
      <FormGroup label="Name" isRequired fieldId={`${idPrefix}-name`}>
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
      {renderStringList(
        'Command',
        `${idPrefix}-command`,
        container.command,
        (command) => onChange({ ...container, command }),
        'bash',
        true,
      )}
      {renderEnv(container, onChange, idPrefix)}
      {renderResources(container, onChange, idPrefix)}
      {renderSecurity(container, onChange, idPrefix)}
      {renderVolumeMounts(container, onChange, idPrefix)}
      {renderProbe(
        'Liveness probe',
        container.livenessProbe,
        (livenessProbe) => onChange({ ...container, livenessProbe }),
        `${idPrefix}-live`,
      )}
      {renderProbe(
        'Readiness probe',
        container.readinessProbe,
        (readinessProbe) => onChange({ ...container, readinessProbe }),
        `${idPrefix}-ready`,
      )}
      {renderProbe(
        'Startup probe',
        container.startupProbe,
        (startupProbe) => onChange({ ...container, startupProbe }),
        `${idPrefix}-start`,
      )}
    </div>
  );

  const renderKeyValue = (
    title: string,
    fieldId: string,
    rows: LabelDraft[],
    setRows: React.Dispatch<React.SetStateAction<LabelDraft[]>>,
    addText: string,
    onCommit?: (nextRows: LabelDraft[]) => void,
  ) => {
    const update = (nextRows: LabelDraft[]) => {
      setRows(nextRows);
      onCommit?.(nextRows);
    };
    return (
      <FormGroup label={title} fieldId={fieldId}>
        {rows.map((row, index) => (
          <Flex
            key={`${fieldId}-${index}`}
            spaceItems={{ default: 'spaceItemsSm' }}
            style={{ marginTop: index === 0 ? 0 : '0.35rem' }}
          >
            <FlexItem grow={{ default: 'grow' }}>
              <TextInput
                value={row.key}
                onChange={(_event, value) =>
                  update(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, key: value } : item)))
                }
                placeholder="Key"
                aria-label={`${title} key ${index + 1}`}
              />
            </FlexItem>
            <FlexItem grow={{ default: 'grow' }}>
              <TextInput
                value={row.value}
                onChange={(_event, value) =>
                  update(rows.map((item, itemIndex) => (itemIndex === index ? { ...item, value } : item)))
                }
                placeholder="Value"
                aria-label={`${title} value ${index + 1}`}
              />
            </FlexItem>
            <FlexItem>
              <Button
                variant="plain"
                icon={<MinusCircleIcon />}
                onClick={() => update(rows.filter((_item, itemIndex) => itemIndex !== index))}
                aria-label={`Remove ${title} ${index + 1}`}
              />
            </FlexItem>
          </Flex>
        ))}
        <Button
          variant="link"
          icon={<PlusCircleIcon />}
          onClick={() => update([...rows, { key: '', value: '' }])}
          style={addLinkStyle}
        >
          {addText}
        </Button>
      </FormGroup>
    );
  };

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
              {renderKeyValue('Labels', 'settings-labels', labelRows, setLabelRows, 'Add label', (rows) =>
                patchDraft((next) => {
                  next.metadata.labels = writeLabels(rows);
                }),
              )}
              {isRuntime
                ? renderKeyValue(
                    'Spec labels',
                    'settings-spec-labels',
                    specLabelRows,
                    setSpecLabelRows,
                    'Add spec label',
                    (rows) => writeSpecMap('labels', rows),
                  )
                : null}
              {isRuntime
                ? renderKeyValue(
                    'Spec annotations',
                    'settings-spec-annotations',
                    specAnnotationRows,
                    setSpecAnnotationRows,
                    'Add spec annotation',
                    (rows) => writeSpecMap('annotations', rows),
                  )
                : null}
              {isStorage ? (
                <>
                  {renderContainerBasics(
                    storageContainer.name.trim() || 'Storage initializer',
                    storageContainer,
                    writeStorageContainer,
                    'storage',
                  )}
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
                  <Content component="h3" style={{ marginTop: '1rem', marginBottom: 0 }}>
                    Containers
                  </Content>
                  {runtimeContainers.map((container, index) => (
                    <React.Fragment key={`runtime-container-${index}`}>
                      {renderContainerBasics(
                        container.name.trim() || 'Container',
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
                    onClick={() => writeRuntimeContainers([...runtimeContainers, emptyContainer(DEFAULT_CONTAINER_NAME)])}
                    style={addLinkStyle}
                  >
                    Add container
                  </Button>
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
                  <Content component="h3" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
                    Worker spec
                  </Content>
                  <FormGroup label="Pipeline parallel size" fieldId="settings-pipeline-parallel">
                    <TextInput
                      id="settings-pipeline-parallel"
                      type="text"
                      inputMode="numeric"
                      value={workerParallel(draft, 'pipelineParallelSize')}
                      onChange={(_event, value) =>
                        patchDraft((next) => writeWorkerParallel(next, 'pipelineParallelSize', value))
                      }
                      placeholder="1"
                    />
                  </FormGroup>
                  <FormGroup label="Tensor parallel size" fieldId="settings-tensor-parallel">
                    <TextInput
                      id="settings-tensor-parallel"
                      type="text"
                      inputMode="numeric"
                      value={workerParallel(draft, 'tensorParallelSize')}
                      onChange={(_event, value) =>
                        patchDraft((next) => writeWorkerParallel(next, 'tensorParallelSize', value))
                      }
                      placeholder="1"
                    />
                  </FormGroup>
                  {workerContainers.map((container, index) => (
                    <React.Fragment key={`worker-${index}`}>
                      {renderContainerBasics(
                        container.name.trim() || 'Container',
                        container,
                        (nextContainer) =>
                          writeWorkerContainers(
                            workerContainers.map((item, itemIndex) =>
                              itemIndex === index ? nextContainer : item,
                            ),
                          ),
                        `worker-${index}`,
                        workerContainers.length > 1
                          ? () =>
                              writeWorkerContainers(
                                workerContainers.filter((_item, itemIndex) => itemIndex !== index),
                              )
                          : undefined,
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
                    Add container
                  </Button>
                  {renderVolumes('Volumes', 'settings-worker-volumes', workerVolumes, (nextVolumes) =>
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
              ) : null}
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
