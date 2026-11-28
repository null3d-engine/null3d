---
id: pages
title: All pages
generated: true
summary: The docs pages of each area and group.
---

# All pages

> The docs generator writes this list from the docs inventory and each page's front matter. [Error codes](errors/index.md) lists every error code.

## Getting started

### First steps

| Page | What it covers |
| --- | --- |
| [Install null3D](getting-started/install.md) | The npm packages; the Vite plugin, which every Vite build needs; package versions always match; the optional `null3d` command. |
| [Your first scene](getting-started/first-scene.md) | page.ts with createEngine; sketch.ts with defineSketch; camera, light, mesh; running it with Vite. |
| [Project structure](getting-started/project-structure.md) | Starting from the `empty`, `product` or `game` template with `bunx @null3d/cli create`; page.ts, sketch.ts, AGENTS.md and the agent hook; what runs where. |

### Hosting and licenses

| Page | What it covers |
| --- | --- |
| [Hosting and cross-origin isolation](getting-started/hosting.md) | COOP and COEP headers; require-corp on Safari; CORS and CORP for assets; the Content-Security-Policy; the engine's files on a CDN; Brotli; the third-party notices; offline play with a service worker and the build's file list; the caches between visits; the single-threaded fallback; Electron desktop apps served from a custom scheme. |
| [Try null3D from a CDN](getting-started/cdn.md) | The CDN build; its production and development entries; one HTML file with no bundler; import maps; the policy and CORS headers; both thread modes; what needs a build step. |
| [Network use](getting-started/network-use.md) | What null3D downloads, when each file loads, the build's one download, and how to keep a page on its own origin. |
| [Third-party notices](getting-started/third-party-notices.md) | The third-party code in each null3D package, with its version and license, and the notices file that a build writes beside the page. |

## Concepts

### How the engine runs

| Page | What it covers |
| --- | --- |
| [Architecture: threads and the frame](concepts/architecture.md) | Main thread, sketch worker, render worker, job workers; where the sketch runs; the pipelined frame and its passes; grid cells; latency modes. |
| [Handles and objects](concepts/handles.md) | 30-bit handles; wrapper objects; stale-handle errors; keeping per-object data in your own arrays. |
| [Static and dynamic objects](concepts/static-dynamic.md) | When to mark objects static; setters versus direct array writes; dirty ranges. |
| [Instances and batching](concepts/instances.md) | createInstances; typed-array views; markDirty; automatic batching; per-row colors and values. |
| [The particle buffer](concepts/particle-buffer.md) | What a particle buffer holds: its 32-byte records, its values and its frame's values; how an emitter or sketch code writes births into it; and the limits that it meets. |
| [Assets and prefabs](concepts/assets.md) | glTF, KTX2, meshopt, Draco; prefabs and instantiate; upload budgets; memory. |
| [GPU tiers and backends](concepts/backends.md) | WebGPU core, compatibility mode and WebGL2; color, anti-aliasing and depth on each tier; capability flags; the portable budget; never branching on GPU names. |
| [Quality presets, dynamic resolution and frame budgets](concepts/quality-presets.md) | Low to Ultra; pixel-ratio caps; the preset check; switching presets; the frame-budget governor; quality events for sketch code. |
| [Quality preset tables](concepts/quality-preset-tables.md) | Each preset's starting devices, GPU path caps, check rules and settings. |

### Drawing a frame

| Page | What it covers |
| --- | --- |
| [Color management](concepts/color-management.md) | Linear working space; sRGB hex colors and linear arrays; texture color spaces; HDR color; exposure and tone mapping; transparent canvases. |
| [Materials and pipelines](concepts/materials.md) | Built-in materials; shader variants; pipeline warm-up; why a new combination of shader features costs a build. |
| [Lighting and environment](concepts/lighting.md) | Light types, units and exposure; clustered lighting; fog; environment maps and spherical harmonics; light probe grids; sky and environment backgrounds; the sky's light and time of day. |
| [Shadows](concepts/shadows.md) | Cascades that stay still as the camera turns and blend where they meet; contact shadows where small objects touch the ground; the shadow atlas of spot and point lights; update rates and filtering per preset; bias settings. |
| [Render layers](concepts/render-layers.md) | 32-bit layer masks that choose which cameras draw which objects and instance batches. |
| [The render graph](concepts/render-graph.md) | Declared reads and writes; automatic order; transient memory; validation errors; the text dump. |

### Large scenes

| Page | What it covers |
| --- | --- |
| [Large worlds and precision](concepts/large-worlds.md) | Cell-relative positions and per-frame camera-to-cell offsets; reversed depth; largeWorld mode; batch origins; floating-origin geometry. |
| [Culling](concepts/culling.md) | Frustum culling on the GPU on WebGPU, or on the job workers there when the device draws directly, and on the job workers on WebGL2; grid cells, whole cells out of view skipped first, positions relative to the camera, and occlusion culling: behind large opaque objects that the GPU picks on WebGPU, and behind marked blockers on WebGL2. |
| [Levels of detail](concepts/lod.md) | LOD groups; levels that meshes made in code plan on the job workers; generated LODs; cluster patches; staged downloads; per-instance selection; small-object hiding. |

### Effects after the scene

| Page | What it covers |
| --- | --- |
| [The post-processing chain](concepts/post-processing.md) | HDR scene color, ambient occlusion and screen-space reflections at half size, custom effects, depth of field with near and far fields, bloom through a chain of mip levels, automatic exposure from a meter on the GPU, an outline mask, and the final pass for the vignette, tone mapping, FXAA, outlines, color grading and dithering, in two steps once the render scale can drop below the whole canvas; still views that blend and then rest the GPU. |

## Guides

### Performance and loading

| Page | What it covers |
| --- | --- |
| [Performance guide](guides/performance.md) | Measuring; the frame budget on computers, phones and tablets; common causes of slow frames and their fixes. |
| [Phones and tablets](guides/phones.md) | Pixel-ratio caps; memory budgets; heat; testing on real devices. |
| [Loading screens and warm-up](guides/loading-screens.md) | The download list; preload; onProgress; loads one after another; scene.warmUp; shader files that load up front; the preset check during play or before it; upload budgets; switching presets behind a loading screen. |
| [Shaders that load on first use](guides/first-use-shaders.md) | The features whose shaders download on first use, which createEngine's preload takes. |
| [A fast start](guides/start-time.md) | Where a page's start goes, on a simulated phone link and on real phones; compression, cache headers, the compiled core and HTTP/2 on the host; the early core script; what the engine does while the core downloads; downloads of the first view and of the rest; the preset check; pipelines on phones; testing and measuring a start. |

### Shaders and rendering

| Page | What it covers |
| --- | --- |
| [Custom shaders](guides/custom-shaders.md) | WGSL in sketch code; shader errors; surface functions; full shaders; uniforms, textures and typed materials; hot reload. |
| [Custom passes and render targets](guides/custom-passes.md) | Custom effects and tone curves in WGSL; declaring passes; reading and writing named textures; layer masks; reflections and a water recipe; full-screen passes, a soft outline glow and effects that read textures. |
| [Baked light data](guides/baked-light-data.md) | One file format for probe grids and light maps baked outside the engine: the JSON members, base64 payloads, the loading calls, the engine's own bake, and the faults that the loader names. |

### Pages and UI

| Page | What it covers |
| --- | --- |
| [HTML UI around the scene](guides/ui-overlays.md) | HTML UI on the page; labels that follow objects; GUI panels. |
| [3D scenes on content pages](guides/content-pages.md) | Product and marketing pages: the fallback page, a load deadline, pausing off screen, scroll-driven cameras, second visits and crashes. |
| [Accessibility](guides/accessibility.md) | What the canvas tells assistive technology; keyboard use; reduced motion; pausing; loading and errors. |
| [Multiple views](guides/multiple-views.md) | Split screens and picture in picture with scene.createView: a camera and a rectangle of the canvas, drawn after the camera's view in the same frame; per-view culling; the cost of each view. |
| [Video textures](guides/video-textures.md) | engine.registerVideo on the page and textures.fromVideo in the sketch; frame sizes and the upload budget; browser limits. |

### Game systems

| Page | What it covers |
| --- | --- |
| [Using a physics library](guides/physics.md) | Running Rapier or cannon-es in the sketch worker; copying transforms. |
| [Using null3D with a deterministic simulation](guides/deterministic-simulation.md) | The maths entry a simulation may import; createMath with an exact math library; input, picking and physics that decide a result stay out of the sketch; createEngine's input option; a camera that the player aims from recorded input; a production build of a game's engine files. |
| [Sound in a scene](guides/audio.md) | Sound that follows the scene with @null3d/sound: beds whose level the scene sets, sources at places, groups of many sources, and events. |

### Example add-ons

| Page | What it covers |
| --- | --- |
| [Car paint](guides/car-paint.md) | An example add-on you copy: a paint material over the clear coat, with glinting metal flakes that stop shimmering, panel seams that follow the pixel, and an optional carbon weave with direction-dependent shine. |
| [Lens kit](guides/lens-kit.md) | An example add-on you copy: one look for the camera's marks: a grade, a sharpening, a vignette, film grain, color fringes, an anamorphic streak read from bloom, and a speed blur. |
| [In-world screens](guides/screens.md) | An example add-on you copy: displays painted on an OffscreenCanvas in the sketch, with a refresh rate for each screen, uploads of only the changed rectangles, an LCD look that changes with distance, a boot glitch, and clicks mapped back to the canvas's coordinates. |

### Testing and debugging

| Page | What it covers |
| --- | --- |
| [Testing your sketch](guides/testing.md) | Hold mode; image tests; reading results; frames that stay the same on every run; browser tests of a whole app. |
| [Debugging](guides/debugging.md) | Error codes; the in-page inspector; the MCP server; the render-graph dump; common failures. |

### Building and shipping

| Page | What it covers |
| --- | --- |
| [The asset pipeline (the `assets` command)](guides/assets-pipeline.md) | optimize, convert, pack-orm, normal-from-bump, env; LODs; texture compression; blockers and stored trees; budget reports. |
| [Deploying](guides/deploying.md) | Headers on common hosts; asset caching; size budgets. |

### Agents and add-ons

| Page | What it covers |
| --- | --- |
| [Working with AI agents](guides/agents.md) | Installing the null3D skills in Claude Code, claude.ai and other agent tools; docs by ID; the test loop; the MCP server and the in-page inspector. |
| [Building an add-on](guides/add-ons.md) | One package with one entry; claim a namespace and the plugin interface range; import only the public entry points; compile the shaders on both paths; name a page; run the check. |

## Cookbook

| Page | What it covers |
| --- | --- |
| [Cookbook](cookbook/index.md) | Recipes for one common task each: selection, cameras, characters, loading, sky and effects, screens, and hiding what walls hide. |

## Shaders

| Page | What it covers |
| --- | --- |
| [Surface functions](shaders/surface-functions.md) | The surface record; normals for the diffuse light and the sky's light; occlusion counted once; uniforms and textures; reflections; transmission; light through thin surfaces; clear coat and sheen; vertex-offset functions; the coverage of a shadow caster and where its lookup reads; a material's own lobe; values per row of a batch; second texture coordinates, pixel position and instance index. |
| [Built-in shader inputs](shaders/builtins.md) | Camera, time, object and instance values available to custom shaders, with the camera's and the object's matrices and ids. |
| [Shader library and imports](shaders/library.md) | The WGSL modules that ship with the engine: math, noise, color, lighting, fog, vertex, depth and signed distance helpers, and how to import them. |
| [WGSL rules for portable shaders](shaders/wgsl-rules.md) | The three shared language features; optional features; flat interpolation; a warning for atomic compare-exchange; limits budget; rules the build cannot check. |

## Porting from three.js

| Page | What it covers |
| --- | --- |
| [Porting from three.js](porting/threejs-overview.md) | A port is a rewrite; the limits a port meets; the porting workflow; what gets faster; what needs rewriting. |
| [three.js to null3D mapping](porting/threejs-mapping.md) | Every three.js API a port is likely to meet, with its null3D equivalent. |
| [The render loop, threads and the DOM](porting/threejs-loop-and-threads.md) | What moves to the sketch worker; what stays on the page; messages. |
| [Porting materials and textures](porting/threejs-materials.md) | Parameter-by-parameter conversion; color spaces; approximations. |
| [Porting shaders: GLSL, onBeforeCompile and TSL](porting/threejs-shaders.md) | GLSL to WGSL; three.js built-ins to engine built-ins; worked examples. |
| [Porting post-processing](porting/threejs-postprocessing.md) | EffectComposer passes and pmndrs effects to post.set settings; ShaderPass to post.addEffect; three.js tone mappings to custom tone curves. |
| [Porting React Three Fiber](porting/react-three-fiber.md) | Canvas, useFrame, drei helpers; keeping React for the page UI. |
| [Unsupported three.js features](porting/threejs-unsupported.md) | three.js features with no null3D equivalent, with workarounds. |
| [Verifying a port](porting/verification.md) | Parity images per camera view; performance comparison; the WebGL2 path; phones. |

## API reference

### Page and sketch

| Page | What it covers |
| --- | --- |
| [Page API: createEngine](api/engine.md) | createEngine options and start errors; memory; capabilities and mode; pausing, detaching, failures, measuring, captureFrame, messages, pointer lock and destroy. |
| [Sketch API: defineSketch and the context](api/sketch.md) | The context object: the start data, scene, assets, materials, geometry, textures, input, time, engine, quality, post, render, page, ui, debug; the callbacks; the options, with the download list. |
| [Messages between sketch and page](api/page.md) | page.post and page.onMessage in the sketch; engine.postToSketch and engine.onSketchMessage on the page; start data that the setup reads as ctx.data. |

### Scene and objects

| Page | What it covers |
| --- | --- |
| [Scene](api/scene.md) | Creating objects; models and copies; find; multiple views of one scene; background, environment, reflection probes, fog, sky; the light probe grid; the material override; warmUp. |
| [Objects and transforms](api/objects.md) | Setters and getters; parents; flags; destroy; pointer events. |
| [Cameras](api/cameras.md) | Perspective and orthographic cameras; a perspective camera's focal length; lens shift; screenToRay; worldToScreen; layers. |
| [Lights](api/lights.md) | Directional, point, spot, hemisphere, ambient, rectangle and tube lights; shadow options. |
| [Geometry](api/geometry.md) | Generators of common shapes; extra shapes in @null3d/geometry; meshes from arrays; morph targets; vertices that change; levels of detail that meshes plan on the job workers; vertex formats; large meshes. |
| [Materials](api/materials.md) | standard, unlit, shader, shadowCatcher; every option. |
| [Textures](api/textures.md) | loadTexture options; KTX2 files; fromData; fromImageBitmap; fromCanvas; fromVideo; fromPass. |
| [Assets](api/assets.md) | loadGltf, registerGltfExtension, loadTexture, loadImageBitmap, loadLut, lutFromData, loadEnvironment, builtinEnvironment, skyEnvironment, loadCubemap, loadLightProbeGrid, loadLightMap, lightProbeGridFile, loadJson, loadBinary, preload, onProgress, cache. |
| [Animation](api/animation.md) | The animator; play, crossFade, clip weights, start times, 1D blends, layers, joint masks, additive clips, joint overrides and look-at, events; property animation of lights, cameras and materials, glTF's KHR_animation_pointer; morph weights. |

### Sprites, points, lines and vertex draws

| Page | What it covers |
| --- | --- |
| [Sprites](api/sprites.md) | createSprites; world and screen size modes; atlases. |
| [Points](api/points.md) | createPoints; size attenuation; textures. |
| [Lines](api/lines.md) | createLines; strips, loops and pairs; pixel and world widths; dashes; lit lines. |
| [Draws from a vertex count](api/vertex-draws.md) | scene.createVertexDraw: a custom material and a vertex count with no mesh data, the vertex and instance index in the shader, a bounds sphere, and helpers that wrap positions around the camera. |

### Interaction

| Page | What it covers |
| --- | --- |
| [Input](api/input.md) | Pointer, keyboard, touch and gamepad; action maps; pointer events on objects. |
| [Raycasting and spatial queries](api/raycast.md) | raycast, raycastAny, raycastAll, raycastBatch, overlap queries, pointer events on objects. |
| [Labels that follow objects](api/ui.md) | ui.trackLabel in the sketch; engine.labels.bind on the page. |
| [Controls (@null3d/controls)](api/controls.md) | Orbit and map controls; fly and first-person controls, with pointer lock; drag, rotate and scale gizmos. |

### Rendering and quality

| Page | What it covers |
| --- | --- |
| [Post-processing API](api/post.md) | post.set for tone mapping, exposure and a camera's EV100, automatic exposure, bloom, ambient occlusion, screen-space reflections, depth of field, outlines, color grading tables and controls, the vignette and sharpening; custom effects with post.addEffect, custom tone curves, and still views. |
| [Render graph API](api/render.md) | render.addPass for scene passes, reflection passes, full-screen passes and compute passes of your own WGSL that write into textures; half and quarter render sizes; the outline mask as an input; switching and removing passes; render.dumpGraph. |
| [Quality API](api/quality.md) | quality.preset, quality.set, quality.setPreset, the preset check, the frame-budget governor, budgets for a sketch's own systems, quality events. |
| [Debug drawing and stats](api/debug.md) | debug.line, box, sphere, arrow, axes, grid, frustum, light and skeleton; the stats overlay, debug.frameStats and @null3d/engine/stats; engine.measure and its figures; debug.view, the ?view switch and add-on views; debug.shadowCamera; the in-page inspector and engine.inspect. |

### Utilities

| Page | What it covers |
| --- | --- |
| [Time](api/time.md) | dt, time.now, fixed steps. |
| [Math helpers](api/math.md) | vec3, quat, mat4 and color on plain arrays; math.clamp, lerp, damp and a random generator that hold mode seeds; the maths entry and createMath for a deterministic simulation. |

### Add-on packages

| Page | What it covers |
| --- | --- |
| [Particles (@null3d/particles)](api/particles.md) | createParticles: emitters, bursts and sub-emitters; closed-form GPU motion; soft particles; flipbooks made in code. |
| [Impostors (@null3d/impostors)](api/impostors.md) | createImpostors: far objects as camera-facing cards that blend the three stored views nearest the camera and light from baked normals; mergeFarGeometry: one mesh per far grid cell. |
| [Terrain (@null3d/terrain)](api/terrain.md) | createTerrain: a height field drawn as a camera-centered quadtree of blocks, lit per pixel from baked normals, with a height-blended splat surface, and heightAt and normalAt for placing objects. |
| [Grass (@null3d/grass)](api/grass.md) | createGrass: tufts of bent blades over a ground, placed by integer hashes, built in a compute pass on WebGPU with the sun's shadows, swaying in the wind add-on's field, with a share for each quality preset. |
| [Gaussian splats (@null3d/splats)](api/splats.md) | createSplats: SPZ files, streamed chunk files and KHR_gaussian_splatting models drawn as Gaussian splats, with detail levels, a budget that follows the preset and the GPU path, and a soft mix with meshes. |
| [Water (@null3d/water)](api/water.md) | createWater: a river and a lake from one shape, with waves that the current carries, ripples, caustics, foam, rain rings, a soft shore that reads the scene's depth or the shape's bed, a reflection whose cadence follows the preset, and createUnderwater for the view from below the surface. createWaterfall: a fall from a river's lip, with spray and mist. createOcean: an open sea of spectra transformed on the GPU. |
| [Wind (@null3d/wind)](api/wind.md) | createWind: one field of air that plants, flags, smoke and water read, from an analytic wind of place and time with traveling gusts and pushes, held in a grid that follows the camera. |
| [Sound (@null3d/sound)](api/sound.md) | createSound and connectSound: loops, groups and one-shots placed in the scene, played with the browser's audio and driven from the sketch on the audio thread. |
| [three.js looks (@null3d/three-compat)](api/three-compat.md) | Reinhard and Cineon tone curves for post.set, and an outline with three.js OutlinePass's glow, pulse and blurred edge. It runs no three.js code. |

### Building add-ons

| Page | What it covers |
| --- | --- |
| [Add-on feature descriptions](api/features.md) | One description for an add-on's render work: the frame point, the reads and writes, the callbacks, the outputs with neutral defaults, the lighting slots, the order band and the view mask. |
| [Add-on feature draws](api/feature-draws.md) | scene.addFeatureDraw turns a draw feature description into a draw of your WGSL, your vertices, your uniforms and the description's sort place, on both GPU paths and in every thread mode; scene.addFeatureInstances repeats that shape once for each row of a batch. |
| [Add-on feature effects](api/feature-effects.md) | post.addFeatureEffect turns a full-screen feature description into a pass of your WGSL over the scene's color, at the resolve point, on both GPU paths and in every thread mode, and draws it only while the feature is ready. |
| [Add-on instance draws](api/feature-instances.md) | scene.addComputeInstances draws a capacity of instances from your own buffer, with a count that the GPU writes, on WebGPU, and an instance batch that the CPU fills on WebGL2. |
| [Tasks on the job workers](api/tasks.md) | runTask: an add-on's code and WebAssembly on the job workers; shared memory; ordering with the frames; failures. |

## Command-line tool

| Page | What it covers |
| --- | --- |
| [The `null3d` command](cli/null3d.md) | create, test, bench, check-addon, shot, upgrade, assets, mcp, shaders record. |

## Errors

| Page | What it covers |
| --- | --- |
| [Error codes](errors/index.md) | Every EngineError code with its cause and fix. |
