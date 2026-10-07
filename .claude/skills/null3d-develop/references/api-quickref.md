# null3D API quick reference

This is the API of null3D, with the parts planned up to version 1.0. A version in parentheses, such as (0.2), is the first engine version with that part; no number means 0.1. Before using a part, check its docs page's status (`stable`, `experimental` or `planned`) and the note under its title, as SKILL.md section 1 explains. Each heading names the doc ID with the full reference.

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
15. Post-processing (effects 0.2)
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
  depthPrepass: false,   // true draws opaque depth first, so each pixel shades once; presets leave it off
  gpuOcclusion: false,   // true skips objects that marked occluders hide (WebGPU only); presets leave it off
  shadowTiles: 8, shadowTileSize: 512, pointLightShadows: false,  // spot and point light shadows; the preset sets each
  gpu: 'auto',           // 'auto' | 'webgpu' | 'webgl2' (testing only)
  powerPreference: 'high-performance',   // the default; 'low-power' saves battery on devices with two GPUs
  latency: 'pipelined',  // or 'low'; 'pipelined' is the default
  memory: { maximumMiB: 1024 },          // the default; up to 4096 for scenes that need more (E1409 outside 256 to 4096)
  maxLabels: 4096,                       // (0.2) the default; labels that ui.trackLabel holds at once, 1 to 65,536
  onProgress: (stage) => {},             // 'core', then 'sketch' after the setup and any preset check, then 'first-frame'; 'memory-wait' first if the browser refuses memory for 10 s (0.2)
  onSketchMessage: (type, data) => {},     // sketch messages from the start of setup, such as load progress
  signal: controller.signal,             // abort to cancel the start; createEngine then rejects
  hold: 1.5,             // image tests: step the sketch to 1.5 s, draw that one frame, and run no frame loop
  transparent: false,    // true for a see-through canvas, with premultiplied alpha
  sketchThread: 'worker',  // or 'main': sketch code on the page's thread, for DOM-heavy apps and debugging
  largeWorld: false,     // (0.2) true for planet-scale scenes: setters keep positions exact far out
  preload: ['skinning', 'bloom'],  // (0.2) features whose shaders load before the first frame, for games that fetch nothing in play (E1421 for an unknown name)
});
// createEngine rejects with an EngineError when the browser cannot run the engine (error.code)

await engine.firstFrame;                 // the GPU finished the first frame: remove the loading screen
engine.postToSketch('difficulty', { level: 2 });            // an optional third argument lists transferables
const off = engine.onSketchMessage((type, data) => { /* ... */ }); // the first handler also gets earlier messages
off();                                   // every on... call returns a function that removes its handler
engine.detach();                         // single-page apps: canvas off the page, engine paused, scene kept
engine.attach(container);                // canvas back on the page; the engine resumes with no new start
engine.setPaused(true);                  // the first step after resuming counts no time
engine.capabilities;  // { tier: 'webgpu' | 'webgpu-compat' | 'webgl2', threaded, features, limits, hdr, halfPrecision, maxInstances, depth }
engine.mode;          // { build, latency, sketchThread, renderThread, jobWorkers, hold, preset, presetCheck, crashedStarts, memoryMaximumMiB, renderFallback }
const metrics = await engine.measure(5);          // CPU time per thread and phase, GPU time, frame rates, memory
const frame = await engine.captureFrame();        // the next frame's { width, height, pixels }: RGBA8 rows, top row first
engine.onFailure((error) => { /* error.code: E1302 GPU lost for good, E1404 engine thread failed; (0.2) E1304 GPU out of memory, E1305 GPU rejected work */ });
engine.simulateGpuLoss();                         // acts out a driver reset; the engine recovers
await engine.destroy();                 // workers stop; wait before this page starts another engine. (0.2) A new engine can start on the same canvas

const image = await engine.capture();             // PNG Blob of the next frame; E1414 after destroy()
const unbind = engine.labels.bind('hp-12', element);   // (0.2) element follows the sketch's label 'hp-12'
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
    input, time, quality, post, page, debug, engine, preferences,
  } = ctx;
  // (0.2): ctx.render and ctx.ui
  // setup: create objects, load assets, await scene.warmUp()
  // preferences.reducedMotion: true when the user's system asks for less motion
  // preferences.onChange(() => { ... }) runs at the first frame after it changes; it returns a remover
  return {
    onFixedUpdate(step) {},  // 0 to n times per frame at a fixed rate (default 60 Hz), before onUpdate
    onUpdate(dt) {},         // once per frame, before transforms; dt is 0 after a pause, at most 0.25 s
    onLateUpdate(dt) {},     // after transforms, before culling: camera follow; its moves show this frame
    onDestroy() {},          // (0.2) once, as the engine stops: remove timers and listeners; later calls throw E1420
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
| `scene.createMesh({ mesh, material, position, rotation, scale, parent, dynamic, layers, castShadows, receiveShadows, name })` | Mesh | Static unless `dynamic: true` |
| `scene.createInstances(mesh, count, { material, dynamic, colors, layers, origin })` | InstanceBatch; rows are relative to `origin` (0.2) | Section 5 |
| `scene.instantiate(prefab, { name, position, rotation, scale, parent, dynamic, layers, castShadows, receiveShadows })` (0.2) | PrefabInstance | A group holding one copy of a loaded glTF model, made with one batch of changes; `instance.find(name)` gives the copy's object of a node; `layers` reaches every object of the copy; `instance.destroy()` removes the whole copy |
| `scene.clone(obj)` (0.2) | same type | Copies the object and every object below it, lights and cameras included, under the same parent |
| `scene.find(name)` | Object3D or undefined | The first live object with the name; use at setup, not per frame |
| `scene.createPerspectiveCamera({ fov, near, far, position, target, layers })` | PerspectiveCamera | fov is vertical, in degrees. Cameras are dynamic by default |
| `scene.createOrthographicCamera({ height, near, far, position, target, layers })` | OrthographicCamera | Or left, right, top, bottom in place of height |
| `scene.setActiveCamera(camera)` | | The camera the canvas shows |
| `scene.createDirectionalLight(opts)`, `createPointLight`, `createSpotLight`, `createHemisphereLight`, `createAmbientLight` | Light | Section 7 |
| `scene.setBackground('#rrggbb')` or `scene.setBackground(texture)` | | Any color input (section 20), or a texture that fills the view behind every object, as three.js's `scene.background` |
| `scene.setBackground({ sky: { sunPosition, turbidity, rayleigh, mieCoefficient, mieDirectionalG, cloudCoverage, time } })` (0.2) | | three.js's `Sky`, with its uniforms' names and defaults. Clouds move with `time`; `cloudCoverage: 0` draws none. Lights nothing |
| `scene.setEnvironment(env, { intensity, rotation })` (0.2) | | env from `assets.loadEnvironment` or `assets.builtinEnvironment('room')`, or `null`. `rotation` is Euler radians, as three.js's `environmentRotation`. Allocates nothing, so it can turn every frame |
| `scene.setBackground(env or cubemap, { blur, intensity, rotation })` (0.2) | | An environment or a cube map around the scene, as three.js's `backgroundBlurriness`, `backgroundIntensity` and `backgroundRotation`. Only environments blur, at no extra cost. Allocates nothing, so it can change every frame |
| `scene.setFog({ color, curve, density, near, far, height, heightFalloff, sunGlow, sunGlowExponent })` or `null` | | Fog by straight-line distance from the camera. `curve`: `'exponential'` (default, `density` 0.01), `'exp2'` or `'linear'` (`near`, `far`). `heightFalloff` above 0 thins the fog above `height`; `sunGlow` above 0 lights the fog toward the main directional light. The background takes no fog, so give it the fog's color. Materials opt out with `fog: false` |
| `scene.createSprites({ count, map, atlas, sizeAttenuation, center, dynamic, layers, origin, color, opacity, alphaMode, blending })` (0.2) | Promise<SpriteBatch> | Camera-facing quads in one batch; the first call downloads the sprite code: typed arrays `positions` (3), `sizes` (2), `rotations` (1, radians), `colors` (4, linear), `frames` (1, atlas frame from the top left); `markDirty`, `setActiveCount`, `material.set`, as instance batches. Blends by default; `sizeAttenuation: false` gives sizes in CSS pixels. Docs `api/sprites` |
| `scene.createLines({ positions, colors, mode, width, worldUnits, dashed, dashSize, gapSize, dashScale, dashOffset, lit, dynamic, layers, origin, color, opacity, alphaMode, blending })` (0.2) | Promise<LineBatch> | Segments between points in one batch, drawn as quads with round ends at any width; the first call downloads the line code. `mode`: `'strip'` (default), `'loop'` or `'segments'` (pairs). `width` in CSS pixels, or world units with `worldUnits`. Typed arrays `positions` (3 per point) and `colors` (3 per point, linear, 8 bits per channel); `markDirty` takes points; `setActiveCount` takes points; `setWidth`; `material.set` takes the dash values and, with `lit`, the standard values. Docs `api/lines` |
| `scene.createPoints({ positions, colors, size, sizeAttenuation, map, dynamic, layers, origin, color, opacity, alphaMode, blending })` (0.2) | Promise<PointBatch> | Squares of one size that face the camera, in one batch; each point is a sprite row, and the first call downloads the sprite code. `size` in world units, or CSS pixels with `sizeAttenuation: false`. `colors` takes 3 or 4 numbers per point (linear). Typed arrays `positions` (3) and `colors` (4, RGBA); `setSize`, `markDirty`, `setActiveCount`, `material.set`, as instance batches. Opaque by default; a disc `map` with `alphaMode: 'mask'` makes round points. About 215 bytes of engine memory per point. Docs `api/points` |
| `scene.createLod` (0.2) | | Docs `concepts/lod` |
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
mesh.setOutlined(true);              // (0.2) with post.set({ outline }); a copy from scene.instantiate has it too
obj.setOccluder(false);              // (0.2) WebGL2 path: stop this object hiding others; true makes it a blocker
obj.on('click', fn); obj.off('click', fn);  // (0.2) also 'pointerdown', 'pointerup', 'pointermove', 'pointerenter', 'pointerleave'; on parents too
obj.animator();                      // (0.2) section 12
```

Meshes also have these calls. `setCastShadows` and `setReceiveShadows` are stored until shadows draw. `setRenderOrder` orders blended objects before their depth.

```ts
mesh.setMaterial(material);          mesh.setMesh(geometry);       // setMesh brings back the mesh's bounds
mesh.setCastShadows(true);           mesh.setReceiveShadows(true); // false by default, as in three.js
mesh.setRenderOrder(n);                                             // blended objects, lower first
mesh.setFrustumCulled(false);        mesh.setBounds(center, radius);  // center relative to the origin, before scale
mesh.setMorphWeight('Smile', 0.8);   mesh.getMorphWeight(0);       // (0.2) by name or number; E1218 for a target it lacks
mesh.setOccluder(true);              // (0.2) WebGL2: large solid meshes, such as buildings, hide what lies behind them
```

- Getters write into the `out` array you pass, so they allocate nothing. The world getters read the last frame the engine processed. Pass them a plain array or `Float64Array` to keep 64-bit positions.
- Use a setter for static objects; direct array writes are for dynamic objects and batches.
- A parent change with `keepWorld: true` works out the new local transform when the frame applies it, so set the object's transform first.
- These calls rebuild the draw tables, so make them at setup: `setMaterial`, `setMesh`, `setParent`, `setDynamic`, `setBounds`, `setFrustumCulled`, `setCastShadows` and `setReceiveShadows`.
- Blended objects draw after the opaque ones. They draw farthest first, by the center of their bounds. `setRenderOrder` sorts before depth does. An instance batch's rows sort one by one.

## 5. Instance batches (`concepts/instances`)

```ts
const rocks = scene.createInstances(geometry.sphere({ radius: 0.2 }), 10_000, {
  material: materials.standard({ color: '#888888' }),
  dynamic: true,              // uploads every row every frame; false = upload marked rows only
  colors: true,               // adds batch.colors (RGBA, linear, 4 floats per row); stored now, drawn in 0.2
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

`scene.createInstances(prefab, count, { dynamic, colors, layers })` (0.2) draws a loaded model with one batch per mesh, which share their rows: write the returned batch's arrays, and one row moves every part of that copy. The model's lights are left out, and a model with instancing of its own throws E1417. Batches do not skin. A skinned mesh whose rest pose is not its bind pose draws in its bind pose, and development builds warn.

## 6. Cameras (`api/cameras`)

```ts
camera.setNearFar(near, far);     camera.near; camera.far;     // both kinds
camera.isOrthographic;            // false for PerspectiveCamera, true for OrthographicCamera
camera.setFov(deg);               camera.fov;                  // PerspectiveCamera
camera.setOrthoHeight(h);         camera.height; camera.width; // OrthographicCamera; width undefined while it follows the canvas
camera.setLayers(mask);           // the layers it draws: objects whose masks share a layer with it
camera.screenToRay(x, y, ray);    // (0.2) x, y in CSS pixels; ray = { origin: number[3], direction: number[3] }
camera.worldToScreen(p, out);     // (0.2) out = [x, y, depth] in CSS pixels; depth < 0 means behind the camera
```

`screenToRay` at the position of `input.pointer` or a touch uses the camera of the frame on screen at that event. So a click during a fast pan picks what the user saw. Other points, and `worldToScreen`, use the camera of the frame that last ran. Call `worldToScreen` in `onLateUpdate` to line up with the frame being drawn.

An orthographic camera made with `height` follows the canvas's aspect ratio; one made with `left`, `right`, `top` and `bottom` keeps those edges, and `setOrthoHeight` scales them about their center.

## 7. Lights (`api/lights`)

```ts
const sun = scene.createDirectionalLight({ direction: [-1, -2, -1], color: '#fff4e0', intensity: 3,
  castShadows: true, shadow: { cascades: 3, mapSize: 2048, distance: 200, bias: 0.2, normalBias: 0.3 } });
scene.createAmbientLight({ color: '#ffffff', intensity: 0.4 });
scene.createPointLight({ position, color, intensity, range: 10, decay: 2 });   // range is required
scene.createSpotLight({ position, target, angle, penumbra, range: 20, decay, color, intensity,
  castShadows: true, shadow: { bias: 0.2, normalBias: 0.3 } });  // or direction
scene.createHemisphereLight({ skyColor, groundColor, intensity });
// every light also takes the node options: name, position, rotation, parent, dynamic, layers
// castShadows: directional, spot and point lights; point lights cast where pointLightShadows is on

light.setIntensity(v); light.setColor(c);   // every light; setColor allocates, so animate the intensity
light.setDirection(x, y, z);                 // directional and spot lights: the way the light travels
light.setRange(r); light.setDecay(d);        // point and spot lights
light.setAngle(a); light.setPenumbra(p);     // spot lights; angle in radians, up to π/2
light.setGroundColor(c);                     // hemisphere lights; setColor sets the sky
light.setCastShadows(true);                  // directional, spot and point lights
sun.setShadow({ cascades: 2, distance: 80 }); // directional lights; changes only the settings given
spot.setShadow({ bias: 1 });                  // spot and point lights take bias and normalBias alone
light.setVisible(false); light.destroy();    // lights are objects: section 4
```

- Directional and spot lights shine along their -Z axis, so `lookAt` aims them; a directional light's position does not matter. A hemisphere light's sky is its +Y axis.
- three.js aims a directional light from its position to a target. Pass the target minus the position as `direction`, or call `lookAt`.
- A light lights a camera's view when their layer masks share a bit. Without lights, standard materials draw black.
- Units follow three.js r155 and later: point and spot intensity in candela, the others in lux. The same colors and intensities give the same light as in three.js. For real units, give point and spot lights `intensityUnit: 'lumen'` (0.2), and set the camera with `post.set({ ev100: 15 })` (0.2) for a sunny day (`concepts/lighting`).
- Point and spot lights light the surfaces their ranges reach, through clustered lighting, so keep each range as short as the look allows. Surfaces show the first visible directional light, every ambient light, and the point and spot lights. Hemisphere lights light surfaces in 0.2.
- Shadows: that directional light casts them when it has `castShadows`, from meshes with `castShadows` onto meshes with `receiveShadows`. Its cascades fit the camera's view and keep still edges as it turns. The nearest cascade draws every frame, and far ones every few frames (`farCascadeInterval`). A far one that a dynamic object touches draws every frame on every preset. `followMovingCasters: false` keeps its turns, so far moving shadows trail by a few frames. Neighboring cascades blend over a band, a share of each cascade's length (`shadowCascadeBlend`, 0.1). `shadowFilter` softens edges over 3 or 5 texels. Both follow the preset. Defaults: the preset's `shadowCascades` and `shadowMapSize`, 200 m, bias 0.01 m and normal bias 0.02 m. Both are in meters, up to one texel of the surface's cascade, scaled by each surface's angle to the light. The map stores 16-bit depth, so in far cascades a smaller `bias` acts as 1.5 depth steps, about 2 cm 200 m out. Unlit materials show no shadows. Both GPU paths draw them. Instance batches do not cast or receive them yet (`concepts/shadows`).
- Spot and point light shadows: each spot light with `castShadows` takes a tile of the shared shadow atlas, and each point light six. Point lights cast only where the preset's `pointLightShadows` is on (High and Ultra), or with that `createEngine` option. The preset's `shadowTiles` caps the tiles, and the lights that look largest on screen get them first. `shadowTileSize` sets each tile's texels. All three are `createEngine` options. A tile draws again only when its light moves, or a caster in its view moves, changes its layers or changes its pose. So still scenes cost nothing per frame, and at most 12 tiles draw again in a frame. The biases are in meters, up to one texel of the tile, and `shadowFilter` softens its edges too (`concepts/shadows`).

## 8. Geometry (`api/geometry`)

`ctx.geometry` has `box`, `sphere`, `plane`, `cylinder`, `cone`, `torus`, `capsule`, `circle` and `ring`, with the same parameters and defaults as the three.js geometry classes, as named options (for example `geometry.sphere({ radius, widthSegments, heightSegments })`). They build three.js's vertices, texture coordinates included. A mesh keeps the vertices its generator built, so turn, move or scale the object, not the mesh: three.js's `geometry.rotateX()` has no match. The package `@null3d/geometry` (0.2) adds `torusKnot`, `icosahedron`, `octahedron`, `tetrahedron`, `dodecahedron`, `polyhedron`, `lathe`, `extrude`, `shape` and `tube`.

```ts
const mesh = geometry.fromArrays({
  positions,                // 3 numbers per vertex: a Float32Array or a number[]
  normals,                  // 3 per vertex, or computeNormals: true instead
  uvs, uvs1, colors,        // 2, 2, and 3 or 4 per vertex; colors are linear
  tangents,                 // 4 per vertex, or computeTangents: true (needs uvs)
  joints, weights,          // (0.2) 4 per vertex each, together; skinning itself comes later in 0.2
  indices,                  // Uint16Array, Uint32Array or number[]; omit for one triangle per 3 vertices
  morphTargets: { positions: [smile, blink], normals, names: ['Smile', 'Blink'] },  // (0.2) deltas, 3 per vertex per target
  // morphTargets.colors: color deltas, as many per vertex as colors; morphed colors clamp to 0..1
});
mesh.radius;                // the distance from the mesh's origin to its farthest vertex
mesh.morphTargets;          // (0.2) the target count; mesh.morphTargetNames lists their names
mesh.destroy();             // (0.2) after the objects and batches that use it, in the same frame or before; E1111 while one does
geometry.memoryBytes;       // (0.2) GPU bytes of every mesh; destroyed meshes give their room to later ones
mesh.updateVertices('positions', data, start, count);  // (0.2) vertices that change at run time
```

(0.2) Each attribute also takes the 8-bit and 16-bit integer arrays that glTF's `KHR_mesh_quantization` allows. The GPU keeps them as integers, at half or a quarter of the floats' size. Plain integers read as whole numbers; `{ array, normalized: true }` reads them as fractions, as three.js's `BufferAttribute` does. Normals and tangents take `Int8Array` or `Int16Array`, colors and weights `Uint8Array` or `Uint16Array`, and joints `Uint8Array`, `Uint16Array` or whole numbers. Integer positions keep their units, so scale the object to meters, as a glTF node does. A mesh keeps the attributes it gets in their types. Meshes whose attributes have the same types share GPU buffers, so pass only the attributes the materials use. Bad arrays throw E1206, and a generator option that is not a finite number throws E1203. `api/geometry` covers vertex formats and meshes over 65,535 vertices.

## 9. Materials (`api/materials`)

```ts
const paint = materials.standard({
  color: '#e8554e',                            // base color (sRGB), converted to linear once
  metalness: 0, roughness: 1,                  // glTF metallic-roughness, three.js's defaults
  emissive: '#000000', emissiveIntensity: 1,   // light the surface gives off itself
  ior: 1.5, specularIntensity: 1, specularColor: '#ffffff',  // (0.2) non-metal reflection, as three.js's physical material
  opacity: 1,                                  // part of the alpha that 'mask' tests and 'blend' blends
  doubleSided: false, vertexColors: false, flatShading: false,  // fixed at creation
  alphaMode: 'opaque', alphaCutoff: 0.5,       // 'mask' cuts out below the cutoff; 'blend' shows through
  blending: 'normal',                          // with 'blend': 'normal', 'additive' or 'multiply'
  depthWrite: true, depthTest: true,           // fixed at creation
  depthBias: { constant: 0, slopeScale: 0 },   // three.js's polygonOffset, for decals
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
  specularIntensityMap: spec, specularColorMap: tint,  // (0.2) linear alpha; sRGB color, as three.js's physical material
  envIntensity: 1,                   // (0.2) the scene environment's light on this material
  uvTransform: { repeat: [4, 2], offset: [0, 0], rotation: 0 },  // every map shares it; set() changes it
});
const decal = materials.unlit({ map: color, alphaMode: 'mask', alphaCutoff: 0.5 });  // map alpha cuts the shape

const stripes = materials.shader({ ...standardOptions, wgsl, uniforms });  // any standard option but the maps; wgsl: a tagged /* wgsl */ literal or .wgsl import with fn surface, fn vertexOffset or both, or a full shader
stripes.set({ speed: 2, roughness: 0.3 });  // uniforms of struct Uniforms and standard values alike
const worn = materials.shader({ wgsl, textures: { detail, wear } });  // (0.2) each `var detail: texture_2d<f32>;` of the WGSL, sampled with detailSampler
worn.destroy();   // (0.2) objects that still use it draw nothing; its place frees once none does
```

- `materials.standard` shades as three.js's `MeshStandardMaterial` does, with its formulas and its table of specular terms.
- `fog: false` keeps a material's color out of the scene's fog (`scene.setFog`).
- `materials.shader` keeps the standard look and lighting, and a WGSL surface function changes the surface before the engine lights it. Every `materials.standard` option but the texture maps feeds `defaultSurface()`. `references/shaders.md` has the contract.
- A map reads the texture coordinates that its texture's `uvSet` names, and a mesh without a second set gives its first. A mesh without texture coordinates draws the material without its maps. A normal map takes its frame from the mesh's tangents (`computeTangents: true`) where the mesh has them, and otherwise from the pixels around it, as three.js does.
- `alphaMode: 'mask'` with `alphaCutoff` draws nothing where the alpha falls below the cutoff, as three.js's `alphaTest`. `alphaMode: 'blend'` is three.js's `transparent: true`, and `blending` picks `'normal'`, `'additive'` or `'multiply'`. Blended objects cost culling and sorting in every frame, so use `'mask'` for cut-out shapes. `depthWrite`, `depthTest` and `depthBias: { constant, slopeScale }` set the depth state.
- Full shaders work in `materials.shader`: a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one (`guides/custom-shaders`). They take no textures.
- (0.2) A custom material's `textures` option gives the textures that its WGSL declares, up to 6, fixed at creation. `references/shaders.md` section 4 has the rules. Standard texture maps do not reach `materials.shader`.
- (0.2) `material.destroy()` frees a material that no object needs, as three.js's `material.dispose()`. Objects that still use it draw nothing, and later calls with it throw E1101. Its textures stay: destroy them apart.
- `envIntensity` (0.2) scales the scene environment's light on one standard material, times `setEnvironment`'s `intensity`. `materials.shadowCatcher` comes in 0.2.
- `set()` changes values cheaply at any time. Options that change the shader or the pipeline are fixed when you create the material: the texture maps, `doubleSided`, `vertexColors`, `flatShading`, `alphaMode`, `blending`, `fog` and the depth options. So create each variant before play, and switch with `setMaterial`.

## 10. Textures (`api/textures`)

```ts
const tex = await assets.loadTexture('/tex/bricks.png', {  // PNG, JPEG, WebP or AVIF
  colorSpace: 'srgb',        // 'srgb' for color maps; 'linear' for normal, roughness, metalness, AO
  flipY: true,               // default, as three.js's TextureLoader; glTF textures use false
  wrap: 'repeat',            // 'clamp' (default) | 'repeat' | 'mirror', or [u, v]
  filter: 'linear',          // or 'nearest'
  mipmaps: true,             // the default for images; false for data
  anisotropy: 8,             // 1 to 16; the default, 1, is off
  uvSet: 0,                  // which UV set the map uses (three.js texture.channel)
  premultipliedAlpha: false, // true to store color multiplied by alpha
});
// KTX2 of ETC1S or UASTC data (basisu, toktx): the device's compressed format, with the file's mip levels
const floor = await assets.loadTexture('/tex/floor.ktx2', { wrap: 'repeat' }); // color space from the file
floor.format;              // 'astc-4x4-unorm' | 'bc7-rgba-unorm' | 'etc2-rgb8unorm' | 'etc2-rgba8unorm' | 'rgba8unorm'
// KTX2 of UASTC HDR data (0.2): 'bc6h-rgb-ufloat' with BC formats, else 'rgb9e5ufloat'; always linear
const lamp = await assets.loadTexture('/tex/lamp-hdr.ktx2');
// KTX2 rows stay as the file holds them (first row at v = 0): encode with basisu -y_flip for planes; no flipY
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
- `textures.fromPass(pass)` (0.2) gives the texture of a scene pass from `render.addPass` (section 16).
- Cube maps come from `assets.loadCubemap` (0.2), section 11.

Use KTX2 for large textures, above all on phones: a compressed texel takes a quarter or an eighth of the GPU memory of RGBA8. Encode mip levels into the file (`basisu -mipmap`), since the GPU cannot make them for compressed texels. UASTC keeps more detail, and ETC1S makes smaller files. The first KTX2 file downloads the transcoder, about 365 KB after Brotli. A page without KTX2 files downloads none of it. The engine keeps transcoded textures in the browser's Cache Storage (0.2), so a repeat visit skips the transcoder; nothing to set up (`api/assets`). A texture from a KTX2 file takes no `update`.

On WebGL2 the maps of one standard material share six textures on the GPU. Maps of one size, format and sampling count once, but each KTX2 map counts on its own. Past six, the material draws without its specular maps, then its light map (`api/textures`). Pack occlusion, roughness and metalness into one map, as glTF does.

## 11. Assets (`api/assets`)

```ts
assets.onProgress((loaded, total, url) => page.post('loading', loaded / total));  // returns a remover
await assets.preload(['/tex/bricks.png', '/level.json']);      // later loads take these from memory
const data = await assets.loadJson('/level.json');             // also loadBinary, loadTexture
const bitmap = await assets.loadImageBitmap('/ui/logo.png', { colorSpace, flipY, premultipliedAlpha });
// relative addresses resolve against the page; errors: E1411 download, E1412 decode, E1413 CORS
const ship = await assets.loadGltf('/models/ship.glb');        // (0.2) Prefab
const upload = await assets.loadGltf(userFile, { rewriteUrl: (a) => (a.origin === location.origin ? a : null) }); // (0.2) check the addresses a user's model names
ship.find('Turret');       // (0.2) a node: { name, position, rotation, scale, mesh, material }
ship.bounds;               // (0.2) { center, radius, min, max } of the whole model
ship.materials;            // (0.2) the file's materials; set() changes every copy
ship.clips;                // (0.2) clip names, which a copy's animator plays
const env = await assets.loadEnvironment('/env/sunset.ktx2');  // (0.2) from `bunx @null3d/cli assets env`
const hdr = await assets.loadEnvironment('/hdri/sunset_2k.hdr');  // (0.2) .hdr or .exr, filtered on the GPU at load
const room = await assets.builtinEnvironment('room');          // (0.2) three.js's RoomEnvironment, made on the GPU; no file. Ask while loading: the next frame makes it whole (50-110 ms on phones)
const sky = await assets.loadCubemap([px, nx, py, ny, pz, nz]);  // (0.2) square faces in three.js's order, for scene.setBackground
const lut = await assets.loadLut('/grade.cube');                // (0.2) .cube or .3dl; lut.size, lut.title, lut.destroy()
ship.destroy();   // (0.2) frees its meshes, materials, textures, skeleton and clips; destroy its copies first, else E1111
```

Every load runs outside the sketch's frames, so a frame never waits for a download or a decode. Loads of one address at the same time share one download.

## 12. Animation (0.2) (`api/animation`)

```ts
const hero = scene.instantiate(await assets.loadGltf('/hero.glb')); // skins and clips load with the model
const anim = hero.animator();           // the copy's group animates; throws E1218 on an object without clips
anim.clips;                             // the clip names
anim.play('run', { fade: 0.2, loop: true, speed: 1 });  // loop: false holds the last frame
anim.crossFade('walk', 0.3);            // = play('walk', { fade: 0.3 }); the layer's other clips fade out
anim.play('walk', { time: 0.4 });       // starts 0.4 s in, so a crowd steps out of time
anim.play('run', { weight: 0.3 });      // a weight joins the layer's clips instead of fading them out
anim.setWeight('run', 0.6);             // 0 or more, on a clip that plays; free to call every frame
anim.playBlend({ idle: 0, walk: 1.4, run: 4 }, { fade: 0.2 });  // a 1D blend: clips at points
anim.setBlend(speed);                   // free every frame; the blend's clips keep one phase
const RUN = Object.freeze({ fade: 0.3 }); // frozen options and points are read once: switches allocate nothing
anim.play('wave', { layer: 1, fade: 0.2 });              // layers 0 to 3; each replaces the pose below
anim.setLayerMask(1, 'Spine');          // upper body only: the joint and every joint below it
anim.setLayerWeight(1, 0.5);            // 0 to 1; free to call every frame
anim.play('breathe', { layer: 2, additive: true });      // adds its change from its first frame
anim.setTimeScale(0.5);                 // 0 pauses the object's clips
const off = anim.onEvent('footstep', (e) => page.post('sfx', e.clip));  // also 'loop' and 'finished'
anim.stop('walk', { fade: 0.3 });
anim.stop();                            // every clip; the object holds its rest pose
anim.setJointOverride('Head', rotation); // later in 0.2: procedural aiming
const twin = scene.clone(hero);         // the clone gets an animator of its own
// Joints are not objects. Meshes under bones (a sword in a hand) follow their joints.
// Clips also animate a model's morph weights, blended with the weights that setMorphWeight sets.

// after 1.0: scene.animateProperty(lamp, 'light.intensity', { times: [0, 1, 2], values: [0, 5, 0], loop: true });
```

Sampling and blending run on job workers; there is no update call. Playing a clip that already plays keeps its time, so calling `play` again costs nothing. Event handlers get one reused object, so copy what you keep. They run at the start of the next frame, before `onUpdate`.

## 13. Raycasting and queries (0.2) (`api/raycast`)

```ts
const ray = { origin: [0, 0, 0], direction: [0, 0, -1] };
const hit: RaycastHit = { object: null, instance: -1, point: vec3.create(), normal: vec3.create(), distance: 0, triangle: -1 };
const opts = { maxDistance: 100, layers: PICKABLE };   // layers default: layer 0 alone, as three.js
camera.screenToRay(input.pointer.x, input.pointer.y, ray);   // (0.2) not built yet
if (scene.raycast(ray.origin, ray.direction, opts, hit)) { /* hit.object, hit.point, hit.normal */ }
scene.raycastAny(origin, direction, opts);             // true or false; fastest: line of sight
const n = scene.raycastAll(origin, direction, opts, hits);   // every triangle hit, nearest first
scene.raycastBatch(rays, opts, { distances });         // 6 numbers per ray; job workers; -1 = miss
scene.overlapSphere(center, radius, opts, out);        // objects with a triangle in the sphere
scene.overlapBox(min, max, opts, out);                 // returns the count, as overlapSphere
scene.raycast(o, d, { pointThreshold: 0.2, lineThreshold: 0.1 }, hit);   // three.js's Points and Line thresholds
sprites.on('click', (e) => select(e.instance));        // sprite, point and line batches take pointer events
```

Hit objects are the same wrappers you created; `hit.instance` is the row of a batch, and `hit.triangle` is three.js's `faceIndex`. Raycasts hit sprites, points and lines where they draw, through the active camera. Then `hit.object` is the batch, `hit.instance` the sprite, point or segment, and `hit.triangle` -1. Overlap queries skip them. Queries test triangles, front faces only unless the material is `doubleSided`, and never hit hidden objects. They see the positions of the last frame's update, or this frame's in `onLateUpdate`. A skinned character is tested in its bind pose. A NaN, an infinite number or a direction of length 0 throws in every build (E1203, E1108), so guard computed rays. Create `ray`, `hit`, `opts` and the `hits` and `out` arrays once and reuse them: queries then allocate nothing. The first query after a mesh appears builds its tree, about 0.25 µs per triangle on the job workers. The asset tool's `--bvh <triangles>` stores the trees of large meshes in the file instead (default 20,000).

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

`toneMapping`, `exposure`, `bloom`, `ao`, `outline`, `lut` and `vignette` are built; the other effects come later in 0.2. The default tone mapping is ACES, while three.js defaults to none. Ambient occlusion draws where the quality setting `aoScale` is above 0: on High and Ultra, or after `quality.set({ aoScale: 0.5 })` on phones and tablets.

```ts
post.set({
  toneMapping: 'aces',      // 'aces' | 'agx' | 'neutral' | 'none'
  exposure: 1,
  ev100: 15,                // (0.2) camera exposure for lights in real units; false turns it off
  bloom: { intensity: 0.2, threshold: 1 },  // (0.2) knee, blend ('mix' | 'add' | 'screen') and weights too; false turns it off
  ao: { radius: 0.5, intensity: 1 },     // (0.2) GTAOPass's meanings; darkens only ambient light; false turns it off
  lut, lutIntensity: 0.8,                // (0.2) a table from assets.loadLut, or false; LUTPass's meanings
  vignette: { intensity: 1, size: 1 },   // (0.2) darkens HDR color before the tone curve; falloff (2) and roundness (0) too; false turns it off
  outline: { color: '#ffcc00', width: 3 },  // (0.2) a crisp line, width in CSS pixels; hiddenColor draws it around hidden parts; meshes opt in with setOutlined(true)
});
post.set({ toneMapping: curveWgsl });   // (0.2) WGSL with fn toneCurve(color: vec3f) -> vec3f in place of a built-in curve
const fx = post.addEffect({ wgsl, uniforms: { size: 4 }, order: 0 });  // (0.2) WGSL with fn effect(input: EffectInput) -> vec4f; per-pixel effects join into one pass, at most 8
post.setEffectUniform(fx, 'size', 8);   // (0.2) allocates nothing
post.removeEffect(fx);                  // (0.2)
```

## 16. Render graph (0.2) (`api/render`)

```ts
const map = render.addPass({
  kind: 'scene',                     // a camera draws the scene into a texture
  camera: topCamera,
  writes: 'minimap',                 // the texture's name; other passes list it in reads
  size: [256, 256],                  // pixels
  layers: MAP_LAYER,                 // optional: the camera's layers by default
  clearColor: '#103050',             // optional: the scene's background color by default
});
const screen = materials.unlit({ map: textures.fromPass(map) });
render.setPassEnabled(map, false);   // keeps its last image; allocates nothing
render.removePass(map);              // destroys its textures
render.dumpGraph();                  // Graphviz DOT text of the compiled graph, for debugging
```

- A pass runs only while a texture shows it. It draws the sun, its shadows, the ambient and environment light and fog, but no point or spot lights, no ambient occlusion and no sky for now.
- Full-screen passes of your own WGSL come later in 0.2: use `post.addEffect` for now.

Passes are declarations: the engine checks them, orders them, and shares memory between their temporary textures. No sketch code runs during rendering.

## 17. Quality (`api/quality`)

```ts
quality.preset;                         // 'low' | 'medium' | 'high' | 'ultra': the preset the engine runs
quality.settings.maxPixelRatio;         // the settings in use
quality.set({ maxPixelRatio: 1.5 });    // from the next frame; E1213 for another setting or value
quality.renderScale;                    // the part of the canvas's width and height the scene draws at now
quality.set({ minRenderScale: 0.5, maxRenderScale: 1 });  // the range dynamic resolution moves in; 1 and 1 turn it off
quality.set({ maxAnisotropy: 4, uploadBytesPerFrame: 2 * 1024 * 1024 });  // texture sampling cap, upload bytes per frame
quality.settings.antialias;             // 'msaa' | 'fxaa' | 'none', fixed at the start; set it with createEngine's option
quality.settings.depthPrepass;          // true when opaque depth draws first; fixed at the start, as antialias is
quality.settings.gpuOcclusion;          // true when the GPU skips hidden opaque objects; fixed at the start
quality.set({ shadowFilter: 5, farCascadeInterval: 1 });  // shadow edge softness, 3 or 5 texels; far cascades every frame
quality.set({ followMovingCasters: false }); // far cascades keep their turns while dynamic casters move in them (on by default)
quality.set({ shadowCascadeBlend: 0.2 });  // blend each cascade into the next over its last 20% (0 hands over at once)
quality.governor.steps;                 // the governor's steps past the render scale; onChange runs after each
quality.governor.farCascadeInterval;    // the shadow settings drawn now, which the governor may lower
quality.set({ governor: false });       // no governor: maxRenderScale, and the shadow settings as set
quality.settings.shadowCascades;        // cascades of lights that name none; fixed at the start, with shadowMapSize
quality.settings.morphTargets;          // (0.2) most morph weights per object on WebGL2, the largest; fixed at the start
await quality.setPreset('low');         // the live settings take Low's values; start-time ones stay; resolves once its frame is on screen
const PARTICLES = { low: 500, medium: 2000, high: 5000, ultra: 10000 };  // your values per preset, in one table
quality.onChange(() => { particles.setActiveCount(PARTICLES[quality.preset]); });
quality.setBudget({ name: 'ai', ms: 2, onScale: (scale) => { aiRate = scale; } });  // (0.2)
engine.mode.preset;                     // on the page: the preset, crashedStarts and memoryMaximumMiB
engine.mode.presetCheck;                // what the preset check measured: { from, targetFps, rounds, reused }, or null
```

The page's `?preset=low` switch fixes the preset for tests. After a start that crashed the tab, the engine starts one preset lower. When the engine chose the preset itself, it checks it with the scene that the setup built. It lowers the preset until the GPU holds the frame rate, before `createEngine` resolves, and keeps the settings that the setup changed with `quality.set`. The `setPreset` call keeps the last frame on screen until the new preset's pipelines are built. So call it from a menu or a loading screen. Dynamic resolution lowers the render scale by 0.05 after about a second over budget, and raises it after 5 seconds with time to spare. Hold mode draws at `maxRenderScale`. When the scale reaches `minRenderScale` and frames still run long, the frame-budget governor makes far shadow cascades draw less often, then uses the lighter shadow filter. It raises them again in the reverse order after a stable period.

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
debug.skeleton(hero, color);                    // (0.2) skin joints: blue at the joint, green at its parent

debug.stats(true);                       // overlay on the canvas: fps, CPU ms per thread and phase, tier, preset, render scale
const s = debug.frameStats();            // the same figures: s.presentedFps, s.completedFps, s.cpuMs, s.threads, s.drawCalls
debug.view('normals');                   // 'lit' | 'normals' | 'depth' | 'wireframe' | 'overdraw' | 'shadows'; 'lit' draws the materials again
debug.shadowCamera(player);              // place the sun's shadow cascades from another camera; no argument goes back
```

Debug drawing and `debug.view` exist in development builds only. In a production build every drawing call and `debug.view` do nothing, and the build holds none of their code. A debug view replaces every material until the next call, clears to black and skips tone mapping. Lines are one pixel wide, and objects in front of them hide them. `debug.stats` and `debug.frameStats` work in every build. The figures are means over the last half second. They are 0 for about half a second after the first call. `frameStats()` allocates nothing, so you can call it every frame. The object changes, so copy it with `JSON.parse(JSON.stringify(s))` before you send it. For GPU time and memory, call `engine.measure(seconds)` on the page (section 1).

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
