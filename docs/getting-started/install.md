---
id: getting-started/install
title: Install null3D
status: experimental
since: "0.1"
summary: "The npm packages; the Vite plugin, which every Vite build needs; package versions always match; the optional `null3d` command."
---

# Install null3D

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The packages are not on npm until the 0.1 release, so the install commands below fail before then.

null3D installs from npm like any other library, and you import it in your code as you would import `three`. You need no command-line tool to build or run a null3D sketch.

The commands on these pages use [Bun](https://bun.sh). npm, pnpm and Yarn work too, with their own install and run commands.

## Install the packages

```sh
bun add @null3d/engine
bun add -d vite @null3d/vite-plugin
```

| Package | What it holds |
| --- | --- |
| `@null3d/engine` | The API as JavaScript with TypeScript declarations, the worker entry points, both WebAssembly builds and these docs |
| `@null3d/vite-plugin` | The build and dev server setup that null3D needs, and the shader compiler |
| `@null3d/controls` | Orbit and map camera controls, for sketches that use them |

Add the controls when a sketch uses them:

```sh
bun add @null3d/controls
```

## Add the Vite plugin

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import null3d from '@null3d/vite-plugin';

export default defineConfig({ plugins: [null3d()] });
```

Every Vite build of a null3D project needs the plugin, for the dev server and for production. The plugin does these jobs, which a three.js project does not need:

- Sends the two headers that let worker threads share memory, on the dev server and on `vite preview`. [Hosting and cross-origin isolation](hosting.md) explains them.
- Compiles your sketch file for the sketch worker, and ships the engine's WebAssembly core with the production build. The build stops with an error if the installed engine lacks its core. Each built page that loads the engine gets a small script of its own, which starts the core's download as soon as the page arrives.
- Compiles the WGSL in your code, in `.wgsl` files and in strings tagged `/* wgsl */`, for WebGPU and WebGL2. A shader error stops Vite with its file, line and column. Beside each `.wgsl` file, the plugin writes a TypeScript declaration that holds the types of the file's uniforms. [Custom shaders](../guides/custom-shaders.md) explains both forms.
- Keeps the engine's development checks in the dev server and removes them from production builds.
- Builds the engine's workers as ES modules, so that they share the shader files. Without the plugin, Vite builds each worker as one classic script that holds every shader file. Each worker is then about 34 MB, and the page downloads them all at its start. The plugin warns if another setting builds workers in another format.
- Writes the notices of the third-party code that the engine ships beside the page in each production build. [Hosting](hosting.md#publish-the-third-party-notices) says what to do with them.

null3D requires Vite with this plugin. Other bundlers are not supported or tested.

## Run the sketch

Write `page.ts` and `sketch.ts` as [Your first scene](first-scene.md) shows, then start Vite:

```sh
bunx vite
```

Open the address that Vite prints. `bunx vite build` writes the production files. Serve them from a host that sends the two headers.

## Keep versions in step

All `@null3d/*` packages share one version number, because the WebAssembly core and the TypeScript API must match. Install the same version of each. The docs in `node_modules/@null3d/engine/docs/` always match the installed engine.

## The `null3d` command

The `null3d` command, in the `@null3d/cli` package, is optional. It does jobs that a bundler does not do: image tests and screenshots in a headless browser, and benchmarks of a production build. Install it when you need one of them, and run it as `bunx @null3d/cli` followed by the command:

```sh
bun add -d @null3d/cli
bunx @null3d/cli test
```

The `test` command type checks your project with the project's own TypeScript, so add it with `bun add -d typescript`. For the types of `.wgsl` imports, add `@null3d/vite-plugin/client` to the `types` in your `tsconfig.json`, as [Custom shaders](../guides/custom-shaders.md) shows.

[The `null3d` command](../cli/null3d.md) lists every command.

## Related pages

- [Your first scene](first-scene.md): the page and the sketch worker.
- [Hosting and cross-origin isolation](hosting.md): the headers on your production host.
- [Project structure](project-structure.md): starter templates and what runs where.
