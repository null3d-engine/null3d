# null3D API quick reference

This is the API planned for null3D 1.0. A version in parentheses, such as (0.2), is the first engine version with that part; no number means 0.1. "Later in 0.1" marks a part of 0.1 that is not built yet, but other parts can be missing too. Before using a part, check its docs page's status (`stable`, `experimental` or `planned`) and the note under its title, as SKILL.md section 1 explains. Each heading names the doc ID with the full reference.

## Contents

1. Page: createEngine
2. Sketch: defineSketch and the context
3. Scene
4. Objects and transforms
5. Instance batches
6. Cameras
7. Lights
8. Geometry
9. Materials
10. Textures
11. Assets
12. Animation (0.2)
13. Raycasting and queries (0.2)
14. Input and controls
15. Post-processing (tone mapping 0.1; effects 0.2)
16. Render graph (0.2)
17. Quality
18. Messages and UI
19. Debug
20. Math, color and time

## 1. Page: createEngine (`api/engine`)

```ts
import { createEngine } from '@null3d/engine';

const engine = await createEngine({
  canvas,                                        // HTMLCanvasElement, sized by CSS
  sketch: new URL('./sketch.ts', import.meta.url),   // the sketch module
  preset: 'auto',        // 'auto' | 'low' | 'medium' | 'high' | 'ultra'
  maxPixelRatio: 2,      // cap for devicePixelRatio; presets cap it too
  gpu: 'auto',           // 'auto' | 'webgpu' | 'webgl2' (testing only)
  powerPreference: 'high-performance',   // the default; 'low-power' saves battery on devices with two GPUs
  latency: 'pipelined',  // or 'low'; 'pipelined' is the default
  memory: { maximumMiB: 1024 },          // the default; up to 4096 for scenes that need more (E1409 outside 256 to 4096)
  transparent: false,    // true for a see-through canvas
  largeWorld: false,     // (0.2) planet-scale scenes: cell-relative positions, batch origins
  sketchThread: 'worker',  // later in 0.1: 'main' for DOM-heavy apps and debugging
  onProgress: (stage) => {},             // 'core', then 'sketch' after the sketch's setup, then 'first-frame'
  onSketchMessage: (type, data) => {},     // sketch messages from the start of setup, such as load progress
  signal: controller.signal,             // abort to cancel the start; createEngine then rejects
});
// createEngine rejects with an EngineError when the browser cannot run the engine (error.code)

await engine.firstFrame;                 // the GPU finished the first frame: remove the loading screen
engine.postToSketch('difficulty', { level: 2 });            // an optional third argument lists transferables
const off = engine.onSketchMessage((type, data) => { /* ... */ }); // the first handler also gets earlier messages
off();                                   // every on... call returns a function that removes its handler
engine.detach();                         // single-page apps: canvas off the page, engine paused, scene kept
engine.attach(container);                // canvas back on the page; the engine resumes with no new start
const image = await engine.capture();             // Blob of the next complete frame
// engine.registerVideo and textures.fromVideo come after 1.0; recipe 14 shows the workaround
engine.labels.bind('hp-12', element);             // (0.2) HTML label that follows an object
await engine.requestPointerLock();                // (0.2) for first-person controls
engine.capabilities;  // { tier: 'webgpu' | 'webgpu-compat' | 'webgl2', threaded, features, limits, maxInstances, depth }
engine.setPaused(true);                           // the first step after resuming counts no time
engine.onFailure((error) => { /* error.code: E1302 GPU lost for good, E1404 engine thread failed */ });
engine.simulateGpuLoss();                         // acts out a driver reset; the engine recovers
await engine.destroy();                 // workers stop; wait before this page starts another engine
```

## 2. Sketch: defineSketch and the context (`api/sketch`)

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async (ctx) => {
  const {
    scene, assets, materials, geometry, textures,
    input, time, quality, post, render, page, ui, debug, engine, preferences,
  } = ctx;
  // setup: create objects, load assets, await scene.warmUp()
  // preferences.reducedMotion: true when the user's system asks for less motion
  // preferences.onChange(() => { ... }) runs at the first frame after it changes; it returns a remover
  return {
    onFixedUpdate(step) {},  // 0 to n times per frame at a fixed rate (default 60 Hz)
    onUpdate(dt) {},         // once per frame, before transforms; dt is 0 after a pause, at most 0.25 s
    onLateUpdate(dt) {},     // after transforms, before culling: camera follow
  };
});
```

`ctx.engine.viewport` gives the canvas size in CSS pixels and the pixel ratio. `ctx.engine.capabilities` is the same object as on the page.

## 3. Scene (`api/scene`)

| Call | Returns | Notes |
| --- | --- | --- |
| `scene.createGroup({ name, position, rotation, scale, parent })` | Group | Empty node for hierarchy |
| `scene.createMesh({ mesh, material, position, rotation, scale, dynamic, castShadows, receiveShadows, layers, name, parent })` | Mesh | Static unless `dynamic: true` |
| `scene.createInstances(meshOrPrefab, count, { dynamic, colors, attributes, material, layers, origin })` | InstanceBatch | Section 5 |
| `scene.instantiate(prefab, { position, rotation, scale, parent })` (0.2) | Node | Creates a loaded glTF model |
| `scene.clone(obj)` (0.2) | same type | Deep copy of a built object |
| `scene.find(name)` | Node or undefined | The first live node with the name; use at setup, not per frame |
| `scene.createPerspectiveCamera({ fov, near, far, position, target, layers })` | PerspectiveCamera | fov is vertical, in degrees |
| `scene.createOrthographicCamera({ height, near, far, position, target, layers })` | OrthographicCamera | Or left, right, top, bottom in place of height |
| `scene.setActiveCamera(camera)` | | |
| `scene.createDirectionalLight(opts)` and the other lights | Light | Section 7 |
| `scene.setBackground('#rrggbb' or texture or environment or { sky })` | | `{ sky: { turbidity, rayleigh, sunDirection } }` (0.2) |
| `scene.setEnvironment(env, { intensity, rotation })` (0.2) | | env from `assets.loadEnvironment` |
| `scene.setBackground(env, { blur, intensity, rotation })` (0.2) | | Blurred environment backgrounds |
| `scene.setFog({ type: 'linear', color, near, far })` or `{ type: 'exp2', color, density }`, or `null` | | |
| `scene.createSprites`, `createPoints`, `createLines`, `createLod` (0.2) | | Docs `api/sprites`, `api/points`, `api/lines`, `concepts/lod` |
| `scene.createView({ camera, rect })` (after 1.0) | View | Split screens; until then, minimaps use a render-to-texture pass (`guides/multiple-views`) |
| `scene.animateProperty(target, path, keyframes)` (after 1.0) | Animation | Until then, animate values in `onUpdate` |
| `scene.raycast(...)` and other queries (0.2) | | Section 13 |
| `await scene.warmUp()` | | Resolves when every pipeline the scene needs is compiled |

## 4. Objects and transforms (`api/objects`)

Every node (group, mesh, camera, instantiated model) has these calls. Lights become nodes with the same calls later in 0.1; until then they have only the calls in section 7.

```ts
obj.setPosition(x, y, z);            obj.getPosition(out);         // out: number[3] or Float32Array
obj.setRotation(qx, qy, qz, qw);     obj.getRotation(out);         // quaternion
obj.setRotationEuler(x, y, z, 'XYZ');                               // radians, three.js order names
obj.rotateX(a); obj.rotateY(a); obj.rotateZ(a);                     // about the object's own axes
obj.setScale(x, y, z);               obj.translate(x, y, z);       // along the object's own axes, scale ignored
obj.lookAt(x, y, z);                                                // cameras look down -Z, and so will lights
obj.getWorldPosition(out); obj.getWorldQuaternion(out); obj.getWorldMatrix(out);  // last frame; matrix column by column
obj.setParent(parent);               obj.setParent(parent, { keepWorld: true }); obj.setParent(null);
obj.setVisible(false);               obj.setDynamic(true);
obj.setLayers(mask);
obj.setMorphWeight(nameOrIndex, w);  // morph (0.2)
obj.setOutlined(true);               // (0.2) with post.set({ outline })
obj.setOccluder(false);              // (0.2) WebGL2 path: stop this object hiding others; true makes it a blocker
obj.on('click', fn); obj.off('click', fn);  // (0.2) 'pointerenter', 'pointerleave', 'pointerdown', 'pointerup'
obj.animator();                      // (0.2) section 12
obj.destroy();
obj.name;                            // string, read-only after creation
```

Meshes also have these calls. `setCastShadows` and `setReceiveShadows` are stored until shadows draw, and `setRenderOrder` orders transparent objects, which do not draw yet.

```ts
mesh.setMaterial(material);          mesh.setMesh(geometry);       // setMesh brings back the mesh's bounds
mesh.setCastShadows(true);           mesh.setReceiveShadows(true); // false by default, as in three.js
mesh.setRenderOrder(n);                                             // transparent objects, lower first
mesh.setFrustumCulled(false);        mesh.setBounds(center, radius);  // center relative to the origin, before scale
```

Getters write into the `out` array you pass, so they allocate nothing. The world getters read the last frame the engine processed. Pass them a plain array or `Float64Array` to keep 64-bit positions. Use a setter for static objects; direct array writes are for dynamic objects and batches. A parent change with `keepWorld: true` works out the new local transform when the frame applies it, so set the object's transform first. These calls rebuild the draw tables, so make them at setup: `setMaterial`, `setMesh`, `setParent`, `setDynamic`, `setBounds` and `setFrustumCulled`.

## 5. Instance batches (`concepts/instances`)

```ts
const rocks = scene.createInstances(geometry.sphere({ radius: 0.2 }), 10_000, {
  material: materials.standard({ color: '#888888', roughness: 0.9 }),
  dynamic: true,              // uploads every row every frame; false = upload marked rows only
  colors: true,               // adds batch.colors (RGBA, linear, 4 floats per row)
  layers: 1 << 2,             // every row is on layer 2; the default, 1, is layer 0
  attributes: { tint: 4 },    // (0.2) custom per-instance floats, readable in surface functions
  origin: [0, 0, 0],          // (0.2) rows are relative to this point; set it in large worlds
});

rocks.positions;   // Float32Array, 3 floats per row
rocks.rotations;   // Float32Array, 4 floats per row (quaternion x, y, z, w)
rocks.scales;      // Float32Array, 3 floats per row
rocks.colors;      // Float32Array, 4 floats per row, when colors: true
rocks.attributes.tint;  // (0.2)
rocks.count;              // capacity
rocks.setActiveCount(n);  // draw only the first n rows (pooling)
rocks.setLayers(mask);    // every row's layers; no rebuild (concepts/render-layers)
rocks.markDirty(start, count);  // static batches: upload these rows
rocks.destroy();
```

A prefab with several meshes (0.2) gives one batch per mesh inside a group batch; the arrays are shared, so one write moves every part.

## 6. Cameras (`api/cameras`)

```ts
camera.setNearFar(near, far);     camera.near; camera.far;     // both kinds
camera.isOrthographic;            // false for PerspectiveCamera, true for OrthographicCamera
camera.setFov(deg);               camera.fov;                  // PerspectiveCamera
camera.setOrthoHeight(h);         camera.height; camera.width; // OrthographicCamera; width undefined while it follows the canvas
camera.setLayers(mask);
camera.screenToRay(x, y, ray);    // (0.2) x, y in CSS pixels; ray = { origin: number[3], direction: number[3] }
camera.worldToScreen(p, out);     // (0.2) out = [x, y, depth]; depth < 0 means behind the camera
```

An orthographic camera made with `height` follows the canvas's aspect ratio; one made with `left`, `right`, `top` and `bottom` keeps those edges, and `setOrthoHeight` scales them about their center.

## 7. Lights (`api/lights`)

```ts
scene.createDirectionalLight({ direction, color, intensity, castShadows,
  shadow: { cascades, mapSize, bias, normalBias } });
scene.createPointLight({ position, color, intensity, range, decay, castShadows });  // range is required
scene.createSpotLight({ position, direction, target, angle, penumbra, range, decay, intensity, castShadows });
scene.createHemisphereLight({ skyColor, groundColor, intensity });
scene.createAmbientLight({ color, intensity });

light.setIntensity(v); light.setColor(c); light.setRange(r); light.setDirection(x, y, z);
light.setCastShadows(true);
```

Units match three.js r155 and later: directional intensity in lux-like units, point and spot intensity in candela. Shadow cascades fit the view by themselves.

## 8. Geometry (`api/geometry`)

`ctx.geometry` has `box`, `sphere`, `plane`, `cylinder`, `cone`, `torus`, `capsule`, `circle` and `ring`, with the same parameters and defaults as the three.js geometry classes, as named options (for example `geometry.sphere({ radius, widthSegments, heightSegments })`). They build three.js's vertices, texture coordinates included. A mesh keeps the vertices its generator built, so turn, move or scale the object, not the mesh: three.js's `geometry.rotateX()` has no match. The package `@null3d/geometry` (0.2) adds `torusKnot`, `icosahedron`, `octahedron`, `tetrahedron`, `dodecahedron`, `polyhedron`, `lathe`, `extrude`, `shape` and `tube`.

```ts
const mesh = geometry.fromArrays({
  positions,                // 3 numbers per vertex: a Float32Array or a number[]
  normals,                  // 3 per vertex, or computeNormals: true instead
  uvs, uvs1, colors,        // 2, 2, and 3 or 4 per vertex; colors are linear
  tangents,                 // 4 per vertex, or computeTangents: true (needs uvs)
  indices,                  // Uint16Array, Uint32Array or number[]; omit for one triangle per 3 vertices
});
mesh.updateVertices('positions', data, start, count);  // (0.2) vertices that change at run time
mesh.destroy();
```

A mesh keeps the attributes it gets, and meshes with the same attributes share GPU buffers, so pass only the attributes the materials use. Bad arrays throw E1206. `api/geometry` covers vertex formats and meshes over 65,535 vertices.

## 9. Materials (`api/materials`)

```ts
const m = materials.standard({
  color: '#ffffff', map,                       // base color and its texture (sRGB)
  metalness: 0, roughness: 1, metalnessRoughnessMap,  // glTF packing: roughness in G, metalness in B
  normalMap, normalScale: [1, 1],
  aoMap, aoMapIntensity: 1,
  lightMap, lightMapIntensity: 1,              // baked light, usually on the second UV set
  emissive: '#000000', emissiveMap, emissiveIntensity: 1,
  alphaMode: 'opaque',                         // 'opaque' | 'mask' | 'blend'
  alphaCutoff: 0.5, opacity: 1,
  doubleSided: false, vertexColors: false, flatShading: false,
  depthWrite: true, depthTest: true,
  depthBias: { constant: 0, slopeScale: 0 },  // like three.js polygonOffset
  blending: 'normal',                          // 'normal' | 'additive' | 'multiply'
  envIntensity: 1, fog: true,
  uvTransform: { offset: [0, 0], repeat: [1, 1], rotation: 0 },
});
m.set({ roughness: 0.4 });                     // changes only the options you pass; the rest keep their values

materials.unlit({ color, map, opacity, alphaMode, alphaCutoff, vertexColors, doubleSided, fog });
materials.shadowCatcher({ opacity: 0.5 });     // (0.2)
materials.shader({ ...anyStandardOption, uniforms, textures, surface, vertexOffset, vertex, fragment });
// every materials.standard option feeds defaultSurface(), so a surface function can adjust a standard look
```

`set()` changes values, such as colors and numbers, cheaply at any time. Options that change the shader, such as `alphaMode`, `vertexColors` or a texture that the material did not have, are fixed when you create the material. Create each variant before play, and switch with `setMaterial`. Custom shaders: `references/shaders.md`.

## 10. Textures (`api/textures`)

```ts
const tex = await assets.loadTexture('/tex/bricks.png', {  // PNG, JPEG, WebP, AVIF where decoded
  colorSpace: 'srgb',        // 'srgb' for color maps; 'linear' for normal, roughness, metalness, AO
  flipY: true,               // default, as three.js's TextureLoader; glTF textures use false
  wrap: 'repeat',            // 'repeat' | 'clamp' | 'mirror', or [u, v]
  filter: 'linear',          // or 'nearest'
  mipmaps: true,
  anisotropy: 8,             // capped by the preset
  uvSet: 0,                  // which UV set the map uses (three.js texture.channel)
  premultipliedAlpha: false, // true to store color multiplied by alpha
});
textures.fromData({ width, height, depth: 1, format: 'rgba8unorm', colorSpace: 'linear', data }); // 4 numbers per texel
textures.fromData({ width, height, format: 'rgba16float', data: new Float32Array(width * height * 4) });
// fromImageBitmap uploads the bitmap as it is: decode with imageOrientation: 'flipY' to stand upright
textures.fromImageBitmap(await createImageBitmap(offscreenCanvas, { imageOrientation: 'flipY' }));
tex.update(bitmap);        // a new size is fine; or tex.update(data) of the same size
tex.width; tex.height; tex.bytes;   // size and GPU memory
tex.destroy();
```

Textures return at once and upload over the next frames, within each frame's upload budget. A material draws with its color alone until the texels arrive.

## 11. Assets (`api/assets`)

```ts
assets.onProgress((loaded, total) => page.post('loading', loaded / total));
await assets.preload(['/tex/bricks.png', '/level.json']);      // later loads take these from memory
const data = await assets.loadJson('/level.json');             // also loadBinary, loadImageBitmap
// relative addresses resolve against the page; errors: E1411 download, E1412 decode, E1413 CORS
const ship = await assets.loadGltf('/models/ship.glb');        // (0.2) Prefab
ship.animations;           // clip names
ship.find('Turret');       // a node inside the prefab
ship.bounds;               // { center, radius, min, max } of the whole model
const env = await assets.loadEnvironment('/env/studio.ktx2');  // (0.2) from `bunx @null3d/cli assets env`
const studio = assets.builtinEnvironment('studio');            // (0.2) neutral lighting, no download
const sky = await assets.loadCubemap([px, nx, py, ny, pz, nz]);  // (0.2)
const lut = await assets.loadLut('/grade.cube');                // (0.2)
ship.destroy();   // (0.2) frees GPU data once no instance uses it
```

## 12. Animation (0.2) (`api/animation`)

```ts
const hero = scene.instantiate(await assets.loadGltf('/hero.glb'));
const anim = hero.animator();
anim.play('run', { fade: 0.2, loop: true, speed: 1 });
anim.crossFade('walk', 0.3);
anim.play('wave', { layer: 1, additive: true });
anim.setLayerWeight(1, 0.5);
anim.setLayerMask(1, 'Spine');          // upper body only
anim.onEvent('footstep', (e) => page.post('sfx', { name: 'step' }));
anim.setJointOverride('Head', rotation); // procedural aiming
anim.stop();

// after 1.0: scene.animateProperty(lamp, 'light.intensity', { times: [0, 1, 2], values: [0, 5, 0], loop: true });
```

Sampling and blending run on job workers; there is no update call.

## 13. Raycasting and queries (0.2) (`api/raycast`)

```ts
const ray = { origin: [0, 0, 0], direction: [0, 0, -1] };
const hit = { object: null, point: [0, 0, 0], normal: [0, 0, 0], distance: 0, instance: -1 };
camera.screenToRay(input.pointer.x, input.pointer.y, ray);
if (scene.raycast(ray.origin, ray.direction, { maxDistance: 100, layers: PICKABLE }, hit)) { /* hit.object */ }
scene.raycastAny(origin, direction, opts);             // true or false; fastest
scene.raycastAll(origin, direction, opts, hits);       // every hit, sorted
scene.raycastBatch(rays, results);                     // many rays across job workers
scene.overlapSphere(center, radius, opts, out);        // objects inside a volume
scene.overlapBox(min, max, opts, out);
```

Hit objects are the same wrappers you created; `hit.instance` is the row index for batches. Create `ray` and `hit` once and reuse them.

## 14. Input (`api/input`) and controls (`api/controls`)

```ts
input.pointer;          // { x, y (CSS pixels), ndcX, ndcY, buttons, dx, dy, dragDx, dragDy, wheel, pinch, isTouch }
                        // per frame: dragDx/dragDy only while a button is held; pinch is the trackpad-pinch part of wheel
input.isDown('KeyW');   // KeyboardEvent.code names; 'Mouse0' to 'Mouse4' (Mouse0 is also a tap); 'GamepadA'
input.wasPressed('Space'); input.wasReleased('Space');   // true for one frame; a tap between frames gives both
input.value('GamepadRT');                // 0 to 1: triggers and stick directions such as 'GamepadLeftStickLeft'
input.actions.define({ jump: ['Space', 'GamepadA'], fire: ['Mouse0', 'GamepadRT'] });
input.isDown('jump');   // actions work in every input call; an unknown name throws E1205
input.touches;          // fingers on the canvas, oldest first: { id, x, y, dx, dy }; changes in place

import { createOrbitControls } from '@null3d/controls';
const controls = createOrbitControls(ctx, camera, {
  target: [0, 1, 0], enableDamping: true, dampingFactor: 0.08,
  minDistance: 2, maxDistance: 30, maxPolarAngle: Math.PI * 0.49, enablePan: true,
});
// in onUpdate: controls.update(dt)
// also createMapControls; createFlyControls and createFirstPersonControls (0.2)
```

Input changes once per frame, before `onUpdate`. Give a canvas that takes touch gestures `touch-action: none` in its CSS, or the browser scrolls the page and cancels the touches.

## 15. Post-processing (`api/post`)

`toneMapping` and `exposure` exist from 0.1; everything else from 0.2. The default tone mapping is ACES, while three.js defaults to none.

```ts
post.set({
  toneMapping: 'aces',      // 'aces' | 'agx' | 'neutral' | 'none' (0.1)
  exposure: 1,              // (0.1)
  bloom: { strength: 0.8, radius: 0.4, threshold: 0.9 },
  ao: { radius: 0.5, intensity: 1 },     // High and Ultra presets only
  fxaa: false,                           // forces FXAA; otherwise the preset decides
  lut, vignette: { amount: 0.3 },
  outline: { color: '#ffcc00', thickness: 2 },  // objects opt in with setOutlined(true)
});
post.addEffect({ name: 'pixelate', wgsl, uniforms: { size: 4 }, textures: {}, stage: 'final' });  // textures: named textures the effect samples
post.setEffectUniform('pixelate', 'size', 8);
post.removeEffect('pixelate');
```

## 16. Render graph (0.2) (`api/render`)

```ts
render.addPass({
  name: 'Minimap',
  kind: 'scene',                     // 'scene' | 'fullscreen' | 'compute' (compute: WebGPU only)
  camera: topCamera, layers: MAP_LAYER,
  writes: 'minimapColor', size: [256, 256],   // or 'screen', 'screen/2', 'screen/4'
  before: 'Post',
});
// sample 'minimapColor' as a texture: textures.fromPass('minimapColor')
render.setPassEnabled('Minimap', false);
render.removePass('Minimap');
render.dumpGraph();   // Graphviz DOT text of the compiled graph, for debugging
```

Passes are declarations: the engine checks them, orders them, and shares memory between their temporary textures. No sketch code runs during rendering.

## 17. Quality (`api/quality`)

```ts
quality.preset;                         // 'low' | 'medium' | 'high' | 'ultra'
quality.set({ shadows: { cascades: 2 }, ao: false, maxPixelRatio: 1.5, antialias: 'msaa' });  // antialias: 'msaa' | 'fxaa' | 'none'
quality.onChange((q) => { particles.setActiveCount(q.preset === 'low' ? 500 : 2000); });
quality.setBudget({ name: 'ai', ms: 2, onScale: (scale) => { aiRate = scale; } });
```

The frame-budget governor lowers settings in a fixed order when frames run long, and raises them again after a stable period.

## 18. Messages and UI (`api/page`, `api/ui`)

```ts
// sketch.ts
page.post('score', { value: 10 });
page.onMessage((type, data) => { if (type === 'difficulty') level = data.level; });
ui.trackLabel(unit, 'hp-12', { offset: [0, 2, 0] });   // (0.2)
ui.untrackLabel('hp-12');

// page.ts
engine.onSketchMessage((type, data) => { if (type === 'score') scoreEl.textContent = String(data.value); });
engine.postToSketch('difficulty', { level: 2 });
engine.labels.bind('hp-12', document.getElementById('hp-12')!);
```

Messages are fire-and-forget. Send events, not per-frame state.

## 19. Debug (`api/debug`)

```ts
// Call these in onUpdate: each call draws its lines for one frame.
debug.line([0, 0, 0], [1, 2, 0], '#ff0000');     // colors as for materials; yellow by default
debug.box(min, max, color); debug.sphere(center, radius, color);
debug.arrow(origin, direction, length, color);  // length 1 unless given
debug.axes(objectOrPosition, size);             // an object's axes follow it in the same frame
debug.grid(size, divisions, { center, color, centerColor });  // GridHelper's defaults, 10 and 10
debug.frustum(camera, color);                   // in the canvas's shape
debug.light(sun, { position, size, color });    // a directional light's direction
debug.skeleton(obj);                            // (0.2)

debug.stats(true);                       // later in 0.1: overlay of frame phases per thread, tier, preset
const s = debug.frameStats();            // later in 0.1: numbers for tests and logs
debug.view('normals');                   // later in 0.1: 'lit' | 'normals' | 'depth' | 'wireframe' | 'overdraw'
```

Debug drawing exists in development builds only. In a production build every call does nothing, and the build holds none of the drawing code. Lines are one pixel wide, and objects in front of them hide them.

## 20. Math, color and time (`api/math`, `api/time`)

```ts
import { vec3, quat, mat4, math, color } from '@null3d/engine';
const tmp = vec3.create();                // create once in the setup, reuse every frame
vec3.set(tmp, 1, 2, 3); vec3.add(tmp, tmp, other); vec3.normalize(tmp, tmp);
// Also vec3.copy, sub, multiply, scale, scaleAndAdd, negate, cross, lerp, min, max,
// transformQuat, transformMat4; and dot, length, squaredLength, distance, squaredDistance, angle.
quat.setAxisAngle(q, [0, 1, 0], angle); quat.fromEuler(q, x, y, z, 'XYZ'); quat.slerp(q, a, b, t);
quat.lookAt(q, eye, target);              // +Z toward the target, as a mesh looks
// Also quat.set, copy, identity, fromMat4, rotationTo, multiply, rotateX/Y/Z, invert, normalize, dot.
mat4.compose(m, position, rotation, scale); mat4.decompose(position, rotation, scale, m);
// Also mat4.identity, copy, multiply, invert.
math.clamp(v, lo, hi); math.lerp(a, b, t); math.damp(a, b, lambda, dt); math.degToRad(d);
// Also math.inverseLerp, mapLinear, smoothstep, radToDeg, euclideanModulo.
math.random(); math.seed(42); math.randFloat(lo, hi); math.randInt(lo, hi); math.randFloatSpread(r);
color.fromHex(out, '#ff8800');            // linear RGB from an sRGB hex value
color.fromSrgb(out, r, g, b); color.fromHsl(out, h, s, l); color.srgbToLinear(c); color.linearToSrgb(c);

time.now; time.frame;                     // seconds, frame counter
time.dt;                                  // later in 0.1: the frame's step in seconds; until then use onUpdate's dt
```

- Each helper writes its result into its first argument, `out`, and returns it. Inputs can be tuples such as `[0, 1, 0]`, plain arrays or typed arrays. Make `out` arrays with `create()`, never in per-frame code.
- Angles are in radians. `quat.fromEuler` takes three.js's axis orders; gl-matrix's function of that name takes degrees.
- `quat.lookAt` gives a mesh's rotation. For a camera or a light, which looks down -Z, swap `eye` and `target`.
- `math.random` draws from one generator per thread. `math.seed(n)` makes a run repeatable. Hold mode seeds it and routes `Math.random` to it.
- Color options take `'#rrggbb'` or `'#rgb'` strings, `0xrrggbb` numbers and `[r, g, b]` arrays from 0 to 1, all in sRGB. The engine converts them to linear, as three.js does for hex colors. The `color` helpers give linear RGB, which instance colors take.
