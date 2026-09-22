# AGENTS.md — Nova AI Console

Guidance for AI agents working on this repository.

## Overview

Nova AI Console is a standalone React console with no OpenShift or Kubernetes
dependencies. The app shell lives in `distributions/base`; the console itself lives in
`distributions/nova-ai` and contributes its navigation, routes and tabs as extensions.

```text
distributions/base     # shell: masthead, sidebar nav, routing, theming
distributions/nova-ai  # console: extensions.ts + page components
packages/plugin-core   # extension types, plugin store, React hooks
packages/eslint-config # shared ESLint config
packages/jest-config   # shared Jest config
packages/tsconfig      # shared TypeScript config
```

## Requirements

- Node.js >= 22, npm >= 10

## Commands

```bash
npm install
npm run start:dev     # dev server on 0.0.0.0:4020
npm run build
npm run lint
npm run type-check
npm run test-unit
```

## Conventions

- React 18 with function components and hooks; PatternFly 6 is the only UI library.
- Extension `component` properties must be plain `() => import('...')` code references —
  the plugin store validates this shape, and anything else breaks lazy loading.
- Packages are referenced by their workspace name (`@nova-ai/*`), not by relative paths
  across package boundaries. Within `distributions/nova-ai`, importing the shell via
  `../../base/src/lib` is expected.
- Do not add OpenShift or Kubernetes client dependencies.
