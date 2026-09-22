# @nova-ai/eslint-config

Shared ESLint rules and configurations for all Nova AI Console packages.

## Purpose

Centralises linting rules so every package in the monorepo enforces the same
code-quality standards. Provides base, React, TypeScript, markdown and node configs.

## Usage

In your package `.eslintrc.js`:

```js
module.exports = require('@nova-ai/eslint-config').recommendedReactTypescript(__dirname);
```

## Configs

| File | Scope |
|------|-------|
| `base.js` | TypeScript + React rules (primary) |
| `markdown.js` | Rules for `.md` code fences |
| `node.js` | Node.js / CommonJS scripts |

