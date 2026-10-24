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

The engine docs are the source of truth. This skill describes null3D 0.1.0 and marks the parts not built yet. A project may use another version, so check it first.

1. Find the engine version: `bunx @null3d/cli --version`, or the `@null3d/engine` entry in `package.json`.
2. Read docs pages by ID, in this order:
   - inside the null3D repository itself: `docs/<id>.md`;
   - in a null3D project: `node_modules/@null3d/engine/docs/<id>.md`;
   - from any terminal (0.3, not built yet): `bunx @null3d/cli docs show <id>`, or `bunx @null3d/cli docs search "<words>"`.
3. Each page starts with front matter. `status: stable` or `status: experimental` means the API exists (experimental APIs may still change). `status: planned` means it does not exist in this version. The note under an experimental page's title can name parts that are not built yet: treat those parts as planned too. Do not call a planned API; tell the user, and use the workaround the page gives.
4. If the docs and this skill disagree, follow the docs and mention the difference in your summary, so the skill can be fixed.

Doc IDs appear in backticks throughout, for example `concepts/architecture`. A number in parentheses, such as (0.2), names the roadmap step that adds the part, and no number means step 0.1. The first release, null3D 0.1.0, holds steps 0.1, 0.2 and 0.3; "not built yet" marks a part that the engine lacks today.

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
6. Load and warm up before play: `await assets.preload([...])` and `await scene.warmUp()` behind a loading screen. A shader feature, such as a normal map, is fixed when you create the material and the first frame waits for its pipeline, so create every variant before play; a later stage's objects can start hidden, await `scene.warmUp()`, then show. (`guides/loading-screens`)
7. Keep the DOM on the page, and keep messages rare: send events, not per-frame state. Labels that follow objects use `ui.trackLabel` (0.2), which needs no messages. (`guides/ui-overlays`)
8. Use layer masks to limit work. A camera with a mask draws fewer objects, and a raycast (0.2) with a mask tests fewer. (`concepts/render-layers`)
9. Respect the quality preset. Do not force a heavier preset on phones. When frames run long, the engine's governor lowers the render scale, then the shadow settings, by itself. Keep your own values per preset, such as particle counts or AI update rates, in one table keyed by `quality.preset`. Never check the device type yourself, and listen to `quality.onChange` to apply the values. (`concepts/quality-presets`)
10. Ship optimized assets: KTX2 textures, which stay compressed on the GPU, and glTF models with integer vertices (0.2). `bunx @null3d/cli assets optimize <in> <out>` makes both, or a `?optimized` import of a `.glb` through the Vite plugin. It compresses models with meshopt, adds blockers for WebGL2's occlusion culling, stores raycast trees for large mesh parts, and bakes normal map detail into the roughness mips so distant bumpy surfaces do not flicker. It records the shader features each model needs, so the engine builds only the pipelines it draws with. Large PNG files and float meshes cost download time and GPU memory. The KTX2 transcoder and the meshopt decoder load with the first file that needs them: set no decoder path and copy no worker file. (`api/textures`, `guides/assets-pipeline`, `concepts/assets`)
11. Keep custom WGSL portable. Use only the three language features every browser shares, and write flat interpolation as `@interpolate(flat, either)`. The build rejects other features, `enable` lines and `f16`, but it cannot check the portable limits or `textureSample` in branches. Test those on each GPU path. (`shaders/wgsl-rules`)
12. Never branch on GPU names or user agents; read `engine.capabilities` on the page. Several browsers hide GPU names, and a name does not tell you what the engine enabled.

## 5. When the engine may not have the feature

A request may need a capability that null3D has not built. Settle its state before you design the scene.

1. Search first: the docs page (section 1), `references/api-quickref.md`, then the add-on table in section 6. A core call or an add-on may answer the need.
2. Read the page's status. `stable` or `experimental` means the call exists. `planned`, or "not built yet" in the note, means it does not exist in this version. Tell the user, name the step that adds it, and use the page's workaround. Do not call it, and do not invent an option in its place.
3. If nothing covers the need, build it above the public API: a custom material, vertex offset, post effect or render pass. Keep that code in the project, and add no property or call that imitates engine API, because it breaks on the next update.
4. Never write a second version of a feature in the add-on table. A hand-rolled copy gets no fixes, and it drifts from the add-on that users install.
5. Say in your summary what the engine lacks, what you used instead, and what a later version changes. A silent workaround reads as the real feature.

## 6. Choosing the right tool

### Search before you hand-roll

Check this table before you write a generator, control, effect or loader of your own. Each foundation add-on is the one place that feature lives: one package, both GPU paths, and fixes with the engine.

| Need | Use | Docs | Status |
| --- | --- | --- | --- |
| Orbit, map, fly or first-person cameras, and drag, rotate or scale handles | `@null3d/controls` | `api/controls` | built |
| Torus knots, polyhedra, lathes, extrusions and tubes | `@null3d/geometry` | `api/geometry` | built |
| Far objects as camera-facing cards, or one mesh per far grid cell | `@null3d/impostors` | `api/impostors` | built |
| Fire, smoke, sparks, rain and other particle effects | `@null3d/particles` | `api/particles` | built |
| Gaussian splats from a scan or a training run, as SPZ or `KHR_gaussian_splatting` files | `@null3d/splats` | `api/splats` | built |
| Hills, valleys and other ground from a height field | `@null3d/terrain` | `api/terrain` | built |
| Rigid bodies, joints and character movement | the physics add-on | `guides/physics` | not built yet; run Rapier or cannon-es in the sketch worker |
| Text in the scene, sharp at any distance | the MSDF text add-on | none yet | not built yet; use HTML labels with `ui.trackLabel` |
| Water with waves, foam and a surface seen from below | `@null3d/water` | none yet | not built yet; recipe 20 builds one with a custom material |
| Trees, shrubs, grass and wind over plants | the vegetation add-on | none yet | not built yet; generate simple plants above the public API |
| three.js look modes for a port: Reinhard and Cineon tone curves, and a soft outline with a glow and a pulse | `@null3d/three-compat` | `api/three-compat` | built |

Drawing:

| Situation | Use | Docs |
| --- | --- | --- |
| A few distinct objects | `scene.createMesh` | `api/scene` |
| A loaded model, once or many times | `assets.loadGltf`, then `scene.instantiate` (0.2) | `api/assets` |
| Hundreds to millions of copies of one mesh | `scene.createInstances` with typed arrays | `concepts/instances` |
| Objects that move every frame | `dynamic: true`, or a dynamic batch | `concepts/static-dynamic` |
| Less detail far away | `mesh.setLevels([{ mesh, error }])`, or levels from `bunx @null3d/cli assets optimize --lod`, which `assets.loadGltf` reads (0.2) | `concepts/lod` |
| A large static mesh, detailed near and coarse far | `bunx @null3d/cli assets optimize --clusters`, which stores a tree of patches that the engine draws on WebGPU, in one draw for a mesh that draws once | `concepts/lod` |
| Camera-facing quads that the sketch moves itself | `scene.createSprites` (0.2) | `api/sprites` |
| Point clouds | `scene.createPoints` (0.2) | `api/points` |
| Lines with pixel or world widths | `scene.createLines` (0.2) | `api/lines` |
| Shapes for debugging only | `debug.line`, `debug.box`, `debug.axes` | `api/debug` |

Materials:

| Need | Use | Docs |
| --- | --- | --- |
| Lit surfaces, which is most things | `materials.standard` | `api/materials` |
| Flat color or texture without lighting | `materials.unlit` | `api/materials` |
| A ground plane that only shows shadows | `materials.shadowCatcher` (0.2) | `api/materials` |
| A sharp shadow on one subject, such as a car in a showroom | `sun.setShadow({ hero: mesh })` (0.2), with the mesh's `castShadows` on | `concepts/shadows` |
| A custom look that still gets lights, shadows and fog | `materials.shader({ wgsl })` with `fn surface` in the WGSL | `shaders/surface-functions` |
| A fully custom effect, such as a hologram | `materials.shader({ wgsl })` with a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one | `guides/custom-shaders` |

Lighting and shadows: surfaces take one directional light, the ambient and hemisphere lights (0.2), and clustered point and spot lights. One shadowed directional light covers most outdoor scenes, and its layers choose the casters. Hemisphere light is the cheap fill. Point and spot lights cost little without shadows. Rectangle and tube lights (0.2) show their true shape in highlights, at several times a point light's cost. Contact shadows ground small objects on High and Ultra (0.2). An environment gives standard materials reflections and soft diffuse light (0.2). Set it up before play, because the GPU filters the whole map in one frame. The sky lights outdoor scenes, and `timeOfDay` matches the sun, sky, fog and exposure. The physical atmosphere hazes distant land blue (0.2). Indoors, give each room or section its own reflection probe (0.2). (`api/lights`, `concepts/lighting`, `concepts/shadows`; every option and default is in `references/api-quickref.md` section 7.)

Interaction:

| Need | Use | Docs |
| --- | --- | --- |
| Click or hover on objects | `obj.on('click', fn)` and `'pointerenter'` or `'pointerleave'`, or `camera.screenToRay` with `scene.raycast` (all 0.2) | `api/input`, `api/raycast` |
| Keys, pointer, touch, gamepad | `input.isDown`, `input.wasPressed`, `input.value`, `input.pointer`, `input.touches`, `input.actions.define` | `api/input` |
| HTML UI and settings panels | On the page, sending messages to the sketch | `guides/ui-overlays` |
| Labels above objects | `ui.trackLabel` in the sketch, `engine.labels.bind` on the page (0.2) | `api/ui` |
| A product or marketing page with a 3D scene | Fallback page first, a load deadline, reveal on `engine.firstFrame`, pause off screen | `guides/content-pages`, `references/content-pages.md` |
| Accessibility and reduced motion | Meaning in HTML around the canvas; `preferences.reducedMotion` brings decorative motion to rest | `guides/accessibility` |

Effects:

| Need | Use | Docs |
| --- | --- | --- |
| Tone mapping and exposure | `post.set({ toneMapping, exposure })`; `ev100` (0.2) for lights in real units | `api/post` |
| A sign, panel or heads-up display that keeps its exact color | `materials.unlit({ color, toneMapped: false })` on the 8-bit path, which `createEngine({ hdr: false })` takes | `api/materials`, `concepts/color-management` |
| Bloom | `post.set({ bloom: { intensity, threshold, knee, blend, weights } })` (0.2); quality setting `bloomSize` | `api/post`, `concepts/post-processing` |
| Color grading from a `.cube` or `.3dl` file, and a vignette | `post.set({ lut: await assets.loadLut(url), vignette: { intensity, size } })` (0.2) | `api/post`, `api/assets` |
| Color grading made in code, with no file | `post.set({ lut: await assets.lutFromData({ size, data }) })` (0.2): three numbers per texel, red fastest, as a `.cube` file | `api/assets` |
| Outlines around chosen meshes | `post.set({ outline: { color, width } })` and `mesh.setOutlined(true)` (0.2) | `api/post`, `api/objects` |
| Ambient occlusion | `post.set({ ao: { radius, intensity } })` (0.2), with `quality.set({ aoScale: 0.5 })` on phones and tablets | `api/post`, `concepts/post-processing` |
| Wet streets, polished floors and metal that reflect the scene | `post.set({ ssr: { maxDistance, thickness } })` (0.2) with smooth materials; `ssrScale` 0 on Low; an environment shows where rays miss. A flat mirror: a reflection pass | `api/post`, `concepts/post-processing` |
| Depth of field, a camera's lens | `camera.setFocalLength(mm)` and `post.set({ dof: { aperture, focusDistance or focusPoint } })` (0.2); quality setting `dofSamples`, 0 on Low | `api/post`, `api/cameras`, `concepts/post-processing` |
| An eye that adapts from bright to dark places, automatic exposure | `post.set({ autoExposure: { minEv, maxEv, speedUp, speedDown, compensation } })` (0.2), from the camera's `exposure` or `ev100`; quality setting `exposureMeter` | `api/post`, `concepts/post-processing` |
| Crisper edges and fine detail | `post.set({ sharpen })`, 0 to 1; 0.5 is a good start (0.2) | `api/post` |
| A custom full-screen effect, or a tone curve of your own | `post.addEffect({ wgsl, uniforms, order })`, or `post.set({ toneMapping: wgsl })` (0.2) | `guides/custom-passes` |
| Render to a texture: a minimap, a camera's screen | `render.addPass({ kind: 'scene', camera, writes, size })` and `textures.fromPass(pass)` (0.2) | `api/render`, `guides/custom-passes` |
| Water, mirrors and polished floors that reflect the scene | `render.addPass({ kind: 'reflection', writes, plane: { point } })`, and a custom material that sets `s.reflection` (0.2) | `api/render`, `shaders/surface-functions`, `guides/custom-passes` |
| Water waves, noise fields or any texture that a compute shader makes each frame | `render.addPass({ kind: 'compute', description, wgsl, format, values, fallback })` and `textures.fromPass(pass)`; WebGPU only, with the fallback fragment form on WebGL2 (0.3) | `api/render`, `api/features` |
| Glass, gems and clear water that show what lies behind them, bent and blurred | `materials.standard({ transmission: 1, thickness, ior, roughness })`, or a custom material that sets `s.transmission` (0.2) | `api/materials`, `shaders/surface-functions` |
| Leaves and paper lit from behind | `materials.standard({ diffuseTransmission })` (0.2) | `api/materials` |
| Skin and wax whose light spreads under the surface | `materials.standard({ subsurfaceRadius })` (0.2), on High and Ultra | `api/materials` |
| Car paint, varnish, wet stone; velvet and cloth | `materials.standard({ clearcoat: 1, clearcoatRoughness })` or `{ sheenColor, sheenRoughness }` (0.2), or a custom material that sets `s.clearcoat` or `s.sheenColor` | `api/materials`, `shaders/surface-functions` |
| Soap bubbles, beetle shells; brushed metal | `materials.standard({ iridescence })` or `{ anisotropy }` with a map (0.3) | `api/materials`, `shaders/surface-functions` |
| Decals: scorch marks, mud, puddles, road paint, moss, cracks, posters | A mesh of `geometry.box()` with `materials.decal({ map, normalMap, metalnessRoughnessMap, angleFade, edgeFade })`; the box's z axis points out of the surfaces it marks; a batch of boxes for many (0.2) | `api/materials` |
| Fog or sky | `scene.setFog` with the fog's color in `scene.setBackground`; `scene.setBackground({ sky })` (0.2); a physical sky that also hazes distant objects: `scene.setBackground({ atmosphere })` (0.2) | `api/scene` |
| An aurora, a second layer of clouds, or a backdrop of space over the sky | `scene.setSkyLayer({ wgsl })` (0.3) with WGSL that declares `fn skyLayer(input: SkyLayerInput) -> SkyLayer`; it draws over the core sky on every path and lights nothing | `api/scene` |
| Light shafts, sun rays through trees, glowing cones under lamps and headlights | `scene.setFog({ color, density, heightFalloff, volumetric: { intensity, anisotropy, distance } })` (0.2); quality setting `fogSlices`, 0 on Low, where the fog keeps its `sunGlow` | `api/scene`, `concepts/lighting` |
| Light from the sky, or a time of day | `scene.setEnvironment(await assets.skyEnvironment())` (0.2); `timeOfDay(hours)` values for the sky, the sun, the fog and the exposure (0.2) | `concepts/lighting` |
| Reflections of a room or a street on floors and metal | `scene.createReflectionProbe({ box: { min, max }, position })` (0.2), one per room; `refresh: 'always'` for moving things | `api/scene` |

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

`references/shaders.md` has the full contract: every field of `SurfaceInput` and `Surface`, uniforms (`struct Uniforms` in the WGSL, read from `material`), the names to avoid, and the WGSL rules. Vertex offsets (`fn vertexOffset` in the same WGSL) and the built-in values (`frame.time`, `camera.position`, `object.position`) are built too. So are full shaders (`guides/custom-shaders`), and textures (0.2): `var name: texture_2d<f32>;` in the WGSL and the `textures` option.

## 8. When something goes wrong

Most faults come from a page that is not cross-origin isolated, an object changed without a setter, the wrong texture color space, allocations in per-frame code, or a pipeline built during play. `references/testing-and-debugging.md` section 8 pairs every symptom with its cause and fix. Section 7 there lists the error codes, and section 9 is the release checklist. An `EngineError` names its fix in its message, then the docs page `errors/<code>`.

## 9. References in this skill

Read these when the task needs them:

- `references/api-quickref.md`: the API by area, with the roadmap step that adds each part and the doc ID to read. Read it before using an API for the first time in a session.
- `references/recipes.md`: patterns for common tasks. They include camera controls, animated models, thousands of moving objects, pooling, picking, labels, loading screens, HTML UI, physics, video, custom effects, large worlds, particle effects and terrain.
- `references/performance.md`: budgets, how to measure, symptom-to-fix tables and phone rules.
- `references/shaders.md`: the surface-function contract, built-in values, uniforms and textures, portable WGSL rules, custom post effects and custom passes.
- `references/testing-and-debugging.md`: `bunx @null3d/cli test`, image tests, testing on devices, the MCP server tools (0.3, not built yet), error codes and a full troubleshooting table.
- `references/content-pages.md`: product and marketing pages with a 3D scene: the fallback page, a load deadline, pausing, scroll-driven cameras, caching and crashes.

## 10. Before you finish

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
