export type ConsoleNavService = {
  id: 'workbench' | 'experiments' | 'deployments';
  title: string;
  href: string;
  description: string;
};

/** Sidebar + project tabs gated by nova-ai.io/console-service. */
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

/** Project-only tab, same console-service gating, no sidebar item. */
export const PIPELINES_SERVICE = 'Pipelines';
