# @nova-ai/plugin-core

Core plugin infrastructure and extension-point definitions for the Nova AI Console.

## Purpose

Defines the contracts a distribution uses to contribute navigation, routes, tabs and
masthead content to the app shell, plus the plugin store and React hooks the shell uses
to consume them.

## Entry points

| Import                             | Contents                                             |
| ---------------------------------- | ---------------------------------------------------- |
| `@nova-ai/plugin-core`             | `PluginStore`, `PluginStoreProvider`, `useExtensions`, `useResolvedExtensions`, `LazyCodeRefComponent`, core types |
| `@nova-ai/plugin-core/extension-points` | Extension types and type guards (`navigation`, `routes`, `tab-route`, `masthead`) |
| `@nova-ai/plugin-core/testing`     | `expectExtensionsToBeValid` for unit tests            |

## Usage

```ts
import { useExtensions } from '@nova-ai/plugin-core';
import { isTabRoutePageExtension } from '@nova-ai/plugin-core/extension-points';
```

Extension `component` properties must be plain `() => import('...')` code references so
they can be resolved lazily.
