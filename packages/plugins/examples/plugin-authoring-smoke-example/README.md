# Plugin Authoring Smoke Example

A Slaw plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

## Install Into Slaw

```bash
pnpm slaw plugin install ./
```

## Build Options

- `pnpm build` uses esbuild presets from `@slaw/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
