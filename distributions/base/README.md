# Base Distribution

Minimal app shell framework — renders a PatternFly page chrome (masthead, sidebar,
routing, error boundary) with no features loaded. Distribution layers such as
`distributions/nova-ai` add functionality on top by contributing extensions.

This package is not deployed on its own. To run the console, use the Nova AI
distribution from the repo root:

```bash
npm run start:dev
```

To run the bare shell (useful when working on the chrome itself):

```bash
npm run start:dev --workspace @nova-ai/shell
```

### Environment variables

| Variable | Default   | Purpose                               |
| -------- | --------- | ------------------------------------- |
| `HOST`   | `0.0.0.0` | Interface the webpack dev server binds |
| `PORT`   | `4010`    | Port for the webpack dev server        |
