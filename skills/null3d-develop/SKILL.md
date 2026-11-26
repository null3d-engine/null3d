---
name: null3d-develop
description: Build, extend, debug and speed up 3D web experiences made with the null3D engine (also written null3d, Null3D or null 3d), such as games, product viewers, configurators, product and marketing pages, data visualizations and interactive scenes. Use this skill whenever a task touches a null3D project or the @null3d packages, even for short requests like add a spinning cube, load this model, soften the shadows, click to select units, add a water shader, why is it slow on my phone, or make it load faster. Also use it to start a new null3D project, to write WGSL materials, post effects or render passes for null3D, and to test or profile null3D scenes. To convert existing three.js or React Three Fiber code, use the null3d-port-threejs skill instead.
compatibility: Needs Node.js 20.19 or a later 20 release, or Node.js 22.12 or newer, and a null3D project. The engine docs ship inside the engine package, so their version always matches the installed engine.
metadata:
  skill-version: 0.1.0
  engine-versions: "0.1"
---

# Building with null3D

null3D is a high-performance browser 3D engine with a Rust core compiled to WebAssembly. Sketch code runs in a worker, the engine draws from another worker, and scene data lives in shared typed arrays. It renders with WebGPU where the browser has it and with WebGL2 elsewhere, from the same sketch code. Most mistakes come from writing null3D as if it were three.js.

## 1. Find the docs that match the installed engine

The engine docs are the source of truth. This skill describes null3D 0.1.0. A project may use another version: check it first.

1. Find the engine version: `bunx @null3d/cli --version`, or the `@null3d/engine` entry in `package.json`.
2. Read docs pages by ID, in this order:
   - inside the null3D repository itself: `docs/<id>.md`;
   - in a null3D project: `node_modules/@null3d/engine/docs/<id>.md`.
3. Use only the APIs that the installed engine's docs and type declarations show. A name that is absent there does not exist, so do not invent it. A page also names the limits of its feature. When a limit affects the task, tell the user and use the workaround that the page gives.
4. If the docs and this skill disagree, follow the docs and report the difference, so the skill can be fixed.

Doc IDs appear in backticks, for example `concepts/architecture`.

## 2. The model

In null3D, a 3D scene is a sketch: the `sketch.ts` module that builds it with `defineSketch` and updates it every frame.

```
page.ts (main thread)        sketch.ts (sketch worker)          render worker
---------------------        -------------------------          -------------
HTML, CSS, UI, audio   -->   input, onUpdate, scene changes -->  GPU uploads and drawing
creates the engine           shared typed arrays                 never runs your code
```

- `page.ts` owns the DOM, HTML UI and Web Audio. `sketch.ts` has no `document` and no `window`. `createEngine({ sketchThread: 'main' })` runs the sketch on the main thread, where it can reach the DOM. Use it only for DOM-heavy apps and debugging: its frames share the page thread. The two sides talk with `engine.postToSketch` and `page.onMessage`, and with `page.post` and `engine.onSketchMessage`. (`concepts/architecture`, `api/page`)
- Scene objects are small wrappers around 30-bit integer handles. Change them with setters such as `setPosition`; never assign properties like `mesh.position.x = 1`. (`concepts/handles`, `api/objects`)
- For many objects, write typed arrays directly: instance batches and dynamic objects, where null3D gets its speed. (`concepts/instances`)
- Objects are static by default: they cost nothing per frame until a setter changes them. Objects with `dynamic: true` are recomputed every frame and may be written through arrays. (`concepts/static-dynamic`)
- The engine renders every frame. Sketch code has no render call and no `requestAnimationFrame`; per-frame logic goes in `onUpdate(dt)`.
- The same code runs on WebGPU and WebGL2. The page's `engine.capabilities` reports optional features; never check browser or GPU names. (`concepts/backends`)

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

1. Pin down the target when the request leaves it open: devices, frame rate and the WebGL2 path. Assume phones matter unless told otherwise.
2. Read the doc pages for the features involved (section 1).
3. Make the change in small steps. Scene logic and the scene's sounds go in `sketch.ts`; DOM, HTML UI and the audio's start go in `page.ts`.
4. Look at the result. `bunx vite` serves the project, and the null3D Vite plugin adds the right headers. `bunx @null3d/cli shot --out shot.png` renders one frame headless. Open the image: code that compiles can still draw nothing. Read `references/testing-and-debugging.md` before trusting a picture. Its section 6 covers `?inspect` and `bunx @null3d/cli mcp` for a running scene.
5. Check the cost of a production build with `bunx @null3d/cli bench`, or `await engine.measure(5)` on it. Compare the frame phases with the preset's budget (`references/performance.md`).
6. Add or update a test. Anything visual gets a hold-mode image test in `null3d.json` (`references/testing-and-debugging.md`). Run `bunx @null3d/cli test`, and open each failed image. An app or a game also gets a browser suite that drives the real page (`references/e2e-testing.md`).
7. If the change touches rendering, check the WebGL2 path: add `?gpu=webgl2` to the dev URL, or run `bunx @null3d/cli test --gpu webgl2`.
8. Summarize what changed, how you verified it (images, numbers), and the limits: the engine limits that you worked around, and the devices not tested.

## 4. Rules that keep null3D fast

Each rule gives its reason, which covers cases the rule does not name.

1. Allocate nothing in `onUpdate`, `onFixedUpdate` or `onLateUpdate`: no `new`, no array or object literals, no closures, no `map` or `filter`. Create scratch values at setup, such as `const tmp = vec3.create()`. A garbage collection pause stalls the frame.
2. Use an instance batch for many copies of one mesh: one engine object and one typed array, where `createMesh` calls would mean many objects. (`concepts/instances`)
3. Move many objects by writing arrays, not by setters in a loop: each setter crosses into WebAssembly, a typed-array write does not.
4. Create `dynamic: true` objects only for what changes most frames; write arrays for those and batches.
5. Pool short-lived objects such as bullets in a batch with a fixed capacity and `setActiveCount`. A structural change (create, destroy, a new mesh or material) rebuilds the draw tables; `setVisible` and `setActiveCount` do not. Create meshes, materials and batches at setup, since the engine sizes memory for what the scene holds.
6. Before play, list the first view's files in `defineSketch`'s `downloads`, start the rest after the first frame, and `await scene.warmUp()` behind a loading screen. A material's shader features, such as a normal map, are fixed at its creation. The first frame waits for its pipeline, so create every variant before play. (`guides/loading-screens`, `guides/start-time`)
7. Keep the DOM on the page and messages rare: send events, not per-frame state. Labels that follow objects use `ui.trackLabel`, which needs no messages. (`guides/ui-overlays`)
8. Use layer masks to limit work. A camera with a mask draws fewer objects, and a raycast with a mask tests fewer. (`concepts/render-layers`)
9. Respect the quality preset. Do not force a heavier preset on phones. When frames run long, the governor lowers a sketch's budgets and the render scale, then the shadow and effect settings once the scale floors, by itself. Keep your own values per preset, such as particle counts or AI update rates, in one table keyed by `quality.preset`, and apply them in `quality.onChange`. (`concepts/quality-presets`)
10. Ship optimized assets: KTX2 textures, compressed on the GPU, and glTF models with integer vertices. `bunx @null3d/cli assets optimize <in> <out>` makes both, or a `?optimized` import of a `.glb` through the Vite plugin. It compresses with meshopt, stores raycast trees, and bakes normal detail into the roughness mips so far surfaces do not flicker. It records each model's shader features, so the engine builds only the pipelines it draws. The decoders load with the first file that needs them: set no decoder path and copy no worker file. (`api/textures`, `guides/assets-pipeline`, `concepts/assets`)
11. Keep custom WGSL portable: only the three language features every browser shares, and flat interpolation as `@interpolate(flat, either)`. The build rejects other features, `enable` lines and `f16`, but cannot check the portable limits or `textureSample` in branches. Test those on each GPU path. (`shaders/wgsl-rules`)
12. Never branch on GPU names or user agents; read `engine.capabilities`. A name does not say what is enabled; `capabilities.drawPath` says why the direct path is on or off.
13. Put performance-sensitive work in Rust, where the engine's per-frame loops run; your TypeScript is an interface to it. Use bulk calls over many objects. For a loop that grows with the scene, use a Rust WebAssembly module on the job workers through `runTask`; a task answers between frames, so a loop for the current frame belongs in the engine's calls. Keep setup, wiring and page logic in TypeScript. (`guides/performance`, `api/tasks`)
14. Night scenes: make the sky's stand-in light follow the hour. A fixed ambient or hemisphere light lights sand and walls as bright at night as at noon. Scale and cool it; set exposure at the hour shown longest. (`concepts/lighting`)
15. A far card must read as its mesh: bake its views (five by five or more), unlit sRGB, a normal per texel, check a matched crop. One side view serves only cards of a few tens of pixels. (`api/impostors`)

## 5. When a request names no engine feature

A request may name an effect and no engine feature. Find how to build it before you design the scene. The user brings three things:

- What they want to see on screen, with a reference picture or the effect in another engine.
- The devices and browsers it must run on, such as a mid-range Android phone.
- The cost it may take, in milliseconds per frame or lowest frame rate.

1. Search first: the docs page (section 1), `references/api-quickref.md`, then the add-on table in section 6.
2. Use only the calls that the docs and the type declarations show. Never invent a call or an option. When the page names a limit that the request meets, tell the user and use the page's workaround.
3. If no page covers the need, build it above the public API: a custom material, vertex offset, post effect or render pass. Keep that code in the project; never imitate engine API, which breaks on the next update.
4. Never write a second version of a feature in the add-on table. A hand-rolled copy gets no fixes.
5. Say in your summary what the engine does not do, what you used instead, and which code lives in the project. A silent workaround reads as the real feature.

## 6. Choosing the right tool

### Search before you hand-roll

Check this table before you write a generator, control, effect or loader. Each add-on is the one place that feature lives, with both GPU paths and fixes from the engine.

| Need | Use | Docs |
| --- | --- | --- |
| Orbit, map, fly or first-person cameras, and drag, rotate or scale handles | `@null3d/controls` | `api/controls` |
| Torus knots, polyhedra, lathes, extrusions and tubes | `@null3d/geometry` | `api/geometry` |
| Far objects as camera-facing cards, or one mesh per far grid cell | `@null3d/impostors` | `api/impostors` |
| Fire, smoke, sparks, rain and other particle effects | `@null3d/particles` | `api/particles` |
| Gaussian splats from SPZ or `KHR_gaussian_splatting` files | `@null3d/splats` | `api/splats` |
| Hills, valleys and other ground from a height field | `@null3d/terrain` | `api/terrain` |
| Grass that sways in the wind | `@null3d/grass` | `api/grass` |
| Rigid bodies, joints and character movement | Rapier or cannon-es, run in the sketch worker; null3D has no physics API | `guides/physics` (recipe 11) |
| Text in the scene | HTML labels with `ui.trackLabel`, a text texture, or a text mesh baked into glTF; null3D draws no text of its own | `api/ui` |
| A river, a lake or a waterfall, with waves, foam, soft shores and a surface seen from below | `@null3d/water` | `api/water` |
| An open sea whose waves come from GPU-transformed spectra | `@null3d/water` | `api/water` |
| Trees that sway in the wind | a glTF or code-made mesh, with a material that reads `@null3d/wind`'s field | `api/wind` (recipe 24) |
| Wind that plants, flags and smoke read, with travelling gusts and pushes | `@null3d/wind` | `api/wind` |
| Sound placed in the scene, from a sea bed to a street of cars | `@null3d/sound` | `api/sound` |
| three.js look modes for a port: Reinhard and Cineon tone curves, and a soft outline with a glow and a pulse | `@null3d/three-compat` | `api/three-compat` |

Drawing:

| Situation | Use | Docs |
| --- | --- | --- |
| A few distinct objects | `scene.createMesh` | `api/scene` |
| A loaded model, once or many times | `assets.loadGltf`, then `scene.instantiate` | `api/assets` |
| Hundreds to millions of copies of one mesh | `scene.createInstances` with typed arrays | `concepts/instances` |
| Objects that move every frame | `dynamic: true`, or a dynamic batch | `concepts/static-dynamic` |
| Less detail far away | Code meshes, an add-on's too, plan levels themselves (`levels: false` opts out); `mesh.setLevels` by hand; `assets optimize --lod` for files | `concepts/lod`, `guides/add-ons` |
| A large static mesh, detailed near and coarse far | `assets optimize --clusters`: a tree of patches for a mesh that draws once, on both GPU paths | `concepts/lod` |
| Camera-facing quads that the sketch moves itself | `scene.createSprites` | `api/sprites` |
| Point clouds | `scene.createPoints` | `api/points` |
| Lines with pixel or world widths | `scene.createLines` | `api/lines` |
| Shapes for debugging only | `debug.line`, `debug.box`, `debug.axes` | `api/debug` |

Materials:

| Need | Use | Docs |
| --- | --- | --- |
| Lit surfaces, which is most things | `materials.standard` | `api/materials` |
| Flat color or texture without lighting | `materials.unlit` | `api/materials` |
| A ground plane that only shows shadows | `materials.shadowCatcher` | `api/materials` |
| A sharp shadow on one subject, such as a car in a showroom | `sun.setShadow({ hero: mesh })`, with the mesh's `castShadows` on | `concepts/shadows` |
| A custom look that still gets lights, shadows and fog | `materials.shader({ wgsl })` with `fn surface` in the WGSL | `shaders/surface-functions` |
| A fully custom effect, such as a hologram | `materials.shader({ wgsl })` with a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one | `guides/custom-shaders` |

Lighting and shadows: surfaces take up to four directional lights (the first casts the shadows), the ambient and hemisphere lights, and clustered point and spot lights. A shadowed directional light covers most outdoor scenes, and its layers choose the casters. Hemisphere light is cheap fill. Point and spot lights cost little unshadowed. Rectangle and tube lights show their shape in highlights, at several times a point light's cost. Contact shadows ground small objects on High and Ultra, and WebGL2's Medium. An environment gives standard materials reflections and soft diffuse light. Set it up before play: the GPU filters the whole map in one frame. The sky lights outdoor scenes. The physical atmosphere hazes distant land blue. Indoors, give each room its own reflection probe. (`api/lights`, `concepts/lighting`, `concepts/shadows`; every option and default is in `references/api-quickref.md` section 7.)

Interaction:

| Need | Use | Docs |
| --- | --- | --- |
| Click or hover on objects | `obj.on('click', fn)` and `'pointerenter'` or `'pointerleave'`, or `camera.screenToRay` with `scene.raycast` | `api/input`, `api/raycast` |
| Keys, pointer, touch, gamepad | `input.isDown`, `input.wasPressed`, `input.value`, `input.pointer`, `input.touches`, `input.actions.define` | `api/input` |
| Rules a server replays | `@null3d/engine/math`, `createMath`, `input: false` | `guides/deterministic-simulation` |
| HTML UI and settings panels | On the page, sending messages to the sketch | `guides/ui-overlays` |
| Labels above objects | `ui.trackLabel` in the sketch, `engine.labels.bind` on the page | `api/ui` |
| A product or marketing page with a 3D scene | Fallback page first, a load deadline, reveal on `engine.firstFrame`, pause off screen | `guides/content-pages`, `references/content-pages.md` |
| Accessibility and reduced motion | Meaning in HTML around the canvas; `preferences.reducedMotion` brings decorative motion to rest | `guides/accessibility` |

Effects:

| Need | Use | Docs |
| --- | --- | --- |
| Tone mapping and exposure | `post.set({ toneMapping, exposure })`; `ev100` for lights in real units | `api/post` |
| A sign, panel or heads-up display that keeps its exact color | `materials.unlit({ color, toneMapped: false })`; on the HDR path a blended surface keeps the curve | `api/materials`, `concepts/color-management` |
| Bloom | `post.set({ bloom: { intensity, threshold, knee, blend, weights } })`; quality setting `bloomSize` | `api/post`, `concepts/post-processing` |
| Color grading from a `.cube` or `.3dl` file, and a vignette | `post.set({ lut: await assets.loadLut(url), vignette: { intensity, size } })` | `api/post`, `api/assets` |
| Color grading made in code, with no file | `post.set({ lut: await assets.lutFromData({ size, data }) })`: three numbers per texel, red fastest, as a `.cube` file | `api/assets` |
| Outlines around chosen meshes | `post.set({ outline: { color, width } })` and `mesh.setOutlined(true)` | `api/post`, `api/objects` |
| Ambient occlusion | `post.set({ ao: { radius, intensity } })`, with `quality.set({ aoScale: 0.5 })` on phones and tablets | `api/post`, `concepts/post-processing` |
| Wet streets, polished floors and metal that reflect the scene | `post.set({ ssr: { maxDistance, thickness } })` with smooth materials; `ssrScale` 0 on Low; an environment shows where rays miss. A flat mirror: a reflection pass | `api/post`, `concepts/post-processing` |
| Depth of field, a camera's lens | `camera.setFocalLength(mm)` and `post.set({ dof: { aperture, focusDistance or focusPoint } })`; quality setting `dofSamples`, 0 on Low | `api/post`, `api/cameras`, `concepts/post-processing` |
| An eye that adapts from bright to dark places, automatic exposure | `post.set({ autoExposure: { minEv, maxEv, speedUp, speedDown, compensation } })`, from the camera's `exposure` or `ev100`; quality setting `exposureMeter` | `api/post`, `concepts/post-processing` |
| Crisper edges and fine detail | `post.set({ sharpen })`, 0 to 1; 0.5 is a good start | `api/post` |
| A custom full-screen effect, a tone curve of your own, or a lens look of grain, fringes, a streak and a speed blur | `post.addEffect({ wgsl, uniforms, order })` or `post.set({ toneMapping: wgsl })`; the lens-kit example add-on for a look | `guides/custom-passes`, `guides/lens-kit` |
| Render to a texture: a minimap, a camera's screen | `render.addPass({ kind: 'scene', camera, writes, size })` and `textures.fromPass(pass)` | `api/render`, `guides/custom-passes` |
| Water, mirrors and polished floors that reflect the scene | `render.addPass({ kind: 'reflection', writes, plane: { point } })`, and a custom material that sets `s.reflection` | `api/render`, `shaders/surface-functions`, `guides/custom-passes` |
| Water waves, noise fields or any texture that a compute shader makes each frame | `render.addPass({ kind: 'compute', description, wgsl, format, values, fallback })` and `textures.fromPass(pass)`; WebGPU only, with the fallback fragment form on WebGL2 | `api/render`, `api/features` |
| Glass, gems and clear water that show what lies behind them, bent and blurred | `materials.standard({ transmission: 1, thickness, ior, roughness })`, or a custom material that sets `s.transmission` | `api/materials`, `shaders/surface-functions` |
| Leaves and paper lit from behind | `materials.standard({ diffuseTransmission })` | `api/materials` |
| Skin and wax whose light spreads under the surface | `materials.standard({ subsurfaceRadius })`, on High and Ultra | `api/materials` |
| Car paint, varnish, wet stone; velvet and cloth | `materials.standard({ clearcoat: 1, clearcoatRoughness })` or `{ sheenColor, sheenRoughness }`, or a custom material that sets `s.clearcoat` or `s.sheenColor` | `api/materials`, `shaders/surface-functions` |
| Soap bubbles, beetle shells; brushed metal | `materials.standard({ iridescence })` or `{ anisotropy }` | `api/materials`, `shaders/surface-functions` |
| Decals: scorch marks, mud, puddles, road paint, moss, cracks, posters | A mesh of `geometry.box()` with `materials.decal({ map, normalMap, metalnessRoughnessMap, angleFade, edgeFade })`; the box's z axis points out of the surfaces it marks; a batch of boxes for many | `api/materials` |
| Fog or sky | `scene.setFog` with the fog's color in `scene.setBackground`; `scene.setBackground({ sky })`; a physical sky that also hazes distant objects: `scene.setBackground({ atmosphere })` | `api/scene` |
| An aurora, a second layer of clouds, or a backdrop of space over the sky | `scene.setSkyLayer(description, { wgsl })` with a feature description at the `'background'` point and WGSL that declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`; it draws over the core sky on every path, reaches its map, and lights the scene | `api/scene` |
| Light shafts, rays through trees, glowing cones under lamps and headlights | `scene.setFog({ color, density, heightFalloff, volumetric: { intensity, anisotropy, distance } })`; quality setting `fogSlices`, 0 on Low, where the fog keeps its `sunGlow` | `api/scene`, `concepts/lighting` |
| Light from the sky, or a time of day | `scene.setEnvironment(await assets.skyEnvironment())`; `timeOfDay(hours)` values for the sky, the sun, the fog and the exposure | `concepts/lighting` |
| Reflections of a room or a street on floors and metal | `scene.createReflectionProbe({ box: { min, max }, position })`, one per room; `refresh: 'always'` for moving things | `api/scene` |

## 7. Custom shaders in brief

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

`references/shaders.md` has the full contract: every field of `SurfaceInput` and `Surface`, uniforms (`struct Uniforms` in the WGSL, read from `material`), the names to avoid, and the WGSL rules. Vertex offsets (`fn vertexOffset` in the same WGSL), a lobe that adds specular beside the base lobe for every directional, point and spot light (`fn lobe(input: LobeInput) -> vec3f`), and the built-in values (`frame`, `camera`, `object`) are built too. So are full shaders (`guides/custom-shaders`), and textures: `var name: texture_2d<f32>;` in the WGSL and the `textures` option.

## 8. When something goes wrong

Most faults come from a page that is not cross-origin isolated, an object changed without a setter, the wrong texture color space, allocations in per-frame code, or a pipeline built during play. `references/testing-and-debugging.md` section 8 pairs every symptom with its cause and fix. Section 7 lists the error codes, and section 9 is the release checklist. An `EngineError` names its fix, then the docs page `errors/<code>`. A browser test that passes on one machine and fails on another has a usual cause. It waits with a fixed sleep, compares screenshots, reads an unseeded random number, or meets another checkout's server (`references/e2e-testing.md`, section 7).

## 9. References in this skill

Read these when needed:

- `references/api-quickref.md`: the API by area, with the doc to read for each part. Read it before an API's first use in a session.
- `references/recipes.md`: patterns for common tasks. Camera controls, animated models, thousands of moving objects, pooling, picking, labels, loading screens, HTML UI, physics, video, custom effects, large worlds, particle effects and terrain.
- `references/performance.md`: budgets, measuring, symptom-to-fix tables, phone rules, slow first loads, staged loading, caching across visits and a review order.
- `references/shaders.md`: the surface-function contract, built-in values, uniforms and textures, portable WGSL rules, custom post effects and custom passes.
- `references/testing-and-debugging.md`: `bunx @null3d/cli test`, image tests, device tests, the inspector, error codes and troubleshooting.
- `references/e2e-testing.md`: a browser suite for a whole app or game. Playwright and its pinned Chromium, the real page, readiness, a test hook, state hashes, determinism and CI.
- `references/content-pages.md`: product and marketing pages with a 3D scene: scroll-driven cameras, caching and crashes.

## 10. Before you finish

- The code uses only APIs that the installed engine's docs and type declarations show.
- Per-frame callbacks allocate nothing.
- DOM, HTML UI and the audio's start are in `page.ts`.
- You looked at a rendered image from `bunx @null3d/cli shot` or the dev server, not only at build output.
- `bunx @null3d/cli test` passes, including a new or updated image test for visual changes.
- An app's browser suite passes on the dev server and on the production build. It waits for a hook, never a fixed sleep, and it asserts state, not screenshots (`references/e2e-testing.md`).
- For rendering changes, the WebGL2 path renders too.
- Performance was checked against the preset budget for the target devices.
- Before a release, also work through "Before you ship" in `references/testing-and-debugging.md`.
