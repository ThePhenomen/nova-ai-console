import type { Extension } from '@nova-ai/plugin-core';
import type {
  HrefNavItemExtension,
  MastheadToolbarItemExtension,
  RouteExtension,
} from '@nova-ai/plugin-core/extension-points';

const extensions: Extension[] = [
  {
    type: 'app.navigation/href',
    properties: {
      id: 'projects',
      title: 'Projects',
      href: '/projects',
      path: '/projects/*',
    },
  } satisfies HrefNavItemExtension,
  {
    type: 'app.route',
    properties: {
      path: '/projects/*',
      component: () => import('./pages/projects/ProjectsApp'),
    },
  } satisfies RouteExtension,
  {
    type: 'app.route',
    properties: {
      path: '/',
      component: () => import('./pages/RedirectToProjects'),
    },
  } satisfies RouteExtension,
  {
    type: 'app.masthead/toolbar-item',
    properties: {
      id: 'cluster-connection',
      position: 'trailing',
      component: () => import('./cluster/ClusterToolbarItem'),
    },
  } satisfies MastheadToolbarItemExtension,
];

export default extensions;
