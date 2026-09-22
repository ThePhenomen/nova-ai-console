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
    type: 'app.navigation/href',
    properties: {
      id: 'experiments',
      title: 'Experiments',
      href: '/experiments',
      path: '/experiments',
    },
    flags: {
      required: ['experiments'],
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
      path: '/experiments',
      component: () => import('./pages/experiments/Experiments'),
    },
    flags: {
      required: ['experiments'],
    },
  } satisfies RouteExtension,
  {
    type: 'app.route',
    properties: {
      path: '/auth/callback',
      component: () => import('./auth/AuthCallback'),
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
      id: 'oidc-session',
      position: 'trailing',
      component: () => import('./auth/AuthToolbarItem'),
    },
  } satisfies MastheadToolbarItemExtension,
];

export default extensions;
