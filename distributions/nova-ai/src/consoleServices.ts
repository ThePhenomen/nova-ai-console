export type ConsoleNavService = {
  id: 'workbench' | 'experiments' | 'pipelines' | 'deployments';
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
    id: 'pipelines',
    title: 'Pipelines',
    href: '/pipelines',
    description: 'Pipelines in this project will appear here.',
  },
  {
    id: 'deployments',
    title: 'Deployments',
    href: '/deployments',
    description: 'KServe InferenceServices in your projects.',
  },
];

export const CONSOLE_NAV_SERVICE_TITLES = CONSOLE_NAV_SERVICES.map((item) => item.title);

/** Same title as the Pipelines nav item. Used by the project tab. */
export const PIPELINES_SERVICE = 'Pipelines';

export const CONSOLE_TAB_SERVICES: Array<{ id: string; title: string }> = CONSOLE_NAV_SERVICES.map(
  ({ id, title }) => ({ id, title }),
);
