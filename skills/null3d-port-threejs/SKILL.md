---
name: null3d-port-threejs
description: Port three.js projects, scenes, examples, components and shaders to the null3D engine (also written null3d, Null3D or null 3d), keeping the same look and gaining speed. Use this skill whenever the user wants to convert, migrate, move or rewrite three.js code to null3D, including code with imports from three or three/addons, THREE calls, GLTFLoader, OrbitControls, InstancedMesh, EffectComposer, ShaderMaterial, onBeforeCompile or TSL, and React Three Fiber or drei scenes. Also use it to answer what the null3D equivalent of a three.js API is, to estimate how hard a port will be, and to compare a three.js app with its null3D port. Use it even for a single class, snippet or shader. For new null3D work that is not a port, use null3d-develop.
compatibility: The scanner script needs Node.js 18 or newer. Porting needs a null3D project as the target; the null3d-develop skill covers null3D itself.
metadata:
  skill-version: 0.1.0
  engine-versions: "0.1"
---

# Porting three.js to null3D

A good port looks like the original, runs faster, and reads like null3D code. Translating line by line reaches the first goal at best. Some three.js habits keep the original's speed problems. Among them are objects changed every frame, per-object update methods, allocations in the render loop, and DOM access next to scene code. Many of them do not work at all, because null3D sketch code runs in a worker. So port by intent: work out what each part of the original does, then write that the null3D way.

## 1. Before you start

1. If the null3d-develop skill is available, read its sections 1, 2 and 4: the docs system, the thread model and the performance rules. They apply to every port. Without it, read the engine docs pages `concepts/architecture` and `guides/performance`.
2. Find the engine version in the target project, and read docs pages by ID: `node_modules/@null3d/engine/docs/<id>.md`, `docs/<id>.md` inside the null3D repository, or `bunx @null3d/cli docs show <id>` (0.3). A page with `status: planned` describes an API that does not exist in that version yet. The note under an experimental page's title can name parts that are not built yet: treat those parts as planned too.
3. Look up three.js APIs in `references/api-mapping.md`. For 147 three.js APIs it gives the null3D equivalent, a status, the first engine version with it, and a doc ID. The statuses:
   - `direct`: same concept, new name.
   - `changed`: supported with a different API or pattern; follow the note.
   - `manual`: rewrite by hand (shaders, render hooks, some material maps).
   - `post-1.0`: not in null3D 1.0; use the workaround.
   - `unsupported`: out of scope; use the workaround.

## 2. Workflow

### Phase 1: Inventory

```sh
node <this-skill-dir>/scripts/analyze-threejs.mjs <three-project-dir> --md PORTING-INVENTORY.md --json porting-inventory.json
```

The scanner lists every three.js feature it finds, grouped by status, with file and line references and the null3D equivalent. It also gives the lowest engine version the port needs, warnings (per-frame allocations, DOM access, GLSL, React Three Fiber) and a rough effort size. It matches text patterns, so read the code to confirm each row.

Then tell the user, before writing any code:
- which features need a hand rewrite, which are `post-1.0` or `unsupported`, and the workaround you propose for each;
- the engine version the port needs;
- the rough effort.

These decide the scope. Settling them first avoids a half-done port that fails on a feature nobody discussed.

### Phase 2: Baseline

Capture reference images and timings from the running three.js app at fixed camera views, at a fixed canvas size and pixel ratio (`references/verification.md`). Without a baseline, "looks the same" cannot be checked. If the app cannot run, say so, and ask for screenshots or accept a port without parity checks.

### Phase 3: Split the architecture

In null3D, a 3D scene is called a sketch, and it lives in `sketch.ts`. Decide what stays on the page: DOM, HTML UI, GUI panels, audio, video elements and storage. The rest moves to `sketch.ts`: the scene, the loop, input handling, controls, and state such as scores or selections. Design the few messages between them. Read `references/architecture-and-loop.md`; for React Three Fiber apps, `references/react-three-fiber.md`.

For a large app, a two-step route lowers risk. First port with `createEngine({ sketchThread: 'main' })`, so sketch code runs on the main thread, where it can still reach the DOM. Then move it to the worker once parity holds.

### Phase 4: Port in this order

Check parity images after each step. Each step needs the earlier ones to be visible, and a difference is easier to trace when little has changed.

1. Renderer and loop: `createEngine` on the page, `defineSketch` in `sketch.ts`, the loop body in `onUpdate`.
2. Camera, camera controls and input.
3. Models (0.2) and textures. Optimize them with `bunx @null3d/cli assets optimize <in> <out>` (0.2), which writes integer vertices and KTX2 textures.
4. Materials and texture settings (`references/materials.md`).
5. Lights, shadows, environment, fog, background.
6. Geometry, instancing and batching.
7. Interaction: picking, pointer events, labels.
8. Animation.
9. Post-processing (`references/post-processing.md`).
10. Custom shaders (`references/shaders.md`).
11. UI panels, audio, physics and other libraries.

### Phase 5: Make it idiomatic

- Many similar objects become instance batches driven by typed arrays.
- Per-object `update()` methods become loops over arrays.
- Per-frame allocations go away: scratch arrays are created once.
- Objects that move every frame get `dynamic: true`; everything else stays static.
- Layer masks limit picking and special passes.
- Short-lived objects come from pools.

This phase is where most of the speed comes from. Measure before and after it.

### Phase 6: Verify

Compare parity images for every camera view on WebGPU and on WebGL2 (`?gpu=webgl2`). Compare performance with the baseline on the same device and browser. Test on phones if the original targets them. Details: `references/verification.md`.

### Phase 7: Report

Write `PORTING-REPORT.md` with the template in `references/verification.md`. It says what was ported, the parity results per view, and performance before and after. It also says what changed visually and why, and lists every feature left out with its workaround.

## 3. Differences that break ports

| three.js habit | null3D way | Why |
| --- | --- | --- |
| `renderer.render(scene, camera)` inside `requestAnimationFrame` | Logic in `onUpdate(dt)`; the engine renders by itself | Frames run on the render worker's own clock |
| `mesh.position.x += 1` | `mesh.setPosition(x, y, z)`, or typed arrays for many objects | Engine objects are handles; they have no position properties |
| `scene.add(mesh)` | Objects exist as soon as they are created; `setParent` builds hierarchy | Creation is a batched command |
| `scene.add` and `scene.remove` during play, or `object.visible` toggles | Create during setup; hide with `setVisible`; pool short-lived objects in a batch with `setActiveCount` | Creating, destroying and re-parenting rebuild the draw tables; visibility and active counts upload only what changed (`guides/performance`) |
| `new THREE.Vector3()` in the loop | Scratch arrays created once, with array math | Allocations cause garbage-collection stutter |
| `document`, `window` and DOM events next to scene code | The page owns the DOM; input arrives in `ctx.input`; messages carry data | Sketch code runs in a worker without a DOM |
| `obj.userData`, subclasses of `Mesh` | Your own maps or typed arrays keyed by handle or row | Engine objects have no `userData`, and their types refuse new properties |
| `onBeforeRender`, per-draw callbacks | `onUpdate` or `onLateUpdate`, or a declared pass (0.2) | No sketch code runs in the render worker |
| `material.needsUpdate = true` to switch features at run time | Create both material variants while loading. Swap with `setMaterial` for a rare change; for a frequent one, keep two objects and swap their visibility | A shader change needs a new pipeline, whose objects draw nothing until it is built, and `setMaterial` rebuilds the draw tables |
| `InstancedMesh.setMatrixAt` with a dummy `Object3D` | Write `positions`, `rotations` and `scales` arrays | No matrix composition in JavaScript: in the S1 benchmark it cost three.js about 0.5 ms per frame for 100,000 instances. The loop's own motion math costs the same in both engines, so keep it tight |
| `object.traverse` every frame | Collect the handles you need at setup | Traversal costs work every frame |
| `mergeGeometries` to cut draw calls | Separate objects that share a mesh and material | They already share one draw (`guides/performance`) |
| `matrixAutoUpdate = false` on still objects | Nothing | Objects are static by default and cost nothing until a setter changes them |
| `renderer.compile` or `compileAsync` after loading | `await scene.warmUp()` in the sketch, and wait for `engine.firstFrame` on the page | The first frame waits for its pipelines; warm up a later loading stage before you show it |
| Resize handlers and `setSize` | Nothing | The engine follows the canvas size |
| `EffectComposer` pass chains | `post.set` (tone mapping now, effects in 0.2) and `post.addEffect` (0.2) | The chain is built in and merged into few passes |
| `localStorage` in scene code | Keep it on the page, or use IndexedDB, which workers have | Workers have no `localStorage` |

## 4. Settings that change the look

When parity images differ, check these first.

- Color management. three.js r152 and later, like null3D, read hex colors as sRGB and light in linear space. Older projects (with `outputEncoding`, or `ColorManagement.enabled = false`) look different by design; decide with the user which look to keep.
- Texture color spaces. Color and emissive maps are sRGB; normal, roughness, metalness and AO maps are linear. If the original forgot the sRGB flag, its look is wrong in a way users may like; ask before "fixing" it.
- Tone mapping. three.js defaults to none, and null3D to ACES. Set `post.set({ toneMapping: 'none' })` to match an original without tone mapping, and copy `toneMappingExposure` to `exposure` unchanged. null3D multiplies the exposure into each light instead of the finished picture; the image is the same, and bloom's threshold keeps its meaning.
- Light units. null3D uses physical units, as three.js r155 and later do: candela for point and spot lights, lux for the others. Scenes tuned with legacy lights need new intensities. `light.power = lumens` becomes `intensity: lumens, intensityUnit: 'lumen'` (0.2), which divides as `power` does. A scene in real units, such as a 100,000-lux sun, sets `post.set({ ev100 })` (0.2); `exposure` then acts as exposure compensation (`api/post`).
- Point and spot light range. three.js `distance: 0` means infinite range; null3D needs a finite `range`. Pick the distance where the light no longer matters; the edge of the light may differ slightly.
- Shadows. three.js shadow cameras are hand-fitted; null3D cascades fit the view. Tune `mapSize`, `cascades` and bias rather than copying `shadow.camera`. The `shadowFilter` quality setting replaces `shadowMap.type` and `shadow.radius`.
- Pixel ratio. Many three.js apps render at the full device pixel ratio (3 on many phones); null3D's presets cap it (`concepts/quality-presets`). For parity tests, fix the pixel ratio to 1 in both.
- Material approximations. Lambert, Phong and Toon materials become standard materials or surface functions; small differences are expected (`references/materials.md`).
- Post effects. Bloom runs `UnrealBloomPass`'s own steps, so copy its strength, radius and threshold. Color grading and the vignette take `LUTPass`'s and `VignetteShader`'s numbers as they are. Ambient occlusion is implemented differently; match its look by tuning, one effect at a time.

## 5. When there is no equivalent

For `post-1.0` and `unsupported` rows:

1. Tell the user before porting the rest, with the workaround from the mapping table and what it costs visually or in behavior.
2. If the feature is central, for example an XR experience, recommend waiting rather than porting.
3. Never drop a feature silently. List every omission and workaround in the report.
4. Do not layer a three.js canvas over the null3D canvas to keep one effect. Two GPU contexts double memory and break the frame pacing; use it only as a stopgap the user explicitly accepts.

## 6. A small example

Before, in three.js:

```js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.5, 4);
const controls = new OrbitControls(camera, renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff, 0.4));
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.position.set(1, 2, 1);
scene.add(sun);
const cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0x4a8cff }));
scene.add(cube);
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
renderer.setAnimationLoop((t) => { cube.rotation.y = t / 1000; controls.update(); renderer.render(scene, camera); });
```

After, in null3D:

```ts
// page.ts
import { createEngine } from '@null3d/engine';
await createEngine({ canvas: document.querySelector('canvas')!, sketch: new URL('./sketch.ts', import.meta.url) });
```

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';
import { createOrbitControls } from '@null3d/controls';

export default defineSketch(async (ctx) => {
  const { scene, geometry, materials, post, time } = ctx;
  post.set({ toneMapping: 'none' });                 // three.js default, for parity
  const camera = scene.createPerspectiveCamera({ fov: 60, near: 0.1, far: 100, position: [0, 1.5, 4] });
  scene.setActiveCamera(camera);
  const controls = createOrbitControls(ctx, camera);
  scene.createAmbientLight({ intensity: 0.4 });
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 }); // from the light's position to its target
  const cube = scene.createMesh({
    mesh: geometry.box(),
    material: materials.standard({ color: 0x4a8cff }),
    dynamic: true,
  });
  return {
    onUpdate(dt) {
      cube.setRotationEuler(0, time.now, 0);
      controls.update(dt);
    },
  };
});
```

The resize handler, the pixel-ratio call, `scene.add` and the render call disappear. A directional light takes the direction its light travels, where three.js takes a position and a target. The canvas lives in `index.html`, and the engine sizes it from CSS.

## 7. References in this skill

- `references/api-mapping.md`: the full mapping table, grouped by area. Search it for a class or property name.
- `references/threejs-mapping.json`: the same data, used by the scanner.
- `scripts/analyze-threejs.mjs`: the scanner (phase 1).
- `references/architecture-and-loop.md`: what goes on the page and what goes in the sketch; loops, input, messages, per-object classes.
- `references/materials.md`: every material and texture parameter, approximations, and toon, matcap and clipping recipes.
- `references/shaders.md`: GLSL to WGSL, three.js built-ins, `onBeforeCompile` patterns, TSL, worked examples and pitfalls.
- `references/post-processing.md`: composer passes, pmndrs effects and three.js TSL post nodes, mapped to `post.set` and `post.addEffect`.
- `references/react-three-fiber.md`: R3F and drei to null3D, with a React wrapper component.
- `references/verification.md`: baseline capture, parity tests, performance comparison and the report template.

## 8. Before you finish

- The inventory was confirmed against the code, and the user agreed on how to handle every `manual`, `post-1.0` and `unsupported` item.
- Every camera view passes its parity test on WebGPU and WebGL2, or its difference is explained and accepted.
- Performance was measured against the baseline on the same device and browser.
- Per-frame code allocates nothing, and many similar objects use instance batches.
- DOM, audio and storage code sits in `page.ts`.
- `PORTING-REPORT.md` lists results, visual changes and omissions.
