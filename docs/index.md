---
id: index
title: null3D documentation
status: experimental
since: "0.1"
summary: "What null3D is; how the docs are organized; status labels."
---

# null3D documentation

null3D is a browser 3D engine for games and heavy 3D apps. Its core is Rust compiled to WebAssembly, and it runs on worker threads, so the page's main thread stays free. It draws with WebGPU, and with WebGL2 where WebGPU is missing, from the same code.

In null3D, a 3D scene is called a **sketch**. A sketch is a TypeScript module that builds its scene with `defineSketch` and updates it every frame. It runs in a worker of its own, while the page keeps the HTML. Its names follow three.js where the ideas match.

null3D is in early development. Some pages here describe planned features, and each page's status label says which is which.

## Status labels

Every page has a status in its front matter:

| Status | Meaning |
| --- | --- |
| `planned` | The engine does not have the feature yet. The page describes how it will work, and an API page also lists the APIs the engine has now. |
| `experimental` | The feature works, but its API can still change between versions. When the engine has only part of a page's feature, the note at the top of the page names the parts that are not built yet. |
| `stable` | The API follows semantic versioning. |
| `generated` | A tool writes the page from a single source, such as the three.js mapping data. |

Coding agents must never use an API whose page is `planned`. The null3D agent skills follow the same rule.

The API reference on each `api/` page is generated from the doc comments in the engine's source code, so it always matches the code.

The version column in the page list gives the first engine version with the page's feature. Version 0.1 is the first release.

## Where to start

- [Architecture: threads and the frame](concepts/architecture.md) explains where sketch code runs, and why.
- [GPU tiers and backends](concepts/backends.md) shows which browsers get WebGPU and which get WebGL2.
- [Hosting and cross-origin isolation](getting-started/hosting.md) covers the two HTTP headers that turn on worker threads.
- If you are porting a three.js app, the [three.js to null3D mapping](porting/threejs-mapping.md) lists the three.js APIs with their null3D equivalents.

Coding agents can look pages up by ID. A page's ID is its path under `docs/` without `.md`, such as `concepts/architecture`. From version 0.1, the same pages ship inside the `@null3d/engine` package, so they always match the installed engine.

## All pages

<!-- null3d:page-list:start -->

### Getting started

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Install null3D](getting-started/install.md) | The npm packages; the Vite plugin; package versions always match; the optional `null3d` command. | experimental | 0.1 |
| [Your first scene](getting-started/first-scene.md) | page.ts with createEngine; sketch.ts with defineSketch; camera, light, mesh; running it with Vite. | experimental | 0.1 |
| [Hosting and cross-origin isolation](getting-started/hosting.md) | COOP and COEP headers; require-corp on Safari; CORS and CORP for assets; the single-threaded fallback. | experimental | 0.1 |
| [Project structure](getting-started/project-structure.md) | Starting from a template with `bunx @null3d/cli create`; page.ts, sketch.ts, assets/, AGENTS.md, .claude/skills/; what runs where. | planned | 0.3 |

### Concepts

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Architecture: threads and the frame](concepts/architecture.md) | Main thread, sketch worker, render worker, job workers; where the sketch runs; the pipelined frame and its passes; grid cells; latency modes. | experimental | 0.1 |
| [Handles and objects](concepts/handles.md) | 30-bit handles; wrapper objects; stale-handle errors; keeping per-object data in your own arrays. | experimental | 0.1 |
| [Static and dynamic objects](concepts/static-dynamic.md) | When to mark objects static; setters versus direct array writes; dirty ranges. | experimental | 0.1 |
| [Instances and batching](concepts/instances.md) | createInstances; typed-array views; markDirty; automatic batching; per-instance attributes. | experimental | 0.1 |
| [GPU tiers and backends](concepts/backends.md) | WebGPU core, compatibility mode and WebGL2; color, anti-aliasing and depth on each tier; capability flags; the portable budget; never branching on GPU names. | experimental | 0.1 |
| [Quality presets, dynamic resolution and frame budgets](concepts/quality-presets.md) | Low to Ultra; pixel-ratio caps; the preset check; switching presets; the frame-budget governor; quality events for sketch code. | experimental | 0.1 |
| [Color management](concepts/color-management.md) | Linear working space; sRGB hex colors and linear arrays; texture color spaces; HDR color; exposure and tone mapping; transparent canvases; parity with three.js. | experimental | 0.1 |
| [Materials and pipelines](concepts/materials.md) | Built-in materials; permutations; pipeline warm-up; why changing shader features can stall a frame. | experimental | 0.1 |
| [Lighting and environment](concepts/lighting.md) | Light types and units; clustered lighting; fog; environment maps and spherical harmonics. | experimental | 0.1 |
| [Shadows](concepts/shadows.md) | Cascades that stay still as the camera turns; the shadow atlas of spot and point lights; update rates and filtering per preset; bias settings. | experimental | 0.1 |
| [Render layers](concepts/render-layers.md) | 32-bit layer masks that choose which cameras draw which objects and instance batches. | experimental | 0.1 |
| [The render graph](concepts/render-graph.md) | Declared reads and writes; automatic order; transient memory; validation errors; the text dump. | experimental | 0.1 |
| [Large worlds and precision](concepts/large-worlds.md) | Cell-relative positions and per-frame camera-to-cell offsets; reversed depth; largeWorld mode; batch origins; floating-origin geometry. | planned | 0.2 |
| [Culling](concepts/culling.md) | Frustum culling on the GPU on WebGPU and on the job workers on WebGL2; grid cells, whole cells out of view skipped first, and positions relative to the camera. | experimental | 0.1 |
| [Levels of detail](concepts/lod.md) | LOD groups; generated LODs; per-instance selection. | planned | 0.2 |
| [Assets and prefabs](concepts/assets.md) | glTF, KTX2, meshopt; prefabs and instantiate; upload budgets; memory. | experimental | 0.2 |
| [The post-processing chain](concepts/post-processing.md) | HDR scene color, bloom at half size and below, and one final pass for exposure, tone mapping, FXAA, dithering, color grading and the vignette. | experimental | 0.2 |

### API reference

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Page API: createEngine](api/engine.md) | createEngine options and start errors; memory; capabilities and mode; pausing, detaching, failures, measuring, captureFrame, messages and destroy. | experimental | 0.1 |
| [Sketch API: defineSketch and the context](api/sketch.md) | The context object: scene, assets, materials, geometry, textures, input, time, engine, quality, post, render, page, ui, debug; the callbacks. | experimental | 0.1 |
| [Scene](api/scene.md) | Creating objects; models and copies; find; background, environment, fog, sky; warmUp. | experimental | 0.1 |
| [Objects and transforms](api/objects.md) | Setters and getters; parents; flags; destroy. | experimental | 0.1 |
| [Cameras](api/cameras.md) | Perspective and orthographic cameras; screenToRay; worldToScreen; layers. | experimental | 0.1 |
| [Lights](api/lights.md) | Directional, point, spot, hemisphere and ambient lights; shadow options. | experimental | 0.1 |
| [Geometry](api/geometry.md) | Generators with three.js parameters; meshes from arrays; vertex formats; large meshes. | experimental | 0.1 |
| [Materials](api/materials.md) | standard, unlit, shader, shadowCatcher; every option. | experimental | 0.1 |
| [Textures](api/textures.md) | loadTexture options; KTX2 files; fromData; fromImageBitmap; fromPass; cube maps. | experimental | 0.1 |
| [Assets](api/assets.md) | loadGltf, loadTexture, loadImageBitmap, loadLut, loadEnvironment, builtinEnvironment, loadJson, loadBinary, preload, onProgress. | experimental | 0.1 |
| [Animation](api/animation.md) | The animator; play, crossFade, layers, joint masks, additive clips, events; morph weights. | experimental | 0.2 |
| [Raycasting and spatial queries](api/raycast.md) | raycast, raycastAny, raycastAll, raycastBatch, overlap queries, pointer events on objects. | experimental | 0.2 |
| [Input](api/input.md) | Pointer, keyboard, touch and gamepad; action maps. | experimental | 0.1 |
| [Camera controls (@null3d/controls)](api/controls.md) | Orbit and map controls (0.1); fly and first-person controls (0.2). | experimental | 0.1 |
| [Post-processing API](api/post.md) | post.set for tone mapping, exposure, bloom, color grading tables and the vignette; the other effects and post.addEffect of 0.2. | experimental | 0.1 |
| [Render graph API](api/render.md) | render.addPass declarations; enabling and disabling passes; dumpGraph. | planned | 0.2 |
| [Quality API](api/quality.md) | quality.preset, quality.set, quality.setPreset, the preset check, frame budgets, quality events. | experimental | 0.1 |
| [Debug drawing and stats](api/debug.md) | debug.line, box, sphere, arrow, axes, grid, frustum and light; debug.stats and frameStats; engine.measure and its figures; debug.view and debug.shadowCamera. | experimental | 0.1 |
| [Math helpers](api/math.md) | vec3, quat, mat4 and color on plain arrays; math.clamp, lerp, damp and a random generator that hold mode seeds. | experimental | 0.1 |
| [Time](api/time.md) | dt, time.now, fixed steps. | experimental | 0.1 |
| [Sprites](api/sprites.md) | createSprites; world and screen size modes; atlases. | experimental | 0.2 |
| [Points](api/points.md) | createPoints; size attenuation; textures. | planned | 0.2 |
| [Lines](api/lines.md) | createLines; pixel and world widths; dashes; edges from meshes. | planned | 0.2 |
| [UI overlays and labels](api/ui.md) | ui.trackLabel in the sketch; engine.labels.bind on the page. | planned | 0.2 |
| [Messages between sketch and page](api/page.md) | page.post and page.onMessage in the sketch; engine.postToSketch and engine.onSketchMessage on the page. | experimental | 0.1 |

### Guides

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Performance guide](guides/performance.md) | Measuring; the frame budget on computers, phones and tablets; common causes of slow frames and their fixes. | experimental | 0.1 |
| [Phones and tablets](guides/phones.md) | Pixel-ratio caps; memory budgets; heat; testing on real devices. | experimental | 0.1 |
| [Custom shaders](guides/custom-shaders.md) | WGSL in sketch code; shader errors; surface functions; full shaders; uniforms and typed materials; hot reload. | experimental | 0.1 |
| [Custom passes and render targets](guides/custom-passes.md) | Declaring passes; reading and writing named textures; layer masks. | planned | 0.2 |
| [Loading screens and warm-up](guides/loading-screens.md) | preload; onProgress; scene.warmUp; the preset check; upload budgets; switching presets behind a loading screen. | experimental | 0.1 |
| [Accessibility](guides/accessibility.md) | What the canvas tells assistive technology; keyboard use; reduced motion; pausing; loading and errors. | experimental | 0.1 |
| [3D scenes on content pages](guides/content-pages.md) | Product and marketing pages: the fallback page, a load deadline, pausing off screen, scroll-driven cameras, second visits and crashes. | experimental | 0.1 |
| [UI, HTML overlays and labels](guides/ui-overlays.md) | HTML UI on the page; labels that follow objects; GUI panels. | planned | 0.2 |
| [Video textures](guides/video-textures.md) | Planned after 1.0. Until then, the page sends ImageBitmap frames to the sketch; browser limits. | planned | after 1.0 |
| [Audio with Web Audio](guides/audio.md) | Why audio stays on the page; sending positions from the sketch. | experimental | 0.1 |
| [Using a physics library](guides/physics.md) | Running Rapier or cannon-es in the sketch worker; copying transforms. | experimental | 0.1 |
| [Multiple views](guides/multiple-views.md) | Split screens with scene.createView, after 1.0; minimaps work from 0.2 through render-to-texture passes. | planned | after 1.0 |
| [The asset pipeline (the `assets` command)](guides/assets-pipeline.md) | optimize, env, convert; LODs; texture compression; budget reports. | experimental | 0.2 |
| [Testing your sketch](guides/testing.md) | Hold mode; image tests; reading results; frames that stay the same on every run. | experimental | 0.1 |
| [Debugging](guides/debugging.md) | Error codes; the inspector; the MCP server; the render-graph dump; common failures. | experimental | 0.1 |
| [Deploying](guides/deploying.md) | Headers on common hosts; asset caching; size budgets. | planned | 0.3 |
| [Working with AI agents](guides/agents.md) | Installing the null3D skills in Claude Code, claude.ai and other agent tools; docs by ID; the test loop; the MCP server and AGENTS.md in templates (0.3). | experimental | 0.1 |

### Shaders

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [WGSL rules for portable shaders](shaders/wgsl-rules.md) | The three shared language features; optional features; flat interpolation; limits budget; rules the build cannot check. | experimental | 0.1 |
| [Surface functions](shaders/surface-functions.md) | The surface record; vertex-offset functions; per-instance attributes. | experimental | 0.1 |
| [Built-in shader inputs](shaders/builtins.md) | Camera, time, object, instance and light values available to custom shaders. | experimental | 0.1 |
| [Shader library and imports](shaders/library.md) | The WGSL modules that ship with the engine: math, noise, color, lighting, fog, vertex, depth and signed distance helpers, and how to import them. | experimental | 0.1 |

### Porting from three.js

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Porting from three.js](porting/threejs-overview.md) | The porting workflow; what gets faster; what needs rewriting. | planned | 0.3 |
| [Porting materials and textures](porting/threejs-materials.md) | Parameter-by-parameter conversion; color spaces; approximations. | planned | 0.3 |
| [Porting shaders: GLSL, onBeforeCompile and TSL](porting/threejs-shaders.md) | GLSL to WGSL; three.js built-ins to engine built-ins; worked examples. | planned | 0.3 |
| [Porting post-processing](porting/threejs-postprocessing.md) | EffectComposer passes to post.set and post.addEffect. | planned | 0.3 |
| [The render loop, threads and the DOM](porting/threejs-loop-and-threads.md) | What moves to the sketch worker; what stays on the page; messages. | planned | 0.3 |
| [Porting React Three Fiber](porting/react-three-fiber.md) | Canvas, useFrame, drei helpers; keeping React for the page UI. | planned | 0.3 |
| [Unsupported three.js features](porting/threejs-unsupported.md) | Features after 1.0 or out of scope, with workarounds. | planned | 0.3 |
| [Verifying a port](porting/verification.md) | Parity images per camera view; performance comparison; the WebGL2 path; phones. | planned | 0.3 |
| [three.js to null3D mapping](porting/threejs-mapping.md) | Every three.js API a port is likely to meet, with its null3D equivalent. | generated | 0.3 |

### Command-line tool

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [The `null3d` command](cli/null3d.md) | create, test, bench, shot, assets, docs, port, skills, mcp, doctor. | experimental | 0.1 |

### Errors

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [E1101: Stale handle](errors/E1101.md) | A call used an object after it was destroyed. Its slot may already hold a new object. | generated | 0.1 |
| [E1102: Too many objects](errors/E1102.md) | The scene, the table of instance batches or the queue of changes for the next frame is full. The message names which one, and how many it holds. | generated | 0.1 |
| [E1103: Object from another engine](errors/E1103.md) | A call received an object that this engine did not create. | generated | 0.1 |
| [E1104: Parent loop](errors/E1104.md) | A call would make an object its own ancestor: the new parent is the object itself or one of its descendants. | generated | 0.1 |
| [E1105: Unknown command](errors/E1105.md) | The engine core received a structural change it does not know, so the TypeScript side and the core come from different builds. | generated | 0.1 |
| [E1106: Object never created](errors/E1106.md) | A call such as `setVisible` or `setParent` queued a change for an object that the engine never created. The engine creates an object when the next frame starts. When that fails, for example because its parent was destroyed, the object never joins the scene. | generated | 0.1 |
| [E1107: Object created twice](errors/E1107.md) | The engine core received a second create command for one object, so the TypeScript side and the core disagree about the scene. | generated | 0.1 |
| [E1108: Value out of range](errors/E1108.md) | A call received a number outside the range it takes. Examples are a row past the capacity of an instance batch, an opacity above 1, a negative radius, and a camera's far plane that does not lie beyond its near plane. | generated | 0.1 |
| [E1109: Engine memory full](errors/E1109.md) | The engine could not create or grow its WebAssembly memory. A page with worker threads gives the engine 1 GiB by default, and up to 4 GiB through the memory option of createEngine. Each instance row takes about 210 bytes, or about 260 with per-row colors. So about 5 million rows fill 1 GiB, along with the rest of the scene. A browser can refuse memory sooner, as phones often do. It can also refuse a new engine's memory while the memory of an engine that stopped a moment before is not free yet. The engine then tries again for about 10 seconds before it fails. | generated | 0.1 |
| [E1110: Unmarked write to a static object](errors/E1110.md) | A static object's position, rotation, scale or bounding sphere changed without a setter. The engine recomputes a static object only in a frame where a setter marks it or its parent moves. So such a change can show late, or never. Development builds check these values of every static object before each transform update. Each frame has one transform update, and a sketch with onLateUpdate gets a second one after that callback. Release builds leave the check out. | generated | 0.1 |
| [E1203: Invalid number](errors/E1203.md) | A call received a number that is not finite, such as NaN or Infinity. | generated | 0.1 |
| [E1204: Invalid color](errors/E1204.md) | A call received a color that is not a hex string, a number from 0 to 0xffffff, or three numbers from 0 to 1. | generated | 0.1 |
| [E1205: Unknown input name](errors/E1205.md) | An input call received a name that no key, button or action has, or `input.actions.define()` received an action name that a key or button already has. Names are case-sensitive: `KeyW` is the W key, and `keyW` names nothing. | generated | 0.1 |
| [E1206: Invalid mesh arrays](errors/E1206.md) | geometry.fromArrays() received arrays that make no mesh. An array can have the wrong length for the vertex count, an index can name no vertex, or a value can be NaN or Infinity. Normals can also be missing, or both given and computed. | generated | 0.1 |
| [E1207: Invalid layer mask](errors/E1207.md) | A call that sets layers received a number that is not a 32-bit layer mask: a fraction, NaN, or a number past 32 bits. | generated | 0.1 |
| [E1208: Invalid texture](errors/E1208.md) | A call that makes or updates a texture received something it cannot use. It can be an option the engine does not know, or an image without pixels or larger than the device takes. It can also be data that does not fit the texture's size and format. With a KTX2 file, it can be an option that the file cannot take, or an update of its texture. | generated | 0.1 |
| [E1213: Invalid setting](errors/E1213.md) | A call received a setting that it does not have, or a value that the setting does not take. Examples are a tone mapping that the engine does not know, a negative exposure, and a built-in environment that the engine does not have. | generated | 0.1 |
| [E1214: Invalid sketch option](errors/E1214.md) | defineSketch() received an option out of its range. fixedRate must be a number above 0, and maxFixedSteps a whole number of 1 or more. The engine checks the options before it runs the setup function. | generated | 0.1 |
| [E1215: Invalid custom material WGSL](errors/E1215.md) | materials.shader() received WGSL that it cannot draw with. The null3D Vite plugin compiles WGSL while it builds the project. The engine therefore takes only what the plugin compiled: a template literal after a /* wgsl */ comment, or a .wgsl file that a module imports. The WGSL of a custom material declares a surface function or a vertex offset. A full shader instead has a @vertex entry point that takes an InstanceIn from null3d::mesh. | generated | 0.1 |
| [E1216: Invalid uniform](errors/E1216.md) | A custom material's uniforms did not match its WGSL. The uniforms option and set() take the names of the fields of struct Uniforms in the WGSL, each with a value of its type. A field cannot have the name of a standard value, such as color or roughness, because set() takes those too. | generated | 0.1 |
| [E1217: Invalid material option](errors/E1217.md) | A material factory received an option value that it does not take, such as an unknown alpha mode or blending. | generated | 0.1 |
| [E1218: Invalid animation call](errors/E1218.md) | An animator call named a clip, layer or joint that the object's animation does not have. Or it got an option out of range, such as a negative fade. animator() was called on an object that has no animation clips. Or the engine refused animation data, such as a skeleton that lists a joint before its parent. | generated | 0.2 |
| [E1301: No usable GPU path](errors/E1301.md) | The browser offers neither WebGPU nor WebGL2 for the way the engine was asked to draw. | generated | 0.1 |
| [E1302: GPU lost](errors/E1302.md) | The browser took the GPU away while the engine drew, for example after a driver reset or a GPU crash, and the engine could not carry on. No new GPU device started, or the GPU was lost more than twice within a minute. The engine stopped drawing. | generated | 0.1 |
| [E1303: WebAssembly SIMD missing](errors/E1303.md) | The browser runs WebAssembly without SIMD, which the engine's core needs. | generated | 0.1 |
| [E1401: Not a sketch module](errors/E1401.md) | The module passed to createEngine as the sketch does not export a sketch as its default export. | generated | 0.1 |
| [E1402: Engine core out of date](errors/E1402.md) | The engine core WebAssembly file lacks functions that the TypeScript side calls, so the two come from different builds. Development builds check this when the core loads. | generated | 0.1 |
| [E1403: Engine core not ready](errors/E1403.md) | An engine call ran before the engine core started in this worker, or the core started twice. | generated | 0.1 |
| [E1404: Engine thread failed](errors/E1404.md) | An engine thread, or the drawing on the page, hit an error it could not handle. After the start the engine may have stopped. During the start, createEngine() stops the engine and rejects with this error. | generated | 0.1 |
| [E1405: Engine thread did not start](errors/E1405.md) | An engine worker failed while the engine started. The worker's script, the engine core or the renderer did not start there, or the sketch's setup function threw an error without an engine code. | generated | 0.1 |
| [E1406: Engine file not downloaded](errors/E1406.md) | A file of the engine core did not download whole, or a file that a call loads the first time. The first KTX2 file loads the KTX2 transcoder, and the first glTF file the glTF loader. The first glTF file with meshopt compression loads the meshopt decoder. The first color grading table loads its readers, the first environment its reader, and the first sprite batch the sprite code. The server answered with an error, or the connection broke off. | generated | 0.1 |
| [E1407: Invalid hold time](errors/E1407.md) | The ?hold= switch or the hold option of createEngine gave a hold time that is not a number of seconds from 0 to 600. | generated | 0.1 |
| [E1408: Hold failed](errors/E1408.md) | The sketch or the engine failed in hold mode, before the engine read the held frame back. A live engine logs an error in the sketch and carries on. Hold mode stops at the first one, so a test fails at once. | generated | 0.1 |
| [E1409: Invalid memory maximum](errors/E1409.md) | The memory option of createEngine asked for a maximum that is not a whole number of MiB from 256 to 4096. | generated | 0.1 |
| [E1410: Sketch module not loaded](errors/E1410.md) | The sketch module that createEngine got did not load. It did not download, or its code threw an error while the module loaded. | generated | 0.1 |
| [E1411: Asset not downloaded](errors/E1411.md) | A loading call could not download its file. The server answered with an error, such as 404 for a missing file, or the network failed. | generated | 0.1 |
| [E1412: Asset not decoded](errors/E1412.md) | A loading call downloaded its file but could not read it. The browser could not decode the image, as with a format it does not support. Or the file was a KTX2 file that the engine does not load, or not valid JSON. Or it was a color grading table that the engine does not read, such as a 1D table or one with a texel missing. Or it was not an environment map that `bunx @null3d/cli assets env` writes. The message says what in the file the engine could not read, with its line where it has one. | generated | 0.1 |
| [E1413: Asset from another origin blocked](errors/E1413.md) | A loading call could not read a file from another origin. The browser reads such a file only when its server allows the page's origin with an Access-Control-Allow-Origin header. The browser gives no reason, so the server may also have been unreachable. | generated | 0.1 |
| [E1414: Frame not captured](errors/E1414.md) | engine.capture() could not give an image of a frame. The engine had stopped, or the thread that draws could not read the frame back from the GPU or encode it. | generated | 0.1 |
| [E1415: Page thread already runs a sketch](errors/E1415.md) | createEngine() was asked to run a sketch on the page's thread while another engine still runs its sketch there. The page's copy of the engine core serves one engine at a time. This happens with sketchThread: 'main', and in the single-threaded build, which runs every sketch on the page's thread. | generated | 0.1 |
| [E1416: glTF file not read](errors/E1416.md) | assets.loadGltf() downloaded a file that is not a glTF 2.0 model it can read. Its JSON or binary chunk may be broken, or an offset or a count may point past the data. A buffer or an image may be missing, or its nodes may form a loop. | generated | 0.2 |
| [E1417: glTF feature not supported](errors/E1417.md) | A glTF file needs an extension that the engine does not read, as its extensionsRequired list says. Or a call asked a model for something it cannot give, such as instance batches of a model with no meshes. | generated | 0.2 |
| [E1501: Render space full](errors/E1501.md) | The scene needs more room than the renderer set aside. The full part is the draw list, the material table, the upload space or the culling pass. On WebGPU the culling pass covers 2,097,152 objects and instance rows on every device, and more on devices with larger GPU buffers. On WebGL2 the number follows the largest texture the device allows. The number for the device is in engine.capabilities.maxInstances. | generated | 0.1 |
| [E1502: Pass input missing](errors/E1502.md) | A render pass uses a target or buffer that no pass creates, or reads one that no pass running in the frame writes. The render graph checks every pass before the frame draws. | generated | 0.1 |
| [E1503: Target created twice](errors/E1503.md) | Two render passes create the same target, or a pass creates a target that the render graph keeps between frames. Each target has one creator, which sets its format and size. | generated | 0.1 |
| [E1504: Render pass cycle](errors/E1504.md) | Render passes need each other in a loop, so no order runs each pass after the passes whose output it reads. | generated | 0.1 |
| [E1505: Pass targets do not match](errors/E1505.md) | A render pass draws into targets that one GPU render pass cannot hold together. A target can have another size than the pass, or the targets can have different sample counts. The pass can also draw into two depth targets, into a whole texture array instead of one layer, or into no target. A resolve pass fails the same way when it cannot resolve its target into the canvas. That target must be multisampled, in the canvas's format and size, and read by no other running pass. | generated | 0.1 |
| [Error codes](errors/index.md) | Every EngineError code with its cause and fix. | generated | 0.1 |

### Cookbook

| Page | What it covers | Status | Version |
| --- | --- | --- | --- |
| [Cookbook](cookbook/index.md) | Short recipes; each is also a tested example. | planned | 0.2 |

<!-- null3d:page-list:end -->
