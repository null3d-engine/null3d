---
id: index
title: null3d documentation
status: experimental
since: "0.1"
summary: "What null3d is; how the docs are organized; status labels."
---

# null3d documentation

null3d is a browser 3D engine for games and heavy 3D apps. Its core is Rust compiled to WebAssembly, and it runs on worker threads, so the page's main thread stays free. It draws with WebGPU, and with WebGL2 where WebGPU is missing, from the same game code. You write game code in TypeScript, with names that follow three.js where the ideas match.

null3d is in early development. Most pages here describe planned features, and each page's status label says which is which.

## Status labels

Every page has a status in its front matter:

| Status | Meaning |
| --- | --- |
| `planned` | No release has the feature yet. The page describes how it will work, and an API page also lists the APIs the engine has now. |
| `experimental` | The feature works, but its API can still change between versions. |
| `stable` | The API follows semantic versioning. |
| `generated` | A tool writes the page from a single source, such as the three.js mapping data. |

Coding agents must never use an API whose page is `planned`. The null3d agent skills follow the same rule.

The API reference on each `api/` page is generated from the doc comments in the engine's source code, so it always matches the code.

The version column in the page list gives the first engine version with the page's feature. Version 0.1 is the first release.

## Where to start

- [Architecture: threads and the frame](concepts/architecture.md) explains where game code runs, and why.
- [GPU tiers and backends](concepts/backends.md) shows which browsers get WebGPU and which get WebGL2.
- [Hosting and cross-origin isolation](getting-started/hosting.md) covers the two HTTP headers that turn on worker threads.
- If you are porting a three.js app, the [three.js to null3d mapping](porting/threejs-mapping.md) lists 147 three.js APIs with their null3d equivalents.

Coding agents can look pages up by ID. A page's ID is its path under `docs/` without `.md`, such as `concepts/architecture`. From version 0.1, the same pages ship inside the `@null3d/engine` package, so they always match the installed engine.

## All pages

<!-- null3d:page-list:start -->

### Getting started

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Install null3d](getting-started/install.md) | The npm packages; the Vite plugin; package versions always match; the optional `null3d` command. | planned | 0.1 |
| [Your first scene](getting-started/first-scene.md) | page.ts with createEngine; game.ts with defineGame; camera, light, mesh; running it with Vite. | planned | 0.1 |
| [Hosting and cross-origin isolation](getting-started/hosting.md) | COOP and COEP headers; require-corp on Safari; CORS and CORP for assets; the single-threaded fallback. | planned | 0.1 |
| [Project structure](getting-started/project-structure.md) | Starting from a template with `null3d create`; page.ts, game.ts, assets/, AGENTS.md, .claude/skills/; what runs where. | planned | 0.3 |

### Concepts

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Architecture: threads and the frame](concepts/architecture.md) | Main thread, game worker, render worker, job workers; the pipelined frame; latency modes. | planned | 0.1 |
| [Handles and objects](concepts/handles.md) | 30-bit handles; wrapper objects; stale-handle errors; keeping game data in your own arrays. | planned | 0.1 |
| [Static and dynamic objects](concepts/static-dynamic.md) | When to mark objects static; setters versus direct array writes; dirty ranges. | planned | 0.1 |
| [Instances and batching](concepts/instances.md) | createInstances; typed-array views; markDirty; automatic batching; per-instance attributes. | planned | 0.1 |
| [GPU tiers and backends](concepts/backends.md) | WebGPU core, compatibility mode and WebGL2; capability flags; the portable budget; never branching on GPU names. | planned | 0.1 |
| [Quality presets, dynamic resolution and frame budgets](concepts/quality-presets.md) | Low to Ultra; pixel-ratio caps; the frame-budget governor; quality events for game code. | planned | 0.1 |
| [Color management](concepts/color-management.md) | Linear working space; sRGB hex colors; texture color spaces; parity with three.js. | planned | 0.1 |
| [Materials and pipelines](concepts/materials.md) | Built-in materials; permutations; pipeline warm-up; why changing shader features can stall a frame. | planned | 0.1 |
| [Lighting and environment](concepts/lighting.md) | Light types and units; clustered lighting; environment maps and spherical harmonics. | planned | 0.1 |
| [Shadows](concepts/shadows.md) | Cascades; update rates; filtering per preset; bias settings. | planned | 0.1 |
| [Render layers](concepts/render-layers.md) | 32-bit layer masks on objects, cameras, raycasts and passes. | planned | 0.1 |
| [The render graph](concepts/render-graph.md) | Declared reads and writes; automatic order; transient memory; validation errors; the text dump. | planned | 0.1 |
| [Large worlds and precision](concepts/large-worlds.md) | Cell-relative positions and per-frame camera-to-cell offsets; reversed depth; largeWorld mode; batch origins; floating-origin geometry. | planned | 0.2 |
| [Culling](concepts/culling.md) | Grid-cell culling; frustum and small-object tests; two-phase GPU occlusion culling on WebGPU; software occlusion culling and blocker meshes on WebGL2 (0.2). | planned | 0.1 |
| [Levels of detail](concepts/lod.md) | LOD groups; generated LODs; per-instance selection. | planned | 0.2 |
| [Assets and prefabs](concepts/assets.md) | glTF, KTX2, meshopt; prefabs and instantiate; upload budgets; memory. | planned | 0.2 |
| [The post-processing chain](concepts/post-processing.md) | HDR target; bloom; ambient occlusion; the single final pass; custom effects. | planned | 0.2 |

### API reference

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Page API: createEngine](api/engine.md) | createEngine options; engine.postToGame, capture, labels, requestPointerLock, capabilities, destroy. | planned | 0.1 |
| [Game API: defineGame and the context](api/game.md) | The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks. | planned | 0.1 |
| [Scene](api/scene.md) | Creating objects; find; background, environment, fog, sky; warmUp. | planned | 0.1 |
| [Objects and transforms](api/objects.md) | Setters and getters; parents; flags; destroy. | planned | 0.1 |
| [Cameras](api/cameras.md) | Perspective and orthographic cameras; screenToRay; worldToScreen; layers. | planned | 0.1 |
| [Lights](api/lights.md) | Directional, point, spot, hemisphere and ambient lights; shadow options. | planned | 0.1 |
| [Geometry](api/geometry.md) | Generators with three.js parameters; fromArrays; updateVertices. | planned | 0.1 |
| [Materials](api/materials.md) | standard, unlit, shader, shadowCatcher; every option. | planned | 0.1 |
| [Textures](api/textures.md) | loadTexture options; fromData; fromImageBitmap; fromPass; cube maps. | planned | 0.1 |
| [Assets](api/assets.md) | loadGltf, loadTexture, loadEnvironment, preload, onProgress, destroy. | planned | 0.2 |
| [Animation](api/animation.md) | The animator; play, crossFade, layers, events; morph weights. | planned | 0.2 |
| [Raycasting and spatial queries](api/raycast.md) | raycast, raycastAny, raycastAll, raycastBatch, overlap queries, pointer events on objects. | planned | 0.2 |
| [Input](api/input.md) | Pointer, keyboard, touch and gamepad; action maps. | planned | 0.1 |
| [Camera controls (@null3d/controls)](api/controls.md) | Orbit and map controls (0.1); fly and first-person controls (0.2). | planned | 0.1 |
| [Post-processing API](api/post.md) | post.set options; post.addEffect for custom WGSL effects. | planned | 0.2 |
| [Render graph API](api/render.md) | render.addPass declarations; enabling and disabling passes; dumpGraph. | planned | 0.2 |
| [Quality API](api/quality.md) | quality.preset, quality.set, frame budgets, quality events. | planned | 0.1 |
| [Debug drawing and stats](api/debug.md) | debug.line, box, axes, grid, frustum; debug.view; debug.stats. | planned | 0.1 |
| [Math helpers](api/math.md) | vec3, quat, mat4 on arrays; math.clamp, lerp, damp, degToRad. | planned | 0.1 |
| [Time](api/time.md) | dt, time.now, fixed steps. | planned | 0.1 |
| [Sprites](api/sprites.md) | createSprites; world and screen size modes; atlases. | planned | 0.2 |
| [Points](api/points.md) | createPoints; size attenuation; textures. | planned | 0.2 |
| [Lines](api/lines.md) | createLines; pixel and world widths; dashes; edges from meshes. | planned | 0.2 |
| [UI overlays and labels](api/ui.md) | ui.trackLabel in the game; engine.labels.bind on the page. | planned | 0.2 |
| [Messages between game and page](api/page.md) | page.post and page.onMessage in the game; engine.postToGame and engine.onGameMessage on the page. | planned | 0.1 |

### Guides

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Performance guide](guides/performance.md) | Measuring; the frame budget; common causes of slow frames and their fixes. | planned | 0.1 |
| [Phones and tablets](guides/phones.md) | Pixel-ratio caps; memory budgets; heat; testing on real devices. | planned | 0.1 |
| [Custom shaders](guides/custom-shaders.md) | Surface functions; full shaders; uniforms and typed materials; hot reload. | planned | 0.1 |
| [Custom passes and render targets](guides/custom-passes.md) | Declaring passes; reading and writing named textures; layer masks. | planned | 0.2 |
| [Loading screens and warm-up](guides/loading-screens.md) | preload; onProgress; scene.warmUp; upload budgets. | planned | 0.1 |
| [UI, HTML overlays and labels](guides/ui-overlays.md) | HTML UI on the page; labels that follow objects; GUI panels. | planned | 0.2 |
| [Video textures](guides/video-textures.md) | Planned after 1.0. Until then, the page sends ImageBitmap frames to the game; browser limits. | planned | after 1.0 |
| [Audio with Web Audio](guides/audio.md) | Why audio stays on the page; sending positions from the game. | planned | 0.1 |
| [Using a physics library](guides/physics.md) | Running Rapier or cannon-es in the game worker; copying transforms. | planned | 0.1 |
| [Multiple views](guides/multiple-views.md) | Split screens with scene.createView, after 1.0; minimaps work from 0.2 through render-to-texture passes. | planned | after 1.0 |
| [The asset pipeline (null3d assets)](guides/assets-pipeline.md) | optimize, env, convert; LODs; texture compression; budget reports. | planned | 0.2 |
| [Testing your game](guides/testing.md) | null3d test; hold mode; image tests; reading results. | planned | 0.1 |
| [Debugging](guides/debugging.md) | Error codes; the inspector; the MCP server; the render-graph dump; common failures. | planned | 0.1 |
| [Deploying](guides/deploying.md) | Headers on common hosts; asset caching; size budgets. | planned | 0.3 |
| [Working with AI agents](guides/agents.md) | The skills; null3d docs; the MCP server; AGENTS.md in templates. | planned | 0.3 |

### Shaders

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [WGSL rules for portable shaders](shaders/wgsl-rules.md) | The three shared language features; limits budget; flat interpolation; what the build rejects. | planned | 0.1 |
| [Surface functions](shaders/surface-functions.md) | The surface record; vertex-offset functions; per-instance attributes. | planned | 0.1 |
| [Built-in shader inputs](shaders/builtins.md) | Camera, time, object, instance and light values available to custom shaders. | planned | 0.1 |
| [Shader library and imports](shaders/library.md) | Importing engine shader modules (math, noise, lighting helpers). | planned | 0.1 |

### Porting from three.js

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Porting from three.js](porting/threejs-overview.md) | The porting workflow; what gets faster; what needs rewriting. | planned | 0.3 |
| [Porting materials and textures](porting/threejs-materials.md) | Parameter-by-parameter conversion; color spaces; approximations. | planned | 0.3 |
| [Porting shaders: GLSL, onBeforeCompile and TSL](porting/threejs-shaders.md) | GLSL to WGSL; three.js built-ins to engine built-ins; worked examples. | planned | 0.3 |
| [Porting post-processing](porting/threejs-postprocessing.md) | EffectComposer passes to post.set and post.addEffect. | planned | 0.3 |
| [The render loop, threads and the DOM](porting/threejs-loop-and-threads.md) | What moves to the game worker; what stays on the page; messages. | planned | 0.3 |
| [Porting React Three Fiber](porting/react-three-fiber.md) | Canvas, useFrame, drei helpers; keeping React for the page UI. | planned | 0.3 |
| [Unsupported three.js features](porting/threejs-unsupported.md) | Features after 1.0 or out of scope, with workarounds. | planned | 0.3 |
| [Verifying a port](porting/verification.md) | Parity images per camera view; performance comparison; the WebGL2 path; phones. | planned | 0.3 |
| [three.js to null3d mapping](porting/threejs-mapping.md) | Every three.js API a port is likely to meet, with its null3d equivalent. | generated | 0.3 |

### Command-line tool

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [The null3d command](cli/null3d.md) | create, test, bench, shot, assets, docs, port, skills, mcp, doctor. | planned | 0.3 |

### Errors

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [E1101: Stale handle](errors/E1101.md) | A call used an object after it was destroyed. Its slot may already hold a new object. | generated | 0.1 |
| [E1102: Too many objects](errors/E1102.md) | The scene reached the most objects one engine holds. | generated | 0.1 |
| [E1103: Object from another engine](errors/E1103.md) | A call received an object that this engine did not create. | generated | 0.1 |
| [E1104: Parent loop](errors/E1104.md) | A call would make an object its own ancestor: the new parent is the object itself or one of its descendants. | generated | 0.1 |
| [E1105: Unknown command](errors/E1105.md) | The engine core received a structural change it does not know, so the TypeScript side and the core come from different builds. | generated | 0.1 |
| [E1106: Object not created yet](errors/E1106.md) | A call read world data of an object in the frame that created it. New objects join the scene when the next frame starts. | generated | 0.1 |
| [E1107: Object created twice](errors/E1107.md) | The engine core received a second create command for one object, so the TypeScript side and the core disagree about the scene. | generated | 0.1 |
| [E1108: Value out of range](errors/E1108.md) | A call received a count or an index past its limit, such as a row past the capacity of an instance batch. | generated | 0.1 |
| [E1203: Invalid number](errors/E1203.md) | A call received a number that is not finite, such as NaN or Infinity. | generated | 0.1 |
| [E1204: Invalid color](errors/E1204.md) | A call received a color that is not a hex string, a number from 0 to 0xffffff, or three numbers from 0 to 1. | generated | 0.1 |
| [E1301: No usable GPU path](errors/E1301.md) | The browser offers neither WebGPU nor WebGL2 for the way the engine was asked to draw. | generated | 0.1 |
| [E1302: GPU lost](errors/E1302.md) | The browser took the GPU away while the engine drew, for example after a driver reset or a GPU crash, and the engine could not carry on. No new GPU device started, or the GPU was lost more than twice within a minute. The engine stopped drawing. | generated | 0.1 |
| [E1401: Not a game module](errors/E1401.md) | The module passed to createEngine as the game does not export a game as its default export. | generated | 0.1 |
| [E1402: Engine core out of date](errors/E1402.md) | The engine core WebAssembly file lacks functions that the TypeScript side calls, so the two come from different builds. | generated | 0.1 |
| [E1403: Engine core not ready](errors/E1403.md) | An engine call ran before the engine core started in this worker, or the core started twice. | generated | 0.1 |
| [E1404: Engine thread failed](errors/E1404.md) | An engine thread hit an error it could not handle after the engine started, so the engine may have stopped. | generated | 0.1 |
| [E1501: Render space full](errors/E1501.md) | The scene needs more room than the renderer set aside. The full part is the draw list, the mesh buffers, the material table, the upload space or the culling pass. | generated | 0.1 |
| [Error codes](errors/index.md) | Every EngineError code with its cause and fix. | generated | 0.1 |

### Cookbook

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Cookbook](cookbook/index.md) | Short recipes; each is also a tested example. | planned | 0.2 |

<!-- null3d:page-list:end -->
