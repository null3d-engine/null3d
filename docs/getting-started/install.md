---
id: getting-started/install
title: Install null3d
status: planned
since: "0.1"
summary: "The npm packages; the Vite plugin; package versions always match; the optional `null3d` command."
---

# Install null3d

> Planned for null3d 0.1. No release has these packages yet, so coding agents must not use them.

null3d installs from npm like any other library, and you import it in your code as you would import `three`. You need no command-line tool to build or run a null3d sketch.

The commands on these pages use [Bun](https://bun.sh). npm, pnpm and Yarn work too, with their own install and run commands.

## Install the packages

```sh
bun add @null3d/engine
bun add -d vite @null3d/vite-plugin
```

| Package | What it holds |
| --- | --- |
| `@null3d/engine` | The TypeScript API, the worker entry points, both WebAssembly builds and these docs |
| `@null3d/vite-plugin` | The build and dev server setup that null3d needs |
| `@null3d/controls` | Orbit and map camera controls, for sketches that use them |

## Add the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import null3d from '@null3d/vite-plugin';

export default defineConfig({ plugins: [null3d()] });
```

The plugin does four jobs that a three.js project does not need:

- Sends the two headers that let worker threads share memory, on the dev server and on `vite preview`. [Hosting and cross-origin isolation](hosting.md) explains them.
- Compiles your sketch file for the sketch worker, and ships the engine's WebAssembly core with the production build. The build stops with an error if the installed engine lacks its core.
- Translates your WGSL shaders for WebGL2.
- Keeps the engine's development checks in the dev server and removes them from production builds.

null3d has a plugin for Vite only.

## Run the sketch

Write `page.ts` and `sketch.ts` as [Your first scene](first-scene.md) shows, then start Vite:

```sh
bunx vite
```

Open the address that Vite prints. `bunx vite build` writes the production files. Serve them from a host that sends the two headers.

## Keep versions in step

All `@null3d/*` packages share one version number, because the WebAssembly core and the TypeScript API must match. Install the same version of each. The docs in `node_modules/@null3d/engine/docs/` always match the installed engine.

## The null3d command

The `null3d` command, in the `@null3d/cli` package, is optional. It does jobs that a bundler does not do, such as headless tests, screenshots, benchmarks and model optimization. Install it when you need one of them, and run it as `bunx @null3d/cli` followed by the command:

```sh
bun add -d @null3d/cli
bunx @null3d/cli test
```

[The null3d command](../cli/null3d.md) lists every command.

## Related pages

- [Your first scene](first-scene.md): the page and the sketch worker.
- [Hosting and cross-origin isolation](hosting.md): the headers on your production host.
- [Project structure](project-structure.md): starter templates and what runs where.
