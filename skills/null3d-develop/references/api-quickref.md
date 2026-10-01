# null3D API quick reference

This is the API of null3D, with the parts planned up to version 1.0. A version in parentheses, such as (0.2), is the first engine version with that part; no number means 0.1. "Later in 0.1" marks a part of 0.1 that is not built yet. Before using a part, check its docs page's status (`stable`, `experimental` or `planned`) and the note under its title, as SKILL.md section 1 explains. Each heading names the doc ID with the full reference.

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
15. Post-processing (later in 0.1; effects 0.2)
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
  preset: 'auto',        // 'auto' | 'low' | 'medium' | 'high' | 'ultra'; WebGL2 runs at most 'medium'
  maxPixelRatio: 2,      // cap for devicePixelRatio in place of the preset's cap
  antialias: 'msaa',     // 'msaa' | 'fxaa' | 'none' in place of the preset's mode (FXAA on Low, MSAA above)
  gpu: 'auto',           // 'auto' | 'webgpu' | 'webgl2' (testing only)
  powerPreference: 'high-performance',   // the default; 'low-power' saves battery on devices with two GPUs
  latency: 'pipelined',  // or 'low'; 'pipelined' is the default
  memory: { maximumMiB: 1024 },          // the default; up to 4096 for scenes that need more (E1409 outside 256 to 4096)
  onProgress: (stage) => {},             // 'core', then 'sketch' after the sketch's setup, then 'first-frame'
  onSketchMessage: (type, data) => {},     // sketch messages from the start of setup, such as load progress
  signal: controller.signal,             // abort to cancel the start; createEngine then rejects
  hold: 1.5,             // image tests: step the sketch to 1.5 s, draw that one frame, and run no frame loop
  transparent: false,    // true for a see-through canvas, with premultiplied alpha
  sketchThread: 'worker',  // or 'main': sketch code on the page's thread, for DOM-heavy apps and debugging
  largeWorld: false,     // (0.2) planet-scale scenes: cell-relative positions, batch origins
});
// createEngine rejects with an EngineError when the browser cannot run the engine (error.code)

await engine.firstFrame;                 // the GPU finished the first frame: remove the loading screen
engine.postToSketch('difficulty', { level: 2 });            // an optional third argument lists transferables
const off = engine.onSketchMessage((type, data) => { /* ... */ }); // the first handler also gets earlier messages
off();                                   // every on... call returns a function that removes its handler
engine.detach();                         // single-page apps: canvas off the page, engine paused, scene kept
engine.attach(container);                // canvas back on the page; the engine resumes with no new start
engine.setPaused(true);                  // the first step after resuming counts no time
engine.capabilities;  // { tier: 'webgpu' | 'webgpu-compat' | 'webgl2', threaded, features, limits, maxInstances, depth }
engine.mode;          // { build, latency, sketchThread, renderThread, jobWorkers, hold, preset, crashedStarts, memoryMaximumMiB }
const metrics = await engine.measure(5);          // CPU time per thread and phase, GPU time, frame rates, memory
const frame = await engine.captureFrame();        // { width, height, pixels }: RGBA8 rows, top row first
engine.onFailure((error) => { /* error.code: E1302 GPU lost for good, E1404 engine thread failed */ });
engine.simulateGpuLoss();                         // acts out a driver reset; the engine recovers
await engine.destroy();                 // workers stop; wait before this page starts another engine

const image = await engine.capture();             // PNG Blob of the next frame; E1414 after destroy()
engine.labels.bind('hp-12', element);             // (0.2) HTML label that follows an object
await engine.requestPointerLock();                // (0.2) for first-person controls
// engine.registerVideo and textures.fromVideo come after 1.0; recipe 14 shows the workaround
```

In hold mode, `createEngine` resolves after the held frame, and `engine.captureFrame()` returns that frame. The page's `?hold=<seconds>` switch does the same and wins over the option (`guides/testing`).

## 2. Sketch: defineSketch and the context (`api/sketch`)

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async (ctx) => {
  const {
    scene, assets, materials, geometry, textures,
    input, time, quality, page, debug, engine, preferences,
  } = ctx;
  // later in 0.1: ctx.post; (0.2): ctx.render and ctx.ui
  // setup: create objects, load assets, await scene.warmUp()
  // preferences.reducedMotion: true when the user's system asks for less motion
  // preferences.onChange(() => { ... }) runs at the first frame after it changes; it returns a remover
  return {
    onFixedUpdate(step) {},  // 0 to n times per frame at a fixed rate (default 60 Hz), before onUpdate
    onUpdate(dt) {},         // once per frame, before transforms; dt is 0 after a pause, at most 0.25 s
    onLateUpdate(dt) {},     // after transforms, before culling: camera follow; its moves show this frame
  };
}, { fixedRate: 60, maxFixedSteps: 8 });  // optional; these are the defaults (E1214 out of range)
```

- `setup` can be `async`. The first frame waits for its promise, and `createEngine` resolves only after it. An error it throws makes `createEngine` reject.
- `ctx.engine.viewport` gives `{ width, height, pixelRatio }`: the canvas size in CSS pixels, and the pixel ratio the engine draws with. The engine reads them at the start of each frame. `ctx.engine.capabilities` holds the values of `engine.capabilities` on the page.
- In `onLateUpdate`, `getWorldPosition` already gives this frame's positions, and setters show in the same frame. Structural changes made there, such as creating an object, wait for the next frame.
- Fixed steps fall due from sketch time. The first frame and the first after a pause run none. A frame runs at most `maxFixedSteps` and drops the rest. `time` keeps the frame's values during the steps, so count simulation time with `step`. Read `wasPressed` in `onUpdate`, because some frames run no fixed step.

## 3. Scene (`api/scene`)

| Call | Returns | Notes |
| --- | --- | --- |
| `scene.createGroup({ name, position, rotation, scale, parent, dynamic, layers })` | Group | Empty node for hierarchy |
| `scene.createMesh({ mesh, material, position, rotation, scale, parent, dynamic, layers, castShadows, receiveShadows, name })` | Mesh | Static unless `dynamic: true`. Shadows draw on WebGPU; WebGL2 later in 0.1 |
| `scene.createInstances(mesh, count, { material, dynamic, colors, layers })` | InstanceBatch | Section 5 |
| `scene.instantiate(prefab, { position, rotation, scale, parent })` (0.2) | Node | Creates a loaded glTF model |
| `scene.clone(obj)` (0.2) | same type | Deep copy of a built object |
| `scene.find(name)` | Object3D or undefined | The first live object with the name; use at setup, not per frame |
| `scene.createPerspectiveCamera({ fov, near, far, position, target, layers })` | PerspectiveCamera | fov is vertical, in degrees. Cameras are dynamic by default |
| `scene.createOrthographicCamera({ height, near, far, position, target, layers })` | OrthographicCamera | Or left, right, top, bottom in place of height |
| `scene.setActiveCamera(camera)` | | The camera the canvas shows |
| `scene.createDirectionalLight(opts)`, `createPointLight`, `createSpotLight`, `createHemisphereLight`, `createAmbientLight` | Light | Section 7 |
| `scene.setBackground('#rrggbb')` or `scene.setBackground(texture)` | | Any color input (section 20), or a texture that fills the view behind every object, as three.js's `scene.background` |
| `scene.setBackground({ sky: { turbidity, rayleigh, sunDirection } })` (0.2) | | Sky backgrounds |
| `scene.setEnvironment(env, { intensity, rotation })` (0.2) | | env from `assets.loadEnvironment` |
| `scene.setBackground(env, { blur, intensity, rotation })` (0.2) | | Blurred environment backgrounds |
| `scene.setFog({ type: 'linear', color, near, far })`, `{ type: 'exp2', color, density }` or `null` | | three.js's formulas and defaults. The background takes no fog, so give it the fog's color. Materials opt out with `fog: false` |
| `scene.createSprites`, `createPoints`, `createLines`, `createLod` (0.2) | | Docs `api/sprites`, `api/points`, `api/lines`, `concepts/lod` |
| `scene.createView({ camera, rect })` (after 1.0) | View | Split screens; until then, minimaps use a render-to-texture pass (`guides/multiple-views`) |
| `scene.animateProperty(target, path, keyframes)` (after 1.0) | Animation | Until then, animate values in `onUpdate` |
| `scene.raycast(...)` and other queries (0.2) | | Section 13 |
| `await scene.warmUp()` | | Resolves when every pipeline the scene needs is built, hidden objects included |

## 4. Objects and transforms (`api/objects`)

Groups, meshes, cameras and lights are objects, and they share these calls.

```ts
obj.setPosition(x, y, z);            obj.getPosition(out);         // out: number[3] or Float32Array
obj.setRotation(qx, qy, qz, qw);     obj.getRotation(out);         // quaternion
obj.setRotationEuler(x, y, z, 'XYZ');                               // radians, three.js order names
obj.rotateX(a); obj.rotateY(a); obj.rotateZ(a);                     // about the object's own axes
obj.setScale(x, y, z);               obj.translate(x, y, z);       // along the object's own axes, scale ignored
obj.lookAt(x, y, z);                                                // cameras and lights look down -Z, other objects turn +Z to it
obj.getWorldPosition(out); obj.getWorldQuaternion(out); obj.getWorldMatrix(out);  // last frame; matrix column by column
obj.setParent(parent);               obj.setParent(parent, { keepWorld: true }); obj.setParent(null);
obj.setVisible(false);               obj.setDynamic(true);
obj.setLayers(mask);                                                // bit n puts it on layer n; no rebuild
obj.destroy();                                                      // at the next frame; its children become roots
obj.name;                                                           // string, read-only after creation
obj.setMorphWeight(nameOrIndex, w);  // (0.2)
obj.setOutlined(true);               // (0.2) with post.set({ outline })
obj.setOccluder(false);              // (0.2) WebGL2 path: stop this object hiding others; true makes it a blocker
obj.on('click', fn); obj.off('click', fn);  // (0.2) 'pointerenter', 'pointerleave', 'pointerdown', 'pointerup'
obj.animator();                      // (0.2) section 12
```

Meshes also have these calls:

```ts
mesh.setMaterial(material);          mesh.setMesh(geometry);       // setMesh brings back the mesh's bounds
mesh.setCastShadows(true);           mesh.setReceiveShadows(true); // false by default, as in three.js
mesh.setRenderOrder(n);                                             // transparent objects, lower first
mesh.setFrustumCulled(false);        mesh.setBounds(center, radius);  // center relative to the origin, before scale
```

- Getters write into the `out` array you pass, so they allocate nothing. The world getters read the last frame the engine processed. Pass them a plain array or `Float64Array` to keep 64-bit positions.
- Use a setter for static objects; direct array writes are for dynamic objects and batches.
- A parent change with `keepWorld: true` works out the new local transform when the frame applies it, so set the object's transform first.
- These calls rebuild the draw tables, so make them at setup: `setMaterial`, `setMesh`, `setParent`, `setDynamic`, `setBounds`, `setFrustumCulled`, `setCastShadows` and `setReceiveShadows`.
- Every material draws opaque until transparency comes later in 0.1, so `setRenderOrder` has no effect yet.

## 5. Instance batches (`concepts/instances`)

```ts
const rocks = scene.createInstances(geometry.sphere({ radius: 0.2 }), 10_000, {
  material: materials.standard({ color: '#888888' }),
  dynamic: true,              // uploads every row every frame; false = upload marked rows only
  colors: true,               // adds batch.colors (RGBA, linear, 4 floats per row); drawn later in 0.1
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

The arrays are views of engine memory, which can grow when you create meshes or batches. Read them from the batch each time you use them, such as at the start of `onUpdate`, and do not keep them from the setup. A read allocates nothing.

`scene.createInstances(prefab, count, options)` (0.2) makes one batch per mesh of a loaded model inside a group batch; the arrays are shared, so one write moves every part.

## 6. Cameras (`api/cameras`)

```ts
camera.setNearFar(near, far);     camera.near; camera.far;     // both kinds
camera.isOrthographic;            // false for PerspectiveCamera, true for OrthographicCamera
camera.setFov(deg);               camera.fov;                  // PerspectiveCamera
camera.setOrthoHeight(h);         camera.height; camera.width; // OrthographicCamera; width undefined while it follows the canvas
camera.setLayers(mask);           // the layers it draws: objects whose masks share a layer with it
camera.screenToRay(x, y, ray);    // (0.2) x, y in CSS pixels; ray = { origin: number[3], direction: number[3] }
camera.worldToScreen(p, out);     // (0.2) out = [x, y, depth]; depth < 0 means behind the camera
```

An orthographic camera made with `height` follows the canvas's aspect ratio; one made with `left`, `right`, `top` and `bottom` keeps those edges, and `setOrthoHeight` scales them about their center.

## 7. Lights (`api/lights`)

```ts
const sun = scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#fff4e0', intensity: 3,
  castShadows: true, shadow: { cascades: 3, mapSize: 2048, distance: 200, bias: 0.5, normalBias: 1 } });
scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });
scene.createPointLight({ position, color, intensity, range: 10, decay: 2 });   // range is required
scene.createSpotLight({ position, target, angle, penumbra, range: 20, decay, color, intensity });  // or direction
scene.createHemisphereLight({ skyColor, groundColor, intensity });
// every light also takes the node options: name, position, rotation, parent, dynamic, layers
// castShadows: on directional, point and spot lights; only directional shadows draw yet

light.setIntensity(v); light.setColor(c);   // every light; setColor allocates, so animate the intensity
light.setDirection(x, y, z);                 // directional and spot lights: the way the light travels
light.setRange(r); light.setDecay(d);        // point and spot lights
light.setAngle(a); light.setPenumbra(p);     // spot lights; angle in radians, up to π/2
light.setGroundColor(c);                     // hemisphere lights; setColor sets the sky
light.setCastShadows(true);                  // directional lights cast; point and spot lights store it
sun.setShadow({ cascades: 2, distance: 80 }); // directional lights; changes only the settings given
light.setVisible(false); light.destroy();    // lights are objects: section 4
```

- Directional and spot lights shine along their -Z axis, so `lookAt` aims them; a directional light's position does not matter. A hemisphere light's sky is its +Y axis.
- three.js aims a directional light from its position to a target. Pass the target minus the position as `direction`, or call `lookAt`.
- A light lights a camera's view when their layer masks share a bit. Without lights, standard materials draw black.
- Units follow three.js r155 and later: point and spot intensity in candela. The same colors and intensities give the same light as in three.js.
- Point and spot lights light the surfaces their ranges reach, through clustered lighting, so keep each range as short as the look allows. Surfaces show the first visible directional light, every ambient light, and the point and spot lights. Later in 0.1, hemisphere lights light surfaces.
- Shadows: that directional light casts them when it has `castShadows`, from meshes with `castShadows` onto meshes with `receiveShadows`, in cascades that fit the camera's view. Defaults: 3 cascades, 2,048 texels, 200 m, bias 0.5 and normal bias 1, both in texels of each cascade. Unlit materials show no shadows. WebGPU draws them now, and WebGL2 later in 0.1. Instance batches do not cast or receive them yet (`concepts/shadows`).

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
mesh.radius;                // the distance from the mesh's origin to its farthest vertex
mesh.destroy();             // later in 0.1
mesh.updateVertices('positions', data, start, count);  // (0.2) vertices that change at run time
```

A mesh keeps the attributes it gets, and meshes with the same attributes share GPU buffers, so pass only the attributes the materials use. Bad arrays throw E1206, and a generator option that is not a finite number throws E1203. `api/geometry` covers vertex formats and meshes over 65,535 vertices.

## 9. Materials (`api/materials`)

```ts
const paint = materials.standard({
  color: '#e8554e',                            // base color (sRGB), converted to linear once
  metalness: 0, roughness: 1,                  // glTF metallic-roughness, three.js's defaults
  emissive: '#000000', emissiveIntensity: 1,   // light the surface gives off itself
  opacity: 1,                                  // stored; every material draws opaque for now
  doubleSided: false, vertexColors: false, flatShading: false,  // fixed at creation
});
const glow = materials.unlit({ color: '#ffcc00' });      // ignores lights, like three.js's MeshBasicMaterial
paint.set({ roughness: 0.4 });  // changes only the options you pass; converting a color allocates

const brick = materials.standard({   // maps are fixed at creation; the mesh needs texture coordinates
  map: color,                        // sRGB texture; multiplies color (its alpha multiplies opacity)
  metalnessRoughnessMap: orm,        // linear: roughness in G, metalness in B, as glTF packs them
  aoMap: orm, aoMapIntensity: 1,     // linear: occlusion in R darkens ambient light
  normalMap: normals, normalScale: [1, 1],   // linear, tangent space
  emissiveMap: glow, emissive: '#ffffff',    // sRGB; multiplies emissive times emissiveIntensity
  lightMap: baked, lightMapIntensity: 1,     // baked light; load it with uvSet: 1
  uvTransform: { repeat: [4, 2], offset: [0, 0], rotation: 0 },  // every map shares it; set() changes it
});
const decal = materials.unlit({ map: color, alphaMode: 'mask', alphaCutoff: 0.5 });  // map alpha cuts the shape

const stripes = materials.shader({ ...anyStandardOption, wgsl });  // later in 0.1; wgsl: a tagged /* wgsl */ literal or .wgsl import with fn surface
```

- `materials.standard` shades as three.js's `MeshStandardMaterial` does, with its formulas and its table of specular terms.
- `fog: false` keeps a material's color out of the scene's fog (`scene.setFog`).
- Later in 0.1, `materials.shader` keeps the standard look and lighting, and a WGSL surface function changes the surface before the engine lights it. Every `materials.standard` option feeds `defaultSurface()`. `references/shaders.md` has the contract.
- A map reads the texture coordinates that its texture's `uvSet` names, and a mesh without a second set gives its first. A mesh without texture coordinates draws the material without its maps. A normal map takes its frame from the mesh's tangents (`computeTangents: true`) where the mesh has them, and otherwise from the pixels around it, as three.js does.
- `alphaMode: 'mask'` with `alphaCutoff` draws nothing where the alpha falls below the cutoff, as three.js's `alphaTest`. `depthWrite`, `depthTest` and `depthBias: { constant, slopeScale }` set the depth state.
- Later in 0.1: the `blend` alpha mode, `blending`, and in `materials.shader` uniforms, textures, vertex offsets and full shaders.
- `envIntensity` (0.2) comes with environment lighting, and `materials.shadowCatcher` in 0.2.
- `set()` changes values cheaply at any time. Options that change the shader or the pipeline are fixed when you create the material: the texture maps, `doubleSided`, `vertexColors`, `flatShading`, `alphaMode`, `fog` and the depth options. So create each variant before play, and switch with `setMaterial`.

## 10. Textures (`api/textures`)

```ts
const tex = await assets.loadTexture('/tex/bricks.png', {  // PNG, JPEG, WebP, AVIF where decoded
  colorSpace: 'srgb',        // 'srgb' for color maps; 'linear' for normal, roughness, metalness, AO
  flipY: true,               // default, as three.js's TextureLoader; glTF textures use false
  wrap: 'repeat',            // 'clamp' (default) | 'repeat' | 'mirror', or [u, v]
  filter: 'linear',          // or 'nearest'
  mipmaps: true,             // the default for images; false for data
  anisotropy: 8,             // 1 to 16; the default, 1, is off
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
textures.memoryBytes; textures.maxSize;  // GPU bytes of every texture; the largest width or height
```

- Data rows go from the bottom up: the first row is at v = 0. `rgba8unorm` takes a `Uint8Array` or `Uint8ClampedArray`, and `rgba16float` a `Float32Array` or a `Uint16Array` of half floats. Bad data or options throw E1208.
- Textures return at once and upload over the next frames, within each frame's upload budget.
- `scene.setBackground(tex)` shows a texture behind every object. The color set before it shows until its texels are on the GPU.
- Later in 0.1: KTX2 files through `loadTexture`. `textures.fromPass` (0.2) and cube maps (0.2) follow.

## 11. Assets (`api/assets`)

```ts
assets.onProgress((loaded, total, url) => page.post('loading', loaded / total));  // returns a remover
await assets.preload(['/tex/bricks.png', '/level.json']);      // later loads take these from memory
const data = await assets.loadJson('/level.json');             // also loadBinary, loadTexture
const bitmap = await assets.loadImageBitmap('/ui/logo.png', { colorSpace, flipY, premultipliedAlpha });
// relative addresses resolve against the page; errors: E1411 download, E1412 decode, E1413 CORS
const ship = await assets.loadGltf('/models/ship.glb');        // (0.2) Prefab
ship.animations;           // (0.2) clip names
ship.find('Turret');       // (0.2) a node inside the prefab
ship.bounds;               // (0.2) { center, radius, min, max } of the whole model
const env = await assets.loadEnvironment('/env/studio.ktx2');  // (0.2) from `bunx @null3d/cli assets env`
const studio = assets.builtinEnvironment('studio');            // (0.2) neutral lighting, no download
const sky = await assets.loadCubemap([px, nx, py, ny, pz, nz]);  // (0.2)
const lut = await assets.loadLut('/grade.cube');                // (0.2)
ship.destroy();   // (0.2) frees GPU data once no instance uses it
```

Every load runs outside the sketch's frames, so a frame never waits for a download or a decode. Loads of one address at the same time share one download.

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

import { createMapControls, createOrbitControls } from '@null3d/controls';
const controls = createOrbitControls(ctx, camera, {   // three.js's OrbitControls names and defaults
  target: [0, 1, 0], enableDamping: true, dampingFactor: 0.08,
  minDistance: 2, maxDistance: 30, maxPolarAngle: Math.PI * 0.49, enablePan: true,
});
controls.update(dt);                    // every frame in onUpdate; true when the camera moved
vec3.set(controls.target, 0, 2, 0);     // change the target in place; set any property at any time
controls.rotateLeft(a); controls.pan(dx, dy); controls.dollyIn(0.9);   // from code: keys, a gamepad
createMapControls(ctx, camera);         // pans over the ground; fly and first-person controls (0.2)
// either camera kind: an orthographic camera zooms by its view height, within minZoom and maxZoom
```

Input changes once per frame, before `onUpdate`. Give a canvas that takes touch gestures `touch-action: none` in its CSS, or the browser scrolls the page and cancels the touches. When the wheel or a pinch zooms the camera, stop the page from scrolling and zooming with `canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })` on the page.

## 15. Post-processing (`api/post`)

`toneMapping` and `exposure` are built; everything else comes in 0.2. The default tone mapping is ACES, while three.js defaults to none.

```ts
post.set({
  toneMapping: 'aces',      // 'aces' | 'agx' | 'neutral' | 'none'
  exposure: 1,
  bloom: { strength: 0.8, radius: 0.4, threshold: 0.9 },
  ao: { radius: 0.5, intensity: 1 },     // High and Ultra presets only
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
quality.preset;                         // 'low' | 'medium' | 'high' | 'ultra': the preset the engine runs
quality.settings.maxPixelRatio;         // the settings in use
quality.set({ maxPixelRatio: 1.5 });    // from the next frame; E1213 for another setting or value
quality.set({ maxAnisotropy: 4, uploadBytesPerFrame: 2 * 1024 * 1024 });  // texture sampling cap, upload bytes per frame
quality.settings.antialias;             // 'msaa' | 'fxaa' | 'none', fixed at the start; set it with createEngine's option
quality.set({ shadowCascades: 2 });     // planned: the preset table gives each setting's status
await quality.setPreset('low');         // the live settings take Low's values; start-time ones stay; resolves once its frame is on screen
const PARTICLES = { low: 500, medium: 2000, high: 5000, ultra: 10000 };  // your values per preset, in one table
quality.onChange(() => { particles.setActiveCount(PARTICLES[quality.preset]); });
quality.setBudget({ name: 'ai', ms: 2, onScale: (scale) => { aiRate = scale; } });  // (0.2)
engine.mode.preset;                     // on the page: the preset, crashedStarts and memoryMaximumMiB
engine.mode.presetCheck;                // what the preset check measured: { from, targetFps, rounds }, or null
```

The page's `?preset=low` switch fixes the preset for tests. After a start that crashed the tab, the engine starts one preset lower. When the engine chose the preset itself, it checks it with the scene that the setup built. It lowers the preset until the GPU holds the frame rate, before `createEngine` resolves, and keeps the settings that the setup changed with `quality.set`. The `setPreset` call keeps the last frame on screen until the new preset's pipelines are built. So call it from a menu or a loading screen. The frame-budget governor lowers settings in a fixed order when frames run long, and raises them again after a stable period.

## 18. Messages and UI (`api/page`, `api/ui`)

```ts
// sketch.ts
page.post('score', { value: 10 });      // an optional third argument lists transferables
const stop = page.onMessage((type, data) => { if (type === 'difficulty') level = data.level; });  // returns a remover
ui.trackLabel(unit, 'hp-12', { offset: [0, 2, 0] });   // (0.2)
ui.untrackLabel('hp-12');                               // (0.2)

// page.ts
engine.onSketchMessage((type, data) => { if (type === 'score') scoreEl.textContent = String(data.value); });
engine.postToSketch('difficulty', { level: 2 });
engine.labels.bind('hp-12', document.getElementById('hp-12')!);   // (0.2)
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

Debug drawing exists in development builds only. In a production build every call does nothing, and the build holds none of the drawing code. Lines are one pixel wide, and objects in front of them hide them. For numbers now, call `engine.measure(seconds)` on the page (section 1).

## 20. Math, color and time (`api/math`, `api/time`)

```ts
import { vec3, quat, mat4, math, color } from '@null3d/engine';
const tmp = vec3.create();                // create once in the setup, reuse every frame
vec3.set(tmp, 1, 2, 3); vec3.add(tmp, tmp, other); vec3.normalize(tmp, tmp);
// Also vec3.copy, sub, multiply, scale, scaleAndAdd, negate, cross, lerp, min, max,
// transformQuat, transformMat4; and dot, length, squaredLength, distance, squaredDistance, angle.
quat.setAxisAngle(q, [0, 1, 0], angle); quat.fromEuler(q, x, y, z, 'XYZ'); quat.slerp(q, a, b, t);
quat.lookAt(q, eye, target);              // +Z toward the target, as a mesh looks
// Also quat.create, set, copy, identity, fromMat4, rotationTo, multiply, rotateX/Y/Z, invert, normalize, dot.
mat4.compose(m, position, rotation, scale); mat4.decompose(position, rotation, scale, m);
// Also mat4.create, identity, copy, multiply, invert.
math.clamp(v, lo, hi); math.lerp(a, b, t); math.damp(a, b, lambda, dt); math.degToRad(d);
// Also math.inverseLerp, mapLinear, smoothstep, radToDeg, euclideanModulo.
math.random(); math.seed(42); math.randFloat(lo, hi); math.randInt(lo, hi); math.randFloatSpread(r);
color.fromHex(out, '#ff8800');            // linear RGB from an sRGB hex value
color.fromSrgb(out, r, g, b); color.fromHsl(out, h, s, l); color.srgbToLinear(c); color.linearToSrgb(c);

time.now; time.dt; time.frame;            // seconds, the frame's step in seconds, frame counter
```

- Each helper writes its result into its first argument, `out`, and returns it. Inputs can be tuples such as `[0, 1, 0]`, plain arrays or typed arrays. Make `out` arrays with `create()`, never in per-frame code.
- Angles are in radians. `quat.fromEuler` takes three.js's axis orders; gl-matrix's function of that name takes degrees.
- `quat.lookAt` gives a mesh's rotation. For a camera or a light, which looks down -Z, swap `eye` and `target`.
- `math.random` draws from one generator per thread. `math.seed(n)` makes a run repeatable. Hold mode seeds it and routes `Math.random` to it.
- Color options take `'#rrggbb'` or `'#rgb'` strings and `0xrrggbb` numbers, which are sRGB, and `[r, g, b]` arrays from 0 to 1, which are linear, as three.js's `setRGB` reads them. The engine converts hex colors to linear, as three.js does. The `color` helpers give linear RGB, which color options and instance colors take.
