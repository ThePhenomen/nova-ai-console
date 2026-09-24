import { cloneResource } from '../../deployments/manifest';
import {
  PRE_INSTALLED_LABEL,
  PROTOCOL_VERSIONS,
  type KServeSettingsKind,
  type KServeSettingsResource,
  type SettingsKindCatalog,
} from './catalog';

export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export type EnvDraft = {
  name: string;
  value: string;
  fieldPath: string;
};

export type LabelDraft = {
  key: string;
  value: string;
};

export type UriFormatDraft = {
  mode: 'prefix' | 'regex';
  value: string;
};

export type ModelFormatDraft = {
  name: string;
  version: string;
  autoSelect: boolean;
  priority: string;
};

export type VolumeMountDraft = {
  name: string;
  mountPath: string;
};

export type VolumeDraft = {
  name: string;
  medium: string;
  sizeLimit: string;
};

export type ProbeDraft = {
  enabled: boolean;
  failureThreshold: string;
  periodSeconds: string;
  successThreshold: string;
  timeoutSeconds: string;
  initialDelaySeconds: string;
  execCommand: string;
};

export type SecurityDraft = {
  allowPrivilegeEscalation: boolean;
  privileged: boolean;
  runAsNonRoot: boolean;
  dropCapabilities: string[];
};

export type ContainerDraft = {
  name: string;
  image: string;
  args: string[];
  command: string[];
  env: EnvDraft[];
  cpuRequest: string;
  memoryRequest: string;
  cpuLimit: string;
  memoryLimit: string;
  volumeMounts: VolumeMountDraft[];
  security: SecurityDraft;
  livenessProbe: ProbeDraft;
  readinessProbe: ProbeDraft;
  startupProbe: ProbeDraft;
};

const defaultSecurity = (): SecurityDraft => ({
  allowPrivilegeEscalation: false,
  privileged: false,
  runAsNonRoot: true,
  dropCapabilities: ['ALL'],
});

export const emptyProbe = (): ProbeDraft => ({
  enabled: false,
  failureThreshold: '',
  periodSeconds: '',
  successThreshold: '',
  timeoutSeconds: '',
  initialDelaySeconds: '',
  execCommand: '',
});

export const emptyContainer = (name = 'kserve-container'): ContainerDraft => ({
  name,
  image: '',
  args: [],
  command: [],
  env: [],
  cpuRequest: '',
  memoryRequest: '',
  cpuLimit: '',
  memoryLimit: '',
  volumeMounts: [],
  security: defaultSecurity(),
  livenessProbe: emptyProbe(),
  readinessProbe: emptyProbe(),
  startupProbe: emptyProbe(),
});

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map((item) => String(item)).filter((item) => item.trim() !== '') : [];

const resourceString = (resources: Record<string, unknown> | undefined, bucket: string, name: string): string => {
  const group = asRecord(resources?.[bucket]);
  const value = group?.[name];
  return value === undefined || value === null ? '' : String(value);
};

const writeResourceBag = (
  cpuRequest: string,
  memoryRequest: string,
  cpuLimit: string,
  memoryLimit: string,
): Record<string, unknown> | undefined => {
  const requests: Record<string, string> = {};
  const limits: Record<string, string> = {};
  if (cpuRequest.trim()) {
    requests.cpu = cpuRequest.trim();
  }
  if (memoryRequest.trim()) {
    requests.memory = memoryRequest.trim();
  }
  if (cpuLimit.trim()) {
    limits.cpu = cpuLimit.trim();
  }
  if (memoryLimit.trim()) {
    limits.memory = memoryLimit.trim();
  }
  const resources: Record<string, unknown> = {};
  if (Object.keys(requests).length > 0) {
    resources.requests = requests;
  }
  if (Object.keys(limits).length > 0) {
    resources.limits = limits;
  }
  return Object.keys(resources).length > 0 ? resources : undefined;
};

const readEnv = (value: unknown): EnvDraft[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const env = asRecord(item);
    const fieldPath = String(asRecord(asRecord(env?.valueFrom)?.fieldRef)?.fieldPath ?? '');
    return {
      name: String(env?.name ?? ''),
      value: String(env?.value ?? ''),
      fieldPath,
    };
  });
};

const writeEnv = (rows: EnvDraft[], strict = false): unknown[] | undefined => {
  const items = rows
    .map((row) => {
      const name = row.name.trim();
      if (strict && !name) {
        return null;
      }
      if (row.fieldPath.trim()) {
        return {
          name,
          valueFrom: { fieldRef: { fieldPath: row.fieldPath.trim() } },
        };
      }
      return { name, value: row.value };
    })
    .filter((item) => item !== null);
  return items.length > 0 ? items : undefined;
};

const readSecurity = (value: unknown): SecurityDraft => {
  const security = asRecord(value);
  if (!security) {
    return defaultSecurity();
  }
  return {
    allowPrivilegeEscalation: security.allowPrivilegeEscalation === true,
    privileged: security.privileged === true,
    runAsNonRoot: security.runAsNonRoot !== false,
    dropCapabilities: stringList(asRecord(security.capabilities)?.drop),
  };
};

const writeSecurity = (draft: SecurityDraft): Record<string, unknown> => {
  const security: Record<string, unknown> = {
    allowPrivilegeEscalation: draft.allowPrivilegeEscalation,
    privileged: draft.privileged,
    runAsNonRoot: draft.runAsNonRoot,
  };
  if (draft.dropCapabilities.length > 0) {
    security.capabilities = { drop: draft.dropCapabilities };
  }
  return security;
};

const readProbe = (value: unknown): ProbeDraft => {
  const probe = asRecord(value);
  if (!probe) {
    return emptyProbe();
  }
  const command = stringList(asRecord(probe.exec)?.command);
  return {
    enabled: true,
    failureThreshold: probe.failureThreshold === undefined ? '' : String(probe.failureThreshold),
    periodSeconds: probe.periodSeconds === undefined ? '' : String(probe.periodSeconds),
    successThreshold: probe.successThreshold === undefined ? '' : String(probe.successThreshold),
    timeoutSeconds: probe.timeoutSeconds === undefined ? '' : String(probe.timeoutSeconds),
    initialDelaySeconds: probe.initialDelaySeconds === undefined ? '' : String(probe.initialDelaySeconds),
    execCommand: command.join('\n'),
  };
};

const writeNumber = (raw: string): number | undefined => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isNaN(parsed) ? undefined : parsed;
};

const writeProbe = (draft: ProbeDraft): Record<string, unknown> | undefined => {
  if (!draft.enabled && !draft.execCommand.trim()) {
    return undefined;
  }
  const probe: Record<string, unknown> = {};
  const failureThreshold = writeNumber(draft.failureThreshold);
  const periodSeconds = writeNumber(draft.periodSeconds);
  const successThreshold = writeNumber(draft.successThreshold);
  const timeoutSeconds = writeNumber(draft.timeoutSeconds);
  const initialDelaySeconds = writeNumber(draft.initialDelaySeconds);
  if (failureThreshold !== undefined) {
    probe.failureThreshold = failureThreshold;
  }
  if (periodSeconds !== undefined) {
    probe.periodSeconds = periodSeconds;
  }
  if (successThreshold !== undefined) {
    probe.successThreshold = successThreshold;
  }
  if (timeoutSeconds !== undefined) {
    probe.timeoutSeconds = timeoutSeconds;
  }
  if (initialDelaySeconds !== undefined) {
    probe.initialDelaySeconds = initialDelaySeconds;
  }
  const command = draft.execCommand
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line !== '' || (index > 0 && index < lines.length - 1));
  if (command.length > 0) {
    probe.exec = { command };
  }
  return Object.keys(probe).length > 0 ? probe : undefined;
};

const readVolumeMounts = (value: unknown): VolumeMountDraft[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const mount = asRecord(item);
    return {
      name: String(mount?.name ?? ''),
      mountPath: String(mount?.mountPath ?? ''),
    };
  });
};

const writeVolumeMounts = (rows: VolumeMountDraft[], strict = false): unknown[] | undefined => {
  const items = rows
    .filter((row) => !strict || (row.name.trim() && row.mountPath.trim()))
    .map((row) => ({ name: row.name, mountPath: row.mountPath }));
  return items.length > 0 ? items : undefined;
};

export const readVolumes = (value: unknown): VolumeDraft[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const volume = asRecord(item);
    const emptyDir = asRecord(volume?.emptyDir);
    return {
      name: String(volume?.name ?? ''),
      medium: String(emptyDir?.medium ?? ''),
      sizeLimit: emptyDir?.sizeLimit === undefined ? '' : String(emptyDir.sizeLimit),
    };
  });
};

export const writeVolumes = (rows: VolumeDraft[], strict = false): unknown[] | undefined => {
  const items = rows
    .filter((row) => !strict || row.name.trim())
    .map((row) => {
      const emptyDir: Record<string, unknown> = {};
      if (row.medium.trim()) {
        emptyDir.medium = row.medium.trim();
      }
      if (row.sizeLimit.trim()) {
        emptyDir.sizeLimit = row.sizeLimit.trim();
      }
      const volume: Record<string, unknown> = { name: row.name.trim() || row.name };
      if (Object.keys(emptyDir).length > 0) {
        volume.emptyDir = emptyDir;
      }
      return volume;
    });
  return items.length > 0 ? items : undefined;
};

export const readContainer = (value: unknown, fallbackName: string): ContainerDraft => {
  const container = asRecord(value);
  if (!container) {
    return emptyContainer(fallbackName);
  }
  const resources = asRecord(container.resources);
  return {
    name: String(container.name ?? fallbackName),
    image: String(container.image ?? ''),
    args: Array.isArray(container.args) ? container.args.map((item) => String(item)) : [],
    command: Array.isArray(container.command) ? container.command.map((item) => String(item)) : [],
    env: readEnv(container.env),
    cpuRequest: resourceString(resources, 'requests', 'cpu'),
    memoryRequest: resourceString(resources, 'requests', 'memory'),
    cpuLimit: resourceString(resources, 'limits', 'cpu'),
    memoryLimit: resourceString(resources, 'limits', 'memory'),
    volumeMounts: readVolumeMounts(container.volumeMounts),
    security: readSecurity(container.securityContext),
    livenessProbe: readProbe(container.livenessProbe),
    readinessProbe: readProbe(container.readinessProbe),
    startupProbe: readProbe(container.startupProbe),
  };
};

export const writeContainer = (draft: ContainerDraft, strict = false): Record<string, unknown> | null => {
  if (strict && !draft.name.trim() && !draft.image.trim()) {
    return null;
  }
  const container: Record<string, unknown> = {
    name: draft.name.trim() || (strict ? 'kserve-container' : draft.name) || 'kserve-container',
  };
  if (draft.image.trim() || !strict) {
    if (draft.image.trim()) {
      container.image = draft.image.trim();
    }
  }
  const args = draft.args.map((item) => item.trimEnd()).filter((item) => (strict ? item !== '' : true));
  if (args.length > 0) {
    container.args = args;
  }
  const command = draft.command.map((item) => item.trimEnd()).filter((item) => (strict ? item !== '' : true));
  if (command.length > 0) {
    container.command = command;
  }
  const env = writeEnv(draft.env, strict);
  if (env) {
    container.env = env;
  }
  const resources = writeResourceBag(
    draft.cpuRequest,
    draft.memoryRequest,
    draft.cpuLimit,
    draft.memoryLimit,
  );
  if (resources) {
    container.resources = resources;
  }
  const mounts = writeVolumeMounts(draft.volumeMounts, strict);
  if (mounts) {
    container.volumeMounts = mounts;
  }
  container.securityContext = writeSecurity(draft.security);
  const livenessProbe = writeProbe(draft.livenessProbe);
  if (livenessProbe) {
    container.livenessProbe = livenessProbe;
  }
  const readinessProbe = writeProbe(draft.readinessProbe);
  if (readinessProbe) {
    container.readinessProbe = readinessProbe;
  }
  const startupProbe = writeProbe(draft.startupProbe);
  if (startupProbe) {
    container.startupProbe = startupProbe;
  }
  return container;
};

export const readContainers = (value: unknown, fallbackName: string): ContainerDraft[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [];
  }
  return value.map((item) => readContainer(item, fallbackName));
};

export const readContainersOrBlank = (value: unknown, fallbackName: string): ContainerDraft[] => {
  const rows = readContainers(value, fallbackName);
  return rows.length > 0 ? rows : [emptyContainer(fallbackName)];
};

export const writeContainers = (rows: ContainerDraft[], strict = false): unknown[] | undefined => {
  const items = rows
    .map((row) => writeContainer(row, strict))
    .filter((item): item is Record<string, unknown> => item !== null);
  return items.length > 0 ? items : undefined;
};

export const readLabels = (labels?: Record<string, string>): LabelDraft[] =>
  Object.entries(labels ?? {}).map(([key, value]) => ({ key, value }));

export const writeLabels = (rows: LabelDraft[]): Record<string, string> | undefined => {
  const labels: Record<string, string> = {};
  rows.forEach((row) => {
    const key = row.key.trim();
    if (key) {
      labels[key] = row.value;
    }
  });
  return Object.keys(labels).length > 0 ? labels : undefined;
};

export const readUriFormats = (value: unknown): UriFormatDraft[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ mode: 'prefix', value: '' }];
  }
  return value.map((item) => {
    const format = asRecord(item);
    if (format?.regex) {
      return { mode: 'regex', value: String(format.regex) };
    }
    return { mode: 'prefix', value: String(format?.prefix ?? '') };
  });
};

export const writeUriFormats = (rows: UriFormatDraft[], strict = false): unknown[] =>
  rows
    .filter((row) => !strict || row.value.trim())
    .map((row) => (row.mode === 'regex' ? { regex: row.value } : { prefix: row.value }));

export const readModelFormats = (value: unknown): ModelFormatDraft[] => {
  if (!Array.isArray(value) || value.length === 0) {
    return [{ name: '', version: '', autoSelect: true, priority: '1' }];
  }
  return value.map((item) => {
    const format = asRecord(item);
    return {
      name: String(format?.name ?? ''),
      version: format?.version === undefined ? '' : String(format.version),
      autoSelect: format?.autoSelect !== false,
      priority: format?.priority === undefined ? '' : String(format.priority),
    };
  });
};

export const writeModelFormats = (rows: ModelFormatDraft[], strict = false): unknown[] | undefined => {
  const items = rows
    .filter((row) => !strict || row.name.trim())
    .map((row) => {
      const format: Record<string, unknown> = { name: row.name };
      if (row.version.trim()) {
        format.version = row.version.trim();
      }
      format.autoSelect = row.autoSelect;
      const priority = Number(row.priority);
      if (row.priority.trim() && !Number.isNaN(priority) && priority >= 1) {
        format.priority = Math.trunc(priority);
      }
      return format;
    });
  return items.length > 0 ? items : undefined;
};

export const readProtocolVersions = (value: unknown): string[] =>
  Array.isArray(value) && value.length > 0 ? value.map((item) => String(item)) : ['v1', 'v2'];

export const ensureSpec = (resource: KServeSettingsResource): Record<string, unknown> => {
  if (!asRecord(resource.spec)) {
    resource.spec = {};
  }
  return resource.spec as Record<string, unknown>;
};

const defaultStorageFormats = (): UriFormatDraft[] => [
  { mode: 'prefix', value: 's3://' },
  { mode: 'prefix', value: 'gs://' },
  { mode: 'prefix', value: 'hdfs://' },
  { mode: 'prefix', value: 'webhdfs://' },
  { mode: 'regex', value: 'https://(.+?).blob.core.windows.net/(.+)' },
  { mode: 'regex', value: 'https://(.+?).file.core.windows.net/(.+)' },
  { mode: 'regex', value: 'https?://(.+)/(.+)' },
  { mode: 'regex', value: 'hf://' },
];

export const emptyResource = (kind: SettingsKindCatalog, namespace?: string): KServeSettingsResource => {
  const metadata = kind.scope === 'Namespaced' ? { name: '', namespace: namespace ?? '' } : { name: '' };
  if (kind.kind === 'ClusterStorageContainer') {
    return {
      apiVersion: kind.apiVersion,
      kind: kind.kind,
      metadata,
      spec: {
        container: writeContainer({
          ...emptyContainer('storage-initializer'),
          cpuRequest: '100m',
          memoryRequest: '100Mi',
          cpuLimit: '2',
          memoryLimit: '4Gi',
        }),
        supportedUriFormats: writeUriFormats(defaultStorageFormats()),
        workloadType: 'initContainer',
      },
    };
  }
  return {
    apiVersion: kind.apiVersion,
    kind: kind.kind,
    metadata,
    spec: {
      annotations: {
        'prometheus.kserve.io/port': '8080',
        'prometheus.kserve.io/path': '/metrics',
      },
      supportedModelFormats: [{ name: '', version: '', autoSelect: true, priority: 1 }],
      protocolVersions: [...PROTOCOL_VERSIONS].slice(0, 2),
      containers: [
        writeContainer({
          ...emptyContainer('kserve-container'),
          args: ['--model_name={{.Name}}', '--model_dir=/mnt/models', '--http_port=8080'],
          cpuRequest: '1',
          memoryRequest: '2Gi',
          cpuLimit: '1',
          memoryLimit: '2Gi',
        }),
      ],
    },
  };
};

export const prometheusAnnotation = (resource: KServeSettingsResource, key: 'port' | 'path'): string => {
  const annotations = asRecord(asRecord(resource.spec)?.annotations);
  const full = key === 'port' ? 'prometheus.kserve.io/port' : 'prometheus.kserve.io/path';
  return String(annotations?.[full] ?? '');
};

export const writePrometheusAnnotation = (
  resource: KServeSettingsResource,
  key: 'port' | 'path',
  value: string,
): void => {
  const spec = ensureSpec(resource);
  const annotations = { ...(asRecord(spec.annotations) ?? {}) };
  const full = key === 'port' ? 'prometheus.kserve.io/port' : 'prometheus.kserve.io/path';
  if (value.trim()) {
    annotations[full] = value.trim();
  } else {
    delete annotations[full];
  }
  if (Object.keys(annotations).length === 0) {
    delete spec.annotations;
    return;
  }
  spec.annotations = annotations;
};

export const workerParallel = (resource: KServeSettingsResource, key: 'pipelineParallelSize' | 'tensorParallelSize'): string => {
  const value = asRecord(asRecord(resource.spec)?.workerSpec)?.[key];
  return value === undefined || value === null ? '' : String(value);
};

export const writeWorkerParallel = (
  resource: KServeSettingsResource,
  key: 'pipelineParallelSize' | 'tensorParallelSize',
  raw: string,
): void => {
  const spec = ensureSpec(resource);
  const workerSpec = { ...(asRecord(spec.workerSpec) ?? {}) };
  const trimmed = raw.trim();
  if (!trimmed) {
    delete workerSpec[key];
  } else {
    const parsed = Number(trimmed);
    workerSpec[key] = Number.isNaN(parsed) ? trimmed : Math.max(1, Math.trunc(parsed));
  }
  if (Object.keys(workerSpec).length === 0) {
    delete spec.workerSpec;
    return;
  }
  spec.workerSpec = workerSpec;
};

export const modelFormatSummary = (resource: KServeSettingsResource): string => {
  const formats = asRecord(resource.spec)?.supportedModelFormats;
  if (!Array.isArray(formats) || formats.length === 0) {
    return '—';
  }
  return formats
    .map((item) => {
      const format = asRecord(item);
      const name = String(format?.name ?? '');
      const version = format?.version === undefined ? '' : String(format.version);
      return version ? `${name}:${version}` : name;
    })
    .filter(Boolean)
    .join(', ') || '—';
};

export const containerSummary = (resource: KServeSettingsResource): string => {
  const spec = asRecord(resource.spec);
  if (resource.kind === 'ClusterStorageContainer') {
    return String(asRecord(spec?.container)?.name ?? '—');
  }
  const containers = spec?.containers;
  if (!Array.isArray(containers) || containers.length === 0) {
    return '—';
  }
  return containers
    .map((item) => String(asRecord(item)?.name ?? ''))
    .filter(Boolean)
    .join(', ') || '—';
};

export const uriFormatSummary = (resource: KServeSettingsResource): string => {
  const formats = asRecord(resource.spec)?.supportedUriFormats;
  if (!Array.isArray(formats) || formats.length === 0) {
    return '—';
  }
  return formats
    .map((item) => {
      const format = asRecord(item);
      return String(format?.prefix ?? format?.regex ?? '');
    })
    .filter(Boolean)
    .join(', ') || '—';
};

export const isRuntimeDisabled = (resource: KServeSettingsResource): boolean => {
  if (resource.kind === 'ClusterStorageContainer') {
    return resource.disabled === true;
  }
  return asRecord(resource.spec)?.disabled === true;
};

export const canEditSettingsKind = (kind: KServeSettingsKind, consoleRole: string): boolean => {
  if (kind === 'ServingRuntime') {
    return consoleRole === 'admin' || consoleRole === 'contributor';
  }
  return consoleRole === 'admin';
};

export const isPreInstalled = (resource: KServeSettingsResource): boolean =>
  resource.metadata.labels?.[PRE_INSTALLED_LABEL] === 'true';

export const runtimeDisplayName = (resource: KServeSettingsResource): string =>
  resource.metadata.annotations?.['nova-ai.io/display-name'] ??
  resource.metadata.annotations?.['opendatahub.io/template-display-name'] ??
  resource.metadata.annotations?.['openshift.io/display-name'] ??
  resource.metadata.name;

export const runtimeVersionTag = (resource: KServeSettingsResource): string | undefined => {
  const labels = resource.metadata.labels ?? {};
  const versions = Object.entries(labels)
    .filter((entry): entry is [string, string] => {
      const [key, value] = entry;
      return key.endsWith('.version') && typeof value === 'string' && value.trim() !== '';
    })
    .toSorted(([left], [right]) => left.localeCompare(right));
  const value = versions[0]?.[1]?.trim();
  if (!value) {
    return undefined;
  }
  return value.startsWith('v') ? value : `v${value}`;
};

export const servingPlatformLabel = (resource: KServeSettingsResource): string =>
  asRecord(resource.spec)?.multiModel === true ? 'Multi-model' : 'Single-model';

export const apiProtocolLabels = (resource: KServeSettingsResource): string[] => {
  const versions = readProtocolVersions(asRecord(resource.spec)?.protocolVersions);
  const protocols = new Set<string>();
  versions.forEach((version) => {
    if (version.startsWith('grpc')) {
      protocols.add('gRPC');
      return;
    }
    protocols.add('REST');
  });
  return [...protocols];
};

export const duplicateResource = (resource: KServeSettingsResource): KServeSettingsResource => {
  const next = cloneResource(resource);
  delete next.status;
  const metadata: Record<string, unknown> = { ...next.metadata };
  delete metadata.uid;
  delete metadata.resourceVersion;
  delete metadata.creationTimestamp;
  delete metadata.generation;
  delete metadata.managedFields;
  delete metadata.deletionTimestamp;
  const labels = { ...((metadata.labels as Record<string, string> | undefined) ?? {}) };
  delete labels[PRE_INSTALLED_LABEL];
  metadata.labels = Object.keys(labels).length > 0 ? labels : undefined;
  const base = String(metadata.name ?? 'runtime').replace(/-copy(-\d+)?$/, '');
  const copyName = `${base}-copy`.slice(0, 63).replace(/-$/, '');
  metadata.name = copyName || 'runtime-copy';
  next.metadata = metadata as KServeSettingsResource['metadata'];
  return next;
};

export const prepareForSave = (
  resource: KServeSettingsResource,
  kind: SettingsKindCatalog,
): KServeSettingsResource => {
  const next = cloneResource(resource);
  next.apiVersion = kind.apiVersion;
  next.kind = kind.kind;
  if (kind.scope === 'Cluster') {
    delete next.metadata.namespace;
  }
  const spec = ensureSpec(next);
  if (kind.kind === 'ClusterStorageContainer') {
    spec.supportedUriFormats = writeUriFormats(readUriFormats(spec.supportedUriFormats), true);
    const container = writeContainer(readContainer(spec.container, 'storage-initializer'), true);
    if (container) {
      spec.container = container;
    }
  } else {
    const formats = writeModelFormats(readModelFormats(spec.supportedModelFormats), true);
    if (formats) {
      spec.supportedModelFormats = formats;
    }
    const containers = writeContainers(readContainers(spec.containers, 'kserve-container'), true);
    if (containers) {
      spec.containers = containers;
    }
    const volumes = writeVolumes(readVolumes(spec.volumes), true);
    if (volumes) {
      spec.volumes = volumes;
    } else {
      delete spec.volumes;
    }
    const workerSpec = asRecord(spec.workerSpec);
    if (workerSpec) {
      const workerContainers = writeContainers(
        readContainers(workerSpec.containers, 'worker-container'),
        true,
      );
      if (workerContainers) {
        workerSpec.containers = workerContainers;
      } else {
        delete workerSpec.containers;
      }
      const workerVolumes = writeVolumes(readVolumes(workerSpec.volumes), true);
      if (workerVolumes) {
        workerSpec.volumes = workerVolumes;
      } else {
        delete workerSpec.volumes;
      }
      if (Object.keys(workerSpec).length === 0) {
        delete spec.workerSpec;
      } else {
        spec.workerSpec = workerSpec;
      }
    }
  }
  return next;
};
