/** Label value that marks objects as belonging to Nova AI Console. */
export const CONSOLE_LABEL_VALUE = 'nova-ai-console';

/** Canonical key used when the console creates namespaces and PlatformRoles. */
export const CONSOLE_LABEL_KEY = 'nova-ai.io/console';

export const consoleScopeLabels = (): Record<string, string> => ({
  [CONSOLE_LABEL_KEY]: CONSOLE_LABEL_VALUE,
});

export const hasConsoleScope = (labels?: Record<string, string>): boolean =>
  Boolean(labels && Object.values(labels).includes(CONSOLE_LABEL_VALUE));
