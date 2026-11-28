---
id: getting-started/install
title: Install null3D
summary: "The npm packages; the Vite plugin, which every Vite build needs; package versions always match; the optional `null3d` command."
---

# Install null3D

null3D installs from npm and imports like any other library. It builds with Vite and the null3D Vite plugin. You do not need the optional `null3d` command to build or run a sketch. To try the engine in one HTML file with no bundler, see [Try null3D from a CDN](cdn.md). That page builds the engine from its source once.

The commands on these pages use [Bun](https://bun.sh) 1.4.3 or newer. Older Bun can drop its link to the browser that `bunx @null3d/cli test` and the tool's other browser commands drive, and the command then waits forever. npm, pnpm and Yarn work too, with their own install and run commands.

## Install the packages

```sh
bun add @null3d/engine
bun add -d vite @null3d/vite-plugin
```

| Package | What it holds |
| --- | --- |
| `@null3d/engine` | The API as JavaScript with TypeScript declarations, the worker entry points, both WebAssembly builds and these docs |
| `@null3d/vite-plugin` | The build and dev server setup that null3D needs, and the shader compiler |
| `@null3d/controls` | Orbit, map, fly and first-person camera controls, and gizmos that move, turn and scale objects, for sketches that use them |

Add the controls when a sketch uses them:

```sh
bun add @null3d/controls
```

## Add the Vite plugin

null3D requires Vite with this plugin. Other bundlers are not supported or tested. The engine loads its workers, its WebAssembly and its other files in the standard form, `new URL('<file>', import.meta.url)`, which other bundlers read too.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import null3d from '@null3d/vite-plugin';

export default defineConfig({ plugins: [null3d()] });
```

Every Vite build of a null3D project needs the plugin, for the dev server and for production. The plugin does these jobs:

- Sends the two headers that let worker threads share memory, on the dev server and on `vite preview`. [Hosting and cross-origin isolation](hosting.md) explains them.
- Compresses what `vite preview` sends with Brotli, `.wasm` included, and what the dev server sends to another device, such as a phone. Its `https` option serves HTTPS on your network, and its `http2` option serves that over HTTP/2 ([During development](hosting.md#during-development)).
- Compiles your sketch file for the sketch worker, and ships the engine's WebAssembly core with the production build. The build stops with an error if the installed engine lacks its core.
- Compiles the WGSL in your code, in `.wgsl` files and in strings tagged `/* wgsl */`, for WebGPU and WebGL2. A shader error stops Vite with its file, line and column. [Custom shaders](../guides/custom-shaders.md) explains both forms.
- Removes the engine's development checks from production builds. Without the plugin, nothing tells the engine's code which build it is in, so it runs as a development build, with every check on.
- Builds the engine's workers as ES modules, so that they share the shader files. The plugin warns if another setting builds workers in another format.
- Starts each worker's on-demand imports together with the file that imports them, so a worker does not wait one round trip for each file.
- Writes the notices of the third-party code that the engine and the add-ons ship beside the page in each production build. [Hosting](hosting.md#publish-the-third-party-notices) says what to do with them.
- Writes the list of the build's files, `null3d-files.json`, beside the page in each production build. A game's service worker caches the files of that list for offline play, as [Hosting](hosting.md#offline-play) shows.
- Copies the engine's compiled shader files into a production build, each as a file of its own. Its `shaders.list` option names a list of the permutation words that your pages draw with. The build then copies only their builds ([Build only the shader permutations you draw with](../guides/assets-pipeline.md#build-only-the-shader-permutations-you-draw-with)). Its `shaders.gpuPaths` option ships a subset of the GPU paths, such as WebGPU alone, for an app whose browser always offers them ([Ship a subset of the GPU paths](../guides/assets-pipeline.md#ship-a-subset-of-the-gpu-paths)).
- Keeps each of the engine's files a file of its own, so a strict Content-Security-Policy does not block them. Vite still turns your own small files into `data:` addresses, which such a policy blocks.

<details>
<summary>Technical details: how the plugin builds workers and files</summary>

Each built page that loads the engine gets a small script of its own, which starts the core's download as soon as the page arrives. Beside each `.wgsl` file, the plugin writes a TypeScript declaration that holds the types of the file's uniforms. It compiles on worker threads, so the dev server goes on serving while a shader compiles. On the dev server, a shader that you change reaches the running page without a reload.

The engine's code reads the page's address switches in a development build. This also holds for another bundler, and for a page that imports the package's files with no bundler. The [CDN build](cdn.md#production-and-development-entries) has a production entry for such pages. Without the plugin, Vite builds each worker as one classic script that holds every shader file. Each worker is then about 34 MB, and the page downloads them all at its start.

The built file of your sketch, and of each add-on's task, names every file that it reaches through other files. So the worker asks for all of them as soon as that file arrives, instead of one round trip for each step of the chain. Your own small files keep Vite's inline setting.

</details>

The build's files may come from a CDN, with the HTML page on your own origin. [The engine's files on a CDN](hosting.md#the-engines-files-on-a-cdn) gives the headers and the policy that this needs.

## Serve over HTTPS

WebGPU and the High and Ultra presets need a secure page. `localhost` and `127.0.0.1` are secure already. A phone or tablet on your network is not, so serve it over HTTPS with a local certificate.

Make a certificate for `localhost` and your computer's network name:

```sh
mkdir certs
mkcert -cert-file certs/cert.pem -key-file certs/key.pem localhost my-computer.local
```

Turn on the plugin's `https` option, and keep `certs` out of version control because it holds a private key:

```ts
// vite.config.ts
export default defineConfig({ plugins: [null3d({ https: true, certDir: 'certs' })] });
```

Install mkcert's root certificate on every device that opens the page. A browser that drives a test must also start with `--enable-unsafe-webgpu`, or it draws WebGL2. [Hosting and cross-origin isolation](hosting.md#during-development) gives the certificate steps, and [Testing your sketch](../guides/testing.md#the-browser-must-take-the-webgpu-path) gives the browser setup.

## Run the sketch

Write `page.ts` and `sketch.ts` as [Your first scene](first-scene.md) shows, then start Vite:

```sh
bunx vite
```

Open the address that Vite prints. `bunx vite build` writes the production files. Serve them from a host that sends the two headers.

## Shader compiles and the cache

The plugin compiles the WGSL in your project on each build and each start of the dev server:

- Every `.wgsl` file that a module imports.
- Every template literal that a `/* wgsl */` comment tags, in a script.
- Every custom material, post effect and tone curve, built into the engine's own templates.

A compile can take most of a second, and a project has many. So the plugin keeps each compiled shader in `node_modules/.cache/null3d-shaders`. A later build of the same shader takes the cached result and starts no compiler. A changed shader, a changed variant or a newer compiler misses and compiles again, so the cache never serves a wrong shader.

<details>
<summary>Technical details: what the cache keys on</summary>

An entry's key is a hash of the WGSL, the path it came from, the variant spec given to the compiler, and the compiler's version. That version is the engine's version plus the shader build's own stamp, so any engine or compiler upgrade misses every entry.

</details>

The first build has no cached results, so it compiles every shader in the project and pauses while it does. The plugin prints a line that names the file it is compiling and the cache folder, so the pause does not look like a hang. Later builds read the cache and compile nothing.

To ignore the cache, set `NULL3D_NO_CACHE=1`, or start the dev server with Vite's `--force`. To clear it, delete the folder:

```sh
rm -rf node_modules/.cache/null3d-shaders
```

## Keep versions in step

All `@null3d/*` packages share one version number, because the WebAssembly core and the TypeScript API must match. Install the same version of each. The docs in `node_modules/@null3d/engine/docs/` always match the installed engine.

## The `null3d` command

The `null3d` command, in the `@null3d/cli` package, is optional. It does jobs that a bundler does not do, such as image tests and screenshots in a headless browser and benchmarks of a production build. It also connects a coding agent to the live scene. Install it when you need one of them, and run it as `bunx @null3d/cli` followed by the command:

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
