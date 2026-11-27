# D-404: A build can ship the shaders of one GPU path

Status: decided and built. The Vite plugin's `shaders.gpuPaths` option ships one GPU path's shaders, and the engine refuses a path that the build lacks with E1308. Task: none.

Summary: A production build that names `gpuPaths: ['webgpu']` copies the WebGPU shader files alone. It copies 1,836 files and 329 MB, against 7,597 files and 4,115 MB for both paths. A device that would need WebGL2 stops with E1308, which names the option.

## Question

The engine compiles every shader for WebGPU and for WebGL2, and a production build copies both halves. A page downloads only its own path's files, so the other half costs nothing at run time. The host or the desktop app stores it, though, and it is most of the shader set.

A deployment that controls its browser frame never draws that half. An Electron app's Chromium is one. How does its build ship only the path it draws with, without a device failing as a missing download?

## Rule

- The build copies no file of a GPU path that the option leaves out. The engine never asks for one on the path it draws with.
- A page on a device that would need the dropped path fails at the start. The error names the option and the fix, never a missing download or an empty shader.
- The dev server draws both paths. It warns when a page draws the path that a build drops.
- The option combines with the project's shader list, and the list's check keeps its rule.
- The shipped path draws the same pixels as before. The option changes what a build holds, not what a page draws.

## Data

| The examples' production build | Files | Bytes |
| --- | --- | --- |
| Both GPU paths, the default | 8,689 | 4,117,616,099 |
| WebGPU alone | 1,967 | 329,560,295 |

| The set of this checkout | Files | Bytes |
| --- | --- | --- |
| Whole set | 8,148 | 4,118,447,940 |
| The WebGL2 half | 6,246 | 3,787,391,228 |
| The shared modules, which a build bundles | 5 | 1,780,994 |

How the data was produced: `NULL3D_SHADER_PERMUTATIONS= bun run examples:build` built the examples against this checkout's full set. It ran once without `gpuPaths` and once with `['webgpu']`. The counts read `target/examples/assets`, and each counts the files whose name starts with `shaders-` or `shader-paragraphs-`.

The one-path build's WebGL2 half is eight stub modules of 60 bytes each. Each stands in for a module that a page would load by name.

`bun run shaders` built the set from this checkout's sources. The set rows count `packages/engine/src/generated` by the target token in each file's name. The WebGL2 half is 92 per cent of the set's bytes.

## Look

The options draw the same pixels. A build with the option keeps every WebGPU file byte for byte. A WebGPU page asks for nothing that a build of both paths gives it.

The dropped path is never drawn, so no picture changes and no image reference moves.

## Decision

The plugin takes `shaders: { gpuPaths }`, whose values are `'webgpu'` and `'webgl2'`. The value must include `'webgpu'`, so the only one-path build is `['webgpu']`; leaving the option out ships both.

The shader compiler builds every shader for WebGPU. A WebGL2-only project would need a `CompiledShader` whose WebGPU form is null, which changes a public type.

A build with the option does these things:

- The streamed copies read each generated file's name for its target. A file of the dropped path gives way to one module without builds, which the build copies for every such file. Its loader in the set's tables names that module. The set keeps its tables, which compress to about 150 KB together.
- A generated module of the dropped path that a module imports by name resolves to a stub module. Its examples are a table of builds that need several features, and a whole shader that loads on first use. The stub exports the names of the module it stands for, so every import resolves and a lookup finds no build. One stub serves every table that exports the same names.
- The project's own whole shaders compile for the shipped path alone. A custom material's, effect's and sky layer's WebGL2 builds and pieces are dropped before the module packs them. Their sets of builds are not made.
- An add-on package's compiled shaders lose their WebGL2 records, their GLSL table and their loader entries of the GLSL sets. Their set modules are then never imported or emitted.
- The engine's marker module names the shipped paths. `chooseTier` treats a path that the build lacks as unavailable. That covers a crashed start and a `?gpu=` switch.
- The dev server keeps both paths. The page tells it the path that each engine started on, through the client that also sends a shader list's words. The server warns once for each page that draws the dropped path.

A list recorded on both paths holds words that only WebGL2 builds. A morphed mesh's word is one, and a combined build of several features adds more. The list's build check would fail for them.

So a build with a list still reads each dropped file for its words. It also reads the device files that a dropped table of combined builds names. It copies none of them.

Options rejected:

- Build the release asset per GPU path in the shader build. A release serves every project, so it would ship two assets. A project that takes one would still need the other's files for its own shaders.
- Give the Rust shader build a target filter, and build the set locally. A project outside the repository has no checkout or Rust toolchain.
- Rewrite the shared `shaders.ts` to remove its own-pass GLSL builds. The WebGL2 renderer's code still imports their names at build time. The text also compresses to about 150 KB together.
- Narrow only the file copies and leave the set's loader URLs. Vite then copies every file that a URL names, so the build would hold both paths.
- Point a dropped URL at a `data:` address. The generated loader imports the URL with `@vite-ignore`, and a policy can refuse a `data:` module. The build copies one small stand-in module instead.
- Offer a deployment preset, such as `deployment: 'electron'`. It hides which settings it changes. Other settings, such as a thread build, have reasons of their own.
- Ship WebGL2 alone. It needs a public type change. WebGPU is also the path that the engine's newer work targets.
- Narrow the dev server's set. A developer could then not test the other path with `?gpu=`. The warning and the testing advice both use that switch.

## Consequences

- The Vite plugin narrows a build in these files:
  - `shader-list.ts`, which holds the option and its check, the target of a generated name, and the marker module's text.
  - `index.ts`, which narrows the copies and stubs the dropped modules.
  - `wgsl.ts`, which compiles whole shaders for the shipped path.
  - `material-builds.ts`, which drops the other path's builds and pieces.
  - `pack.ts`, which narrows a packed add-on module.
- `packages/engine/src/page/engine.ts` filters the tier choice by the shipped paths and throws E1308. `shared/tier.ts` names the path of a tier. `shared/permutation-words.ts` carries the event that the dev server reads.
- `crates/null3d-shaders/src/typescript.rs` writes `SHIPPED_GPU_PATHS` into the marker module, null for both paths.
- `docs/guides/assets-pipeline.md` adds "Ship a subset of the GPU paths". The hosting, deploying and backends pages link to it. The plugin's README and the install page name the option. `docs/errors/E1308.md` is generated from the error table. The develop skill's recipes and startup checks name the option.
- A build that ships one path still holds the WebGL2 renderer's JavaScript and the shared module's own-pass GLSL text. It also holds both paths of an add-on that a page loads from a CDN at run time.
