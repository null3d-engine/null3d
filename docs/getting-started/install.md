---
id: getting-started/install
title: Install null3d
status: planned
since: "0.1"
summary: "The npm packages; the Vite plugin; package versions always match; the optional `null3d` command."
---

# Install null3d

> Planned for null3d 0.1. No release has these packages yet, so coding agents must not use them.

null3d installs from npm like any other library, and you import it in your code as you would import `three`. You need no command-line tool to build or run a null3d game.

## Install the packages

```sh
npm install @null3d/engine
npm install --save-dev vite @null3d/vite-plugin
```

| Package | What it holds |
| --- | --- |
| `@null3d/engine` | The TypeScript API, the worker entry points, both WebAssembly builds and these docs |
| `@null3d/vite-plugin` | The build and dev server setup that null3d needs |
| `@null3d/controls` | Orbit and map camera controls, for games that use them |

## Add the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import null3d from '@null3d/vite-plugin';

export default defineConfig({ plugins: [null3d()] });
```

The plugin does four jobs that a three.js project does not need:

- Sends the two headers that let worker threads share memory, on the dev server and on `vite preview`. [Hosting and cross-origin isolation](hosting.md) explains them.
- Builds your game file as a module worker.
- Translates your WGSL shaders for WebGL2.
- Keeps the engine's development checks in the dev server and removes them from production builds.

null3d has a plugin for Vite only.

## Run the game

Write `page.ts` and `game.ts` as [Your first scene](first-scene.md) shows, then start Vite:

```sh
npx vite
```

Open the address that Vite prints. `npx vite build` writes the production files. Serve them from a host that sends the two headers.

## Keep versions in step

All `@null3d/*` packages share one version number, because the WebAssembly core and the TypeScript API must match. Install the same version of each. The docs in `node_modules/@null3d/engine/docs/` always match the installed engine.

## The null3d command

The `null3d` command, in the `@null3d/cli` package, is optional. It does jobs that a bundler does not do, such as headless tests, screenshots, benchmarks and model optimization. Install it when you need one of them:

```sh
npm install --save-dev @null3d/cli
npx null3d test
```

To run it once without installing it, use `npx null3d`. The `null3d` package runs the latest `@null3d/cli`, so this works outside a project too.

[The null3d command](../cli/null3d.md) lists every command.

## Related pages

- [Your first scene](first-scene.md): the page and the game worker.
- [Hosting and cross-origin isolation](hosting.md): the headers on your production host.
- [Project structure](project-structure.md): starter templates and what runs where.
