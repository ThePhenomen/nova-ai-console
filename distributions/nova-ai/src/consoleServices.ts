export type ConsoleNavService = {
  id: 'workbench' | 'experiments' | 'deployments';
  title: string;
  href: string;
  description: string;
};

/** Sidebar items. Visibility follows OIDC groups, not PlatformRole labels. */
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
    description: 'KServe InferenceServices in your projects.',
  },
];

export const CONSOLE_NAV_SERVICE_TITLES = CONSOLE_NAV_SERVICES.map((item) => item.title);

/** Project tab. Shown when the user is in a nova-ai-airflow.<namespace>.<level> group. */
export const PIPELINES_SERVICE = 'Pipelines';

export const CONSOLE_TAB_SERVICES: Array<{ id: string; title: string }> = [
  ...CONSOLE_NAV_SERVICES.map(({ id, title }) => ({ id, title })),
  { id: 'pipelines', title: PIPELINES_SERVICE },
];
