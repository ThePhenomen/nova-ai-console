export type ConsoleNavService = {
  id: 'workbench' | 'experiments' | 'deployments';
  title: string;
  href: string;
  description: string;
};

/** Sidebar + project tabs gated by nova-ai.io/<id>-enabled: "true". */
export const CONSOLE_NAV_SERVICES: ConsoleNavService[] = [
  {
    id: 'workbench',
    title: 'Workbench',
    href: '/workbench',
    description: 'Workbenches will appear here.',
  },
  {
    id: 'experiments',
    title: 'Experiments',
    href: '/experiments',
    description: 'MLflow experiments will appear here.',
  },
  {
    id: 'deployments',
    title: 'Deployments',
    href: '/deployments',
    description: 'Model deployments will appear here.',
  },
];

export const CONSOLE_NAV_SERVICE_TITLES = CONSOLE_NAV_SERVICES.map((item) => item.title);

/** Project-only tab, same enabled-label gating, no sidebar item. */
export const PIPELINES_SERVICE = 'Pipelines';

export const CONSOLE_TAB_SERVICES: Array<{ id: string; title: string }> = [
  ...CONSOLE_NAV_SERVICES.map(({ id, title }) => ({ id, title })),
  { id: 'pipelines', title: PIPELINES_SERVICE },
];

export const consoleServiceEnabledLabel = (serviceId: string): string =>
  `nova-ai.io/${serviceId.trim().toLowerCase().replace(/\s+/g, '-')}-enabled`;
