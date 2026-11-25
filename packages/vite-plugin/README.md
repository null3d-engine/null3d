# Vite plugin for null3D

`@null3d/vite-plugin` sets up Vite for a [null3D](https://github.com/null3d-engine/null3d) project.
It sends the headers that worker threads need, compiles your WGSL for WebGPU and WebGL2, and
builds production files that ship the engine core. Every Vite build of a null3D project needs it.

## Install

```sh
bun add @null3d/engine
bun add -d vite @null3d/vite-plugin
```

The plugin needs Vite 8 or newer.

## Use

```ts
// vite.config.ts
import null3d from '@null3d/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [null3d()],
});
```

Run `bunx vite` for the dev server and `bunx vite build` for the production files. For the types
of `.wgsl` and `?optimized` imports, add `@null3d/vite-plugin/client` to the `types` in your
`tsconfig.json`.

## What it does

- It sends the two cross-origin isolation headers on every response from `vite` and
  `vite preview`, the `.wasm` files and worker scripts included. Worker threads need them to share
  memory.
- It compiles the WGSL in `.wgsl` files and in template literals tagged `/* wgsl */`, for WebGPU
  and WebGL2. A shader error stops Vite with its file, line and column. On the dev server, a
  shader that you change reaches the running page without a reload.
- Each compiled shader stays in `node_modules/.cache/null3d-shaders`, so a later build compiles
  only what changed.
- An import such as `import shipUrl from './ship.glb?optimized'` runs the asset tool of
  `@null3d/cli` on the glTF model. The import gives the optimized model's address for
  `assets.loadGltf`. Add the tool with `bun add -d @null3d/cli`.
- A production build compiles the sketch file for its worker, ships the engine's WebAssembly
  core and drops the engine's development checks. Each built page that loads the engine gets a
  small script that starts the core's download at once. The build also writes the third-party
  notices and a list of its files (`null3d-files.json`) for offline play.

## Options

```ts
null3d({ https: true, certDir: 'certs', assets: { lod: true, maxTextureSize: 1024 } });
```

- `https` serves HTTPS on your local network, from both `vite` and `vite preview`. A phone or
  tablet needs it for shared memory and WebGPU. The plugin reads `cert.pem` and `key.pem` from
  `certDir`, which is `target/dev-cert` in the project unless you set it.
- `http2` serves the `https` server over HTTP/2, which sends all of the page's requests at once on
  one connection. A dev page asks for hundreds of modules. It is off by default, because Safari on
  an iPad sometimes stops while a worker loads its modules over HTTP/2.
- `wgslDeclarations` writes a TypeScript declaration beside each `.wgsl` file, with the types of
  its uniforms. It is on by default. Set it to false in a project without TypeScript.
- `assets` takes the asset tool's options for `?optimized` models, such as `lod`, `simplify` and
  `maxTextureSize`.
- `urlSwitches` lets the page's address set the engine's test switches, such as `?gpu=`, in a
  production build too. It is off by default, so a link cannot change how a shipped game runs.

## Costs and limits

- The first build compiles every shader in the project, and one compile can take most of a
  second. The plugin prints the file that it compiles, so the pause does not look like a hang.
- null3D supports and tests Vite with this plugin, and no other bundler.

## Docs

- [Install null3D](https://github.com/null3d-engine/null3d/blob/generated/docs/getting-started/install.md):
  each job of the plugin, and the shader cache.
- [Hosting](https://github.com/null3d-engine/null3d/blob/generated/docs/getting-started/hosting.md):
  the headers, and a certificate for HTTPS on a phone.
- [Custom shaders](https://github.com/null3d-engine/null3d/blob/generated/docs/guides/custom-shaders.md)
  and [the asset pipeline](https://github.com/null3d-engine/null3d/blob/generated/docs/guides/assets-pipeline.md).

## License

Licensed under either of the Apache License 2.0 or the MIT license, at your option.
