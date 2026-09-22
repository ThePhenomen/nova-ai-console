import type { Extension } from '@nova-ai/plugin-core';
import type {
  RouteExtension,
  TabRoutePageExtension,
  TabRouteTabExtension,
} from '@nova-ai/plugin-core/extension-points';

const extensions: Extension[] = [
  {
    type: 'app.tab-route/page',
    properties: {
      id: 'projects',
      title: 'Projects',
      href: '/projects',
      path: '/projects/*',
      alwaysShowTabBar: true,
    },
  } satisfies TabRoutePageExtension,
  {
    type: 'app.tab-route/tab',
    properties: {
      pageId: 'projects',
      id: 'overview',
      title: 'Overview',
      component: () => import('./pages/ProjectsTab'),
    },
  } satisfies TabRouteTabExtension,
  {
    type: 'app.route',
    properties: {
      path: '/',
      component: () => import('./pages/RedirectToProjects'),
    },
  } satisfies RouteExtension,
];

export default extensions;
