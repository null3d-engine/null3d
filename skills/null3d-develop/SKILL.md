---
name: null3d-develop
description: Build, extend, debug and speed up 3D web experiences made with the null3D engine (also written null3d, Null3D or null 3d), such as games, product viewers, configurators, product and marketing pages, data visualizations and interactive scenes. Use this skill whenever a task touches a null3D project or the @null3d packages, even for short requests like add a spinning cube, load this model, soften the shadows, click to select units, add a water shader, or why is it slow on my phone. Also use it to start a new null3D project, to write WGSL materials, post effects or render passes for null3D, and to test or profile null3D scenes. To convert existing three.js or React Three Fiber code, use the null3d-port-threejs skill instead.
compatibility: Needs Node.js 20 or newer and a null3D project. The engine docs ship inside the engine package, so their version always matches the installed engine.
metadata:
  skill-version: 0.1.0
  engine-versions: "0.1"
---

# Building with null3D

null3D is a browser 3D engine with a Rust core compiled to WebAssembly. Sketch code runs in a worker, the engine draws from another worker, and scene data lives in shared typed arrays. It renders with WebGPU where the browser has it and with WebGL2 elsewhere, from the same sketch code. Most mistakes come from writing null3D as if it were three.js, and the sections below exist to prevent that.

## 1. Find the docs that match the installed engine

The engine docs are the source of truth. This skill describes engine 0.1, and names the version of each later part it mentions. A project may use another version, so check before you rely on anything here.

1. Find the engine version: `bunx @null3d/cli --version`, or the `@null3d/engine` entry in `package.json`.
2. Read docs pages by ID, in this order:
   - inside the null3D repository itself: `docs/<id>.md`;
   - in a null3D project: `node_modules/@null3d/engine/docs/<id>.md`;
   - from any terminal (0.3): `bunx @null3d/cli docs show <id>`, or `bunx @null3d/cli docs search "<words>"`.
3. Each page starts with front matter. `status: stable` or `status: experimental` means the API exists (experimental APIs may still change). `status: planned` means it does not exist in this version. The note under an experimental page's title can name parts that are not built yet: treat those parts as planned too. Do not call a planned API; tell the user, and use the workaround the page gives.
4. If the docs and this skill disagree, follow the docs and mention the difference in your summary, so the skill can be fixed.

Doc IDs appear in backticks throughout, for example `concepts/architecture`. Version numbers in parentheses, such as (0.2), give the first engine version with that API; no number means 0.1.

## 2. The model

In null3D, a 3D scene is called a sketch: the module in `sketch.ts` that builds the scene with `defineSketch` and updates it every frame.

```
page.ts (main thread)        sketch.ts (sketch worker)          render worker
---------------------        -------------------------          -------------
HTML, CSS, UI, audio   -->   input, onUpdate, scene changes -->  GPU uploads and drawing
creates the engine           shared typed arrays                 never runs your code
```

- `page.ts` runs on the main thread. It creates the engine and owns the DOM, HTML UI and Web Audio. `sketch.ts` runs in the sketch worker: scene setup and per-frame logic. The sketch worker has no `document` and no `window`. `createEngine({ sketchThread: 'main' })` runs the sketch on the main thread instead, where it can reach the DOM. Use it only for DOM-heavy apps and for debugging, because the sketch's frames then share the main thread with the page. The two sides talk with `engine.postToSketch` and `page.onMessage`, and with `page.post` and `engine.onSketchMessage`. (`concepts/architecture`, `api/page`)
- Scene objects are small wrappers around 30-bit integer handles. Change them with setters such as `setPosition`; never assign properties like `mesh.position.x = 1`. (`concepts/handles`, `api/objects`)
- For many objects, write typed arrays directly: instance batches and dynamic objects. This is where null3D gets its speed. (`concepts/instances`)
- Objects are static by default: they cost nothing per frame until a setter changes them. Objects created with `dynamic: true` are recomputed every frame and may be written through arrays. (`concepts/static-dynamic`)
- The engine renders every frame by itself. Sketch code has no render call and no `requestAnimationFrame`; per-frame logic goes in `onUpdate(dt)`.
- The same code runs on WebGPU and WebGL2. When a feature is optional, check `engine.capabilities` on the page, which sends the sketch what it needs; never check browser or GPU names. (`concepts/backends`)

A complete minimal project:

```ts
// page.ts (main thread)
import { createEngine } from '@null3d/engine';

await createEngine({
  canvas: document.querySelector('canvas')!,
  sketch: new URL('./sketch.ts', import.meta.url),
});
```

```ts
// sketch.ts (sketch worker)
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
  const camera = scene.createPerspectiveCamera({ fov: 60, position: [0, 1.5, 4], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });

  const cube = scene.createMesh({
    mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
    material: materials.standard({ color: '#4a8cff' }),
    dynamic: true, // it moves every frame
  });

  return {
    onUpdate(dt) {
      cube.rotateY(dt * 0.8);
    },
  };
});
```

## 3. Workflow for every task

1. Pin down the target when the request leaves it open: which devices (phones or desktop), which frame rate, and whether the WebGL2 path matters. Phones usually matter, so assume they do unless told otherwise.
2. Read the doc pages for the features involved (section 1).
3. Make the change in small steps. Scene logic goes in `sketch.ts`; DOM, HTML UI and audio go in `page.ts`.
4. Look at the result. `bunx vite` serves the project, and the null3D Vite plugin adds the right headers. `bunx @null3d/cli shot --out shot.png` renders one frame headless and saves it. Open the image and check it: code that compiles can still draw nothing.
5. Check the cost with `bunx @null3d/cli bench`, or with `await engine.measure(5)` on the page while it runs. Compare the frame phases with the preset's budget (`references/performance.md`).
6. Add or update a test. Anything visual gets a hold-mode image test, listed in `null3d.json` (`references/testing-and-debugging.md`). Run `bunx @null3d/cli test`, and open the images of each test that fails.
7. If the change touches rendering, check the WebGL2 path: add `?gpu=webgl2` to the dev URL, or run `bunx @null3d/cli test --gpu webgl2`.
8. Summarize what changed, how you verified it (images, numbers), and any limits: planned APIs you avoided, device classes you could not test.

## 4. Rules that keep null3D fast

Each rule comes with its reason, because the reason covers cases the rule does not name.

1. Allocate nothing in `onUpdate`, `onFixedUpdate` or `onLateUpdate`: no `new`, no array or object literals, no closures, no `map` or `filter`. Create scratch values once at setup, such as `const tmp = vec3.create()`. Garbage collection pauses the sketch worker, and users see the pause as a stutter.
2. Use an instance batch for many copies of one mesh. A batch is one engine object and one typed array for you, where the same number of `createMesh` calls means as many objects to manage. (`concepts/instances`)
3. Move many objects by writing arrays, not by calling setters in a loop. Each setter call crosses from JavaScript into WebAssembly; a typed-array write does not cross at all.
4. Create an object with `dynamic: true` only if it changes most frames. Static objects cost nothing until changed, and dynamic ones are recomputed every frame. Only dynamic objects and batches may be written through arrays, because static objects rely on setters to mark them changed.
5. Create and destroy in bulk, and pool short-lived objects such as bullets: make a batch with a fixed capacity and use `setActiveCount`. A frame with a structural change (create, destroy, a new mesh or material) rebuilds the draw tables; `setVisible` and `setActiveCount` do not. The engine sizes its memory for the scene it holds, so create meshes, materials and batches during setup. One created during play makes engine memory grow in the next frame.
6. Load and warm up before play: `await assets.preload([...])` and `await scene.warmUp()` behind a loading screen. A new shading model, vertex format or shader feature, such as a normal map, needs a new pipeline. The first frame waits for its pipelines. During play, an object whose pipeline is still building draws nothing, or the frame waits in browsers that cannot build in the background. Shader features are fixed when you create a material, so create every variant before play. For a later stage, create its objects hidden, await `scene.warmUp()`, then show them. (`guides/loading-screens`)
7. Keep the DOM on the page, and keep messages rare: send events, not per-frame state. Labels that follow objects use `ui.trackLabel` (0.2), which needs no messages. (`guides/ui-overlays`)
8. Use layer masks to limit work. A camera with a mask draws fewer objects, and a raycast (0.2) with a mask tests fewer. (`concepts/render-layers`)
9. Respect the quality preset. Do not force a heavier preset on phones. When frames run long, the engine's governor lowers the render scale, then the shadow settings, by itself. Keep your own values per preset, such as particle counts or AI update rates, in one table keyed by `quality.preset`. Never check the device type yourself, and listen to `quality.onChange` to apply the values. (`concepts/quality-presets`)
10. Ship optimized assets: KTX2 textures, which stay compressed on the GPU, and glTF models with integer vertices (0.2). Encode KTX2 files with `basisu`. From 0.2, `bunx @null3d/cli assets optimize <in> <out>` makes both, or a `?optimized` import of a `.glb` file through the Vite plugin. It compresses the models with meshopt, which the engine decodes on load. It gives each mesh that encloses space a checked blocker for WebGL2's occlusion culling. It stores raycast trees for mesh parts of at least `--bvh` triangles, 20,000 by default. Large PNG files and float meshes cost download time and GPU memory. (`api/textures`, `guides/assets-pipeline`)
11. Keep custom WGSL portable. Use only the three language features every browser shares, and write flat interpolation as `@interpolate(flat, either)`. The build rejects other features, `enable` lines and `f16`, but it cannot check the portable limits or `textureSample` in branches. Test those on each GPU path. (`shaders/wgsl-rules`)
12. Never branch on GPU names or user agents; read `engine.capabilities` on the page. Several browsers hide GPU names, and a name does not tell you what the engine enabled.

## 5. Choosing the right tool

Drawing:

| Situation | Use | Docs |
| --- | --- | --- |
| A few distinct objects | `scene.createMesh` | `api/scene` |
| A loaded model, once or many times | `assets.loadGltf`, then `scene.instantiate` (0.2) | `api/assets` |
| Hundreds to millions of copies of one mesh | `scene.createInstances` with typed arrays | `concepts/instances` |
| Objects that move every frame | `dynamic: true`, or a dynamic batch | `concepts/static-dynamic` |
| Less detail far away | `scene.createLod`, or LODs from `bunx @null3d/cli assets optimize --lod` (0.2) | `concepts/lod` |
| Camera-facing quads and simple particles | `scene.createSprites` (0.2) | `api/sprites` |
| Point clouds | `scene.createPoints` (0.2) | `api/points` |
| Lines with pixel or world widths | `scene.createLines` (0.2) | `api/lines` |
| Shapes for debugging only | `debug.line`, `debug.box`, `debug.axes` | `api/debug` |

Materials:

| Need | Use | Docs |
| --- | --- | --- |
| Lit surfaces, which is most things | `materials.standard` | `api/materials` |
| Flat color or texture without lighting | `materials.unlit` | `api/materials` |
| A ground plane that only shows shadows | `materials.shadowCatcher` (0.2) | `api/materials` |
| A custom look that still gets lights, shadows and fog | `materials.shader({ wgsl })` with `fn surface` in the WGSL | `shaders/surface-functions` |
| A fully custom effect, such as a hologram | `materials.shader({ wgsl })` with a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one | `guides/custom-shaders` |

Lighting and shadows: surfaces show one directional light, the ambient lights, and point and spot lights through clustered lighting. Hemisphere lights light surfaces from 0.2; until then, use an ambient light for fill. One directional light with shadows covers most outdoor scenes. Point and spot lights are cheap without shadows, because lighting is clustered. A spot light with shadows takes a tile of the shadow atlas, and a point light six, on High and Ultra only. A tile draws again only when its light or a caster in its range moves. Shadow quality follows the preset. Environment maps come in 0.2. (`api/lights`, `concepts/lighting`, `concepts/shadows`)

Interaction:

| Need | Use | Docs |
| --- | --- | --- |
| Orbit or map camera | `createOrbitControls` or `createMapControls` from `@null3d/controls` | `api/controls` |
| Fly or first-person camera | `createFlyControls` or `createFirstPersonControls` (0.2) | `api/controls` |
| Click or hover on objects | `obj.on('click', fn)` and `'pointerenter'` or `'pointerleave'`, or `camera.screenToRay` with `scene.raycast` (all 0.2) | `api/raycast` |
| Keys, pointer, touch, gamepad | `input.isDown`, `input.wasPressed`, `input.value`, `input.pointer`, `input.touches`, `input.actions.define` | `api/input` |
| HTML UI and settings panels | On the page, sending messages to the sketch | `guides/ui-overlays` |
| Labels above objects | `ui.trackLabel` in the sketch, `engine.labels.bind` on the page (0.2) | `api/ui` |
| A product or marketing page with a 3D scene | Fallback page first, a load deadline, reveal on `engine.firstFrame`, pause off screen | `guides/content-pages`, `references/content-pages.md` |
| Accessibility and reduced motion | Meaning in HTML around the canvas; `preferences.reducedMotion` brings decorative motion to rest | `guides/accessibility` |

Effects:

| Need | Use | Docs |
| --- | --- | --- |
| Tone mapping and exposure | `post.set({ toneMapping, exposure })` | `api/post` |
| Bloom | `post.set({ bloom: { strength, radius, threshold } })` (0.2) | `api/post`, `concepts/post-processing` |
| Color grading from a `.cube` or `.3dl` file, and a vignette | `post.set({ lut: await assets.loadLut(url), vignette: { offset, darkness } })` (0.2) | `api/post`, `api/assets` |
| Ambient occlusion, outlines | `post.set({ ... })` (0.2) | `api/post` |
| A custom full-screen effect | `post.addEffect({ name, wgsl, uniforms })` (0.2) | `api/post` |
| Render to a texture, or add a pass | `render.addPass({ ... })` (0.2) | `guides/custom-passes` |
| Fog or sky | `scene.setFog` with the fog's color in `scene.setBackground`; `scene.setBackground({ sky })` (0.2) | `api/scene` |

## 6. Custom shaders in brief

Prefer surface functions. You describe the surface; the engine adds lighting, shadows, fog and instancing, on both backends. The material's WGSL goes in one `wgsl` option, tagged so the Vite plugin compiles it, and the material takes every `materials.standard` option.

```ts
const rings = materials.shader({
  color: '#e04040', roughness: 0.5,
  wgsl: /* wgsl */ `
    fn surface(input: SurfaceInput) -> Surface {
      var s = defaultSurface(input);
      let ring = step(0.5, fract(input.uv.y * 6.0));
      s.baseColor = mix(s.baseColor, vec3f(1.0), ring);
      return s;
    }`,
});
rings.set({ roughness: 0.2 }); // the standard values, which defaultSurface reads
```

`references/shaders.md` has the full contract: every field of `SurfaceInput` and `Surface`, uniforms (`struct Uniforms` in the WGSL, read from `material`), the names to avoid, and the WGSL rules. Vertex offsets (`fn vertexOffset` in the same WGSL) and the built-in values (`frame.time`, `camera.position`, `object.position`) are built too. So are full shaders (`guides/custom-shaders`), and textures (0.2): `var name: texture_2d<f32>;` in the WGSL and the `textures` option.

## 7. When something goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Blank canvas; the console mentions `SharedArrayBuffer` or `crossOriginIsolated` | The page is not cross-origin isolated | Add the null3D Vite plugin to `vite.config.ts`, or set the COOP and COEP headers on the host (`getting-started/hosting`) |
| An object does not move, or a development build logs E1110 | A static object changed without a setter | Use the setter, or create it with `dynamic: true` |
| Colors too dark or washed out | Wrong texture color space | `colorSpace: 'srgb'` for color maps, `'linear'` for data maps (`concepts/color-management`) |
| A stutter every few seconds | Allocations in per-frame code | Scratch values created once; confirm with the browser's memory profiler |
| Something appears a moment late, or a hitch when it first appears | Its pipeline was building during play | Create it hidden, `await scene.warmUp()`, then show it (`guides/loading-screens`) |
| Fine on desktop, slow or crashing on a phone | Preset, pixel ratio or memory | `guides/phones`, `references/performance.md` |
| An `EngineError` with a code | An invalid call | Read the fix in the message, then the docs page `errors/<code>` (section 1) |

The full table and the debugging tools are in `references/testing-and-debugging.md`.

## 8. References in this skill

Read these when the task needs them:

- `references/api-quickref.md`: the API by area, with the version that adds each part and the doc ID to read. Read it before using an API for the first time in a session.
- `references/recipes.md`: patterns for common tasks. They include camera controls, animated models, thousands of moving objects, pooling, picking, labels, loading screens, HTML UI, physics, video, custom effects and large worlds.
- `references/performance.md`: budgets, how to measure, symptom-to-fix tables and phone rules.
- `references/shaders.md`: the surface-function contract, built-in values, uniforms and textures, portable WGSL rules, custom post effects and custom passes.
- `references/testing-and-debugging.md`: `bunx @null3d/cli test`, image tests, testing on devices, the MCP server tools (0.3), error codes and a full troubleshooting table.
- `references/content-pages.md`: product and marketing pages with a 3D scene: the fallback page, a load deadline, pausing, scroll-driven cameras, caching and crashes.

## 9. Before you finish

- The code uses only APIs whose docs status is `stable` or `experimental` in the installed engine.
- The code uses no part that a page's note says is not built yet.
- Per-frame callbacks allocate nothing.
- DOM, audio and HTML UI code is in `page.ts`.
- You looked at a rendered image, from `bunx @null3d/cli shot` or the dev server, and not only at build output.
- `bunx @null3d/cli test` passes, including a new or updated image test for visual changes.
- For rendering changes, the WebGL2 path renders too.
- Performance was checked against the preset budget for the target devices.
- Your summary says what you verified, and what you could not verify.
- Before a release, also work through "Before you ship" in `references/testing-and-debugging.md`.
