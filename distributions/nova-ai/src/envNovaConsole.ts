const readEnv = (key: string): string | undefined => {
  const value = process.env[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

export const getNovaConsoleUrl = (): string | null => {
  const value = readEnv('NOVA_CONSOLE_URL');
  return value ? value.replace(/\/$/, '') : null;
};

export const getCreateMlClusterUrl = (projectName: string): string | null => {
  const base = getNovaConsoleUrl();
  if (!base) {
    return null;
  }
  return `${base}/k8s/ns/${encodeURIComponent(projectName)}/apps.nova-platform.io~v1alpha1~MLCluster/~new`;
};
