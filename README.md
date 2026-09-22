# Nova AI Console

A standalone web console built on React 18, PatternFly 6 and a small plugin/extension
system. It has no OpenShift or Kubernetes dependencies — the shell renders whatever
navigation, routes and tabs are contributed as extensions.

## Repository structure

```text
nova-ai-console/
├── distributions/
│   ├── base/          # app shell framework (masthead, nav, routing, theming)
│   └── nova-ai/       # the Nova AI Console — declares extensions, builds the bundle
└── packages/
    ├── plugin-core/   # extension types, plugin store, React hooks
    ├── eslint-config/ # shared ESLint config
    ├── jest-config/   # shared Jest config
    └── tsconfig/      # shared TypeScript config
```

## Requirements

- Node.js >= 22
- npm >= 10

## Getting started

```bash
npm install
npm run start:dev
```

The dev server listens on `0.0.0.0:4020`, so it is reachable from other machines on
the network. Override with environment variables:

```bash
HOST=127.0.0.1 PORT=8080 npm run start:dev
```

## Other commands

```bash
npm run build         # production bundle into distributions/nova-ai/public
npm run lint          # ESLint across all workspaces
npm run type-check    # TypeScript across all workspaces
npm run test-unit     # Jest unit tests
```

## Adding a tab

Tabs and navigation come from `distributions/nova-ai/src/extensions.ts`. A tabbed page
is an `app.tab-route/page` extension plus one or more `app.tab-route/tab` extensions
that reference it by `pageId`:

```ts
{
  type: 'app.tab-route/page',
  properties: { id: 'projects', title: 'Projects', href: '/projects', path: '/projects/*' },
},
{
  type: 'app.tab-route/tab',
  properties: { pageId: 'projects', id: 'overview', title: 'Overview', component: () => import('./pages/ProjectsTab') },
},
```

Tab components are loaded lazily, so `component` must be a plain
`() => import('...')` code reference.
