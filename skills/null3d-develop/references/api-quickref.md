# null3D API quick reference

This is the API of null3D, with the parts planned up to version 1.0. A number in parentheses, such as (0.2), names the roadmap step that adds the part, and no number means step 0.1. The first release, null3D 0.1.0, holds steps 0.1, 0.2 and 0.3; "not built yet" marks a part that the engine lacks today. Before using a part, check its docs page's status (`stable`, `experimental` or `planned`) and the note under its title, as SKILL.md section 1 explains. Each heading names the doc ID with the full reference.

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
21. Tasks on the job workers (0.3)

## 1. Page: createEngine (`api/engine`)

```ts
import { createEngine } from '@null3d/engine';

const engine = await createEngine({
  canvas,                                        // HTMLCanvasElement, sized by CSS
  sketch: new URL('./sketch.ts', import.meta.url),   // the sketch module
  preset: 'auto',        // 'auto' | 'low' | 'medium' | 'high' | 'ultra'; WebGL2 runs at most 'medium'
  targetFps: 'display',  // (0.2) the frame rate that the preset check and governor defend: 'display' for 120 or 144 Hz games, or a whole number; default the display's rate, at most 60
  maxPixelRatio: 2,      // cap for devicePixelRatio in place of the preset's cap
  antialias: 'msaa',     // 'msaa' | 'fxaa' | 'none' in place of the preset's mode (FXAA on Low, MSAA above)
  depthPrepass: false,   // true draws opaque depth first, so each pixel shades once; presets: on for WebGL2, off for WebGPU
  gpuOcclusion: false,   // true skips objects that marked occluders hide (WebGPU only); presets leave it off
  softwareOcclusion: false,  // the same on WebGL2, on the job workers; presets leave it off; measure before keeping it
  keepTextureCopies: true,   // (0.2) default true on phones and tablets, false on desktops: keep each texture's copy, so its map comes back after a GPU loss; false frees the copy (concepts/backends)
  shadowTiles: 8, shadowTileSize: 512, pointLightShadows: false,  // spot and point light shadows; the preset sets each
  gpu: 'auto',           // 'auto' | 'webgpu' | 'webgl2' (testing only)
  powerPreference: 'high-performance',   // the default; 'low-power' saves battery on devices with two GPUs
  latency: 'pipelined',  // or 'low'; 'pipelined' is the default
  memory: { maximumMiB: 1024 },          // the default; up to 4096 for scenes that need more (E1409 outside 256 to 4096)
  maxLabels: 4096,                       // (0.2) the default; labels that ui.trackLabel holds at once, 1 to 65,536
  maxLabels3d: 256,                      // (0.2) the default; labels that are planes of the scene, 0 to 65,536
  expectedObjects: 22000,                // (0.2) the scene starts with room for this many objects (default 1,023) and never grows in play; it grows on its own past it
  onProgress: (stage) => {},             // 'core', then 'sketch' after the setup and any preset check, then 'first-frame'; 'memory-wait' first if the browser refuses memory for 10 s (0.2)
  onSketchMessage: (type, data) => {},     // sketch messages from the start of setup, such as load progress
  onSketchError: (error) => {},            // (0.2) each distinct error the sketch's own code threw in a frame; the engine keeps drawing
  signal: controller.signal,             // abort to cancel the start; createEngine then rejects
  hold: 1.5,             // image tests: step the sketch to 1.5 s, draw that one frame, and run no frame loop
  transparent: false,    // true for a see-through canvas, with premultiplied alpha
  hdr: true,             // false draws the 8-bit path, where toneMapped: false keeps a material's exact color
  sketchThread: 'worker',  // or 'main': sketch code on the page's thread, for DOM-heavy apps and debugging
  largeWorld: false,     // (0.2) true for planet-scale scenes: setters keep positions exact far out
  preload: ['skinning', 'bloom'],  // (0.2) features whose shaders load before the first frame, for games that fetch nothing in play (E1421 for an unknown name)
  stats: true,           // (0.2) the stats overlay from the first frame, or { collapsed: true }; ?stats shows it too, ?stats=off hides it
});
// createEngine rejects with an EngineError when the browser cannot run the engine (error.code)

await engine.firstFrame;                 // the GPU finished the first frame: remove the loading screen
engine.postToSketch('difficulty', { level: 2 });            // an optional third argument lists transferables
const off = engine.onSketchMessage((type, data) => { /* ... */ }); // the first handler also gets earlier messages
off();                                   // every on... call returns a function that removes its handler
engine.detach();                         // single-page apps: canvas off the page, engine paused, scene kept
engine.attach(container);                // canvas back on the page; the engine resumes with no new start
engine.setPaused(true);                  // the first step after resuming counts no time
engine.capabilities;  // { tier: 'webgpu' | 'webgpu-compat' | 'webgl2', threaded, features, limits, hdr, halfPrecision, maxInstances, maxCanvasSize, depth, directDraws }
engine.mode;          // { build, latency, sketchThread, renderThread, jobWorkers, hold, preset, presetCheck, crashedStarts, memoryMaximumMiB, renderFallback, keepTextureCopies }
const metrics = await engine.measure(5);          // CPU time per thread and phase, GPU time, frame rates, memory
//   metrics.updatedFps: (0.2) frames per second whose scene update ran to its end; metrics.updateErrors: frames whose update threw
engine.stats(true);                               // (0.2) the stats overlay on or off from the page, or options; the sketch's debug.stats shares it
const frame = await engine.captureFrame();        // the next frame's { width, height, pixels }: RGBA8 rows, top row first
engine.onFailure((error) => { /* error.code: E1302 GPU lost for good, E1404 engine thread failed; (0.2) E1304 GPU out of memory, E1305 GPU rejected work */ });
engine.onSketchError((error) => { /* (0.2) the sketch's update threw; the engine keeps drawing, and measure().updateErrors counts the frames */ });
engine.simulateGpuLoss();                         // acts out a driver reset; the engine recovers
await engine.destroy();                 // workers stop; wait before this page starts another engine. (0.2) A new engine can start on the same canvas
await engine.destroy({ release: true }); // (0.2) also frees the memory that the page keeps about 30 s for the next engine

const image = await engine.capture();             // PNG Blob of the next frame; E1414 after destroy()
const unbind = engine.labels.bind('hp-12', element);   // (0.2) element follows the sketch's label 'hp-12'
await engine.requestPointerLock();                // (0.2) in a click handler, for first-person controls; E1425 when refused
// engine.registerVideo and textures.fromVideo come in 0.3; recipe 14 shows the workaround
```

In hold mode, `createEngine` resolves after the held frame, and `engine.captureFrame()` returns that frame. The page's `?hold=<seconds>` switch does the same and wins over the option (`guides/testing`).

## 2. Sketch: defineSketch and the context (`api/sketch`)

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async (ctx) => {
  const {
    scene, assets, materials, geometry, textures,
    input, time, quality, post, page, debug, engine, preferences,
    render, ui,  // (0.2)
  } = ctx;
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
| `scene.createInstances(mesh, count, { material, dynamic, colors, layers, origin, castShadows, receiveShadows })` | InstanceBatch; rows are relative to `origin` (0.2); shadow options hold for every row (0.2) | Section 5 |
| `scene.instantiate(prefab, { name, position, rotation, scale, parent, dynamic, layers, castShadows, receiveShadows })` (0.2) | PrefabInstance | A group holding one copy of a loaded glTF model, made with one batch of changes; `instance.find(name)` gives the copy's object of a node; `layers`, `castShadows` and `receiveShadows` reach every object of the copy and the rows of its instance batches; `instance.destroy()` removes the whole copy |
| `scene.clone(obj)` (0.2) | same type | Copies the object and every object below it, lights and cameras included, under the same parent |
| `scene.find(name)` | Object3D or undefined | The first live object with the name; use at setup, not per frame |
| `scene.createPerspectiveCamera({ fov, near, far, position, target, layers })` | PerspectiveCamera | fov is vertical, in degrees. Cameras are dynamic by default |
| `scene.createOrthographicCamera({ height, near, far, position, target, layers })` | OrthographicCamera | Or left, right, top, bottom in place of height |
| `scene.setActiveCamera(camera)` | | The camera the canvas shows |
| `scene.createView({ camera, rect })` (0.3) | SceneView | Draws the scene again from `camera` into a rectangle of the canvas, after the camera's view and in the same frame: a split screen or a picture in picture. `rect` is `[x, y, width, height]` as fractions from the canvas's top-left. `view.setCamera`, `view.setRect` (a layout change, not every frame), `view.destroy()` |
| `scene.createDirectionalLight(opts)`, `createPointLight`, `createSpotLight`, `createHemisphereLight`, `createAmbientLight` | Light | Section 7 |
| `scene.setBackground('#rrggbb')` or `scene.setBackground(texture)` | | Any color input (section 20), or a texture that fills the view behind every object, as three.js's `scene.background` |
| `scene.setBackground({ sky: { sunPosition, turbidity, rayleigh, mieCoefficient, mieDirectionalG, cloudCoverage, time } })` (0.2) | | three.js's `Sky`, with its uniforms' names and defaults. Clouds move with `time`; `cloudCoverage: 0` draws none. Lights nothing by itself: `assets.skyEnvironment()` lights with it |
| `scene.setBackground({ atmosphere: { sunPosition, sunIntensity, haze, aerialPerspective, metersPerUnit, moonPosition, moonIntensity, stars, cloudCoverage, time } })` (0.2) | | The physical sky: Rayleigh, Mie and ozone, twilight, moon and stars. Its air also hazes distant objects (`aerialPerspective: 0` turns that off). The sun's light is in a directional light's units. The Low preset draws the analytic sky in its place |
| `scene.setEnvironment(env, { intensity, rotation })` (0.2) | | env from `assets.loadEnvironment`, `assets.builtinEnvironment('room')` or `assets.skyEnvironment()`, or `null`. `rotation` is Euler radians, as three.js's `environmentRotation`. Allocates nothing, so it can turn every frame |
| `scene.setLightProbeGrid({ texture, origin, spacing, counts, intensity, environmentWeight })` (0.2) | | a grid of irradiance probes from an `rgba16float` 3D texture. Its light replaces the environment's diffuse light, so colored bounce and sky occlusion reach every surface. Pass `null` to remove it |
| `scene.createReflectionProbe({ box: { min, max }, position, blend, intensity, boxProjection, refresh, layers, priority })` (0.2) | `ReflectionProbe` | Lights the surfaces in `box` with the scene around `position` (default: the box's center), in place of the environment, with box-projected reflections. At most 16. `refresh: 'once'` (default) or `'always'`. `probe.set(options)`, `probe.capture()`, `probe.destroy()`. Throws E1430 past 16 probes |
| `bakeProbes(scene, { box, spacing, samples, environment, environmentOptions, albedo })` then `bake.step(n)` / `bake.grid.toTexture(textures)` (0.2) | | bakes the grid in the browser over `scene.raycastBatch`: sky light and occlusion, plus one colored bounce from `albedo`, no lamps. Give `environmentOptions` the intensity and rotation of `scene.setEnvironment`. `spacing` is meters between probes, 2 by default. `step(n)` bakes `n` probes and returns true when all are done. Then pass `{ texture: bake.grid.toTexture(textures), origin, spacing, counts }` from `bake.grid` to `scene.setLightProbeGrid` |
| `scene.setBackground(env or cubemap, { blur, intensity, rotation })` (0.2) | | An environment or a cube map around the scene, as three.js's `backgroundBlurriness`, `backgroundIntensity` and `backgroundRotation`. Only environments blur, at no extra cost. Allocates nothing, so it can change every frame |
| `scene.setFog({ color, curve, density, near, far, height, heightFalloff, sunGlow, sunGlowExponent, volumetric })` or `null` | | Fog by straight-line distance from the camera. `curve`: `'exponential'` (default, `density` 0.01), `'exp2'` or `'linear'` (`near`, `far`). `heightFalloff` above 0 thins the fog above `height`; `sunGlow` above 0 lights the fog toward the main directional light. `volumetric: true` or `{ intensity, anisotropy, distance }` (0.2) lights the fog with the sun and the point and spot lights through their shadows (light shafts), in place of `sunGlow`; it needs HDR color and the quality setting `fogSlices` above 0 (Medium and up). The background takes no fog, so give it the fog's color. Materials opt out with `fog: false` |
| `scene.createSprites({ count, map, atlas, sizeAttenuation, center, dynamic, layers, origin, color, opacity, alphaMode, blending })` (0.2) | Promise<SpriteBatch> | Camera-facing quads in one batch; the first call downloads the sprite code: typed arrays `positions` (3), `sizes` (2), `rotations` (1, radians), `colors` (4, linear), `frames` (1, atlas frame from the top left); `markDirty`, `setActiveCount`, `material.set`, as instance batches. Blends by default; `sizeAttenuation: false` gives sizes in CSS pixels. Docs `api/sprites` |
| `scene.createLines({ positions, colors, mode, width, worldUnits, dashed, dashSize, gapSize, dashScale, dashOffset, lit, dynamic, layers, origin, color, opacity, alphaMode, blending })` (0.2) | Promise<LineBatch> | Segments between points in one batch, drawn as quads with round ends at any width; the first call downloads the line code. `mode`: `'strip'` (default), `'loop'` or `'segments'` (pairs). `width` in CSS pixels, or world units with `worldUnits`. Typed arrays `positions` (3 per point) and `colors` (3 per point, linear, 8 bits per channel); `markDirty` takes points; `setActiveCount` takes points; `setWidth`; `material.set` takes the dash values and, with `lit`, the standard values. Docs `api/lines` |
| `scene.createVertexDraw({ shader, vertices, instances, bounds, position, rotation, scale, layers, ...material options })` (0.2) | VertexDraw | A draw with a custom material and a vertex count but no mesh data: the shader makes every vertex from `@builtin(vertex_index)` and `@builtin(instance_index)`, so a frame uploads nothing, whatever the copy count. Blends, so it draws in the transparent pass: `blending`, `depthWrite`, `doubleSided`. `bounds: { center, radius }` is the sphere that culls the whole draw, `setBounds(center, radius)`, `setCounts(vertices, instances)`, `draw.material.set`, `draw.object` for the placement calls, `destroy()`. `null3d::wrap::wrap_relative(p, half)` wraps a camera-relative position in a box around the camera. No textures, no shadow, no raycast. Docs `api/vertex-draws` |
| `scene.createPoints({ positions, colors, size, sizeAttenuation, map, dynamic, layers, origin, color, opacity, alphaMode, blending })` (0.2) | Promise<PointBatch> | Squares of one size that face the camera, in one batch; each point is a sprite row, and the first call downloads the sprite code. `size` in world units, or CSS pixels with `sizeAttenuation: false`. `colors` takes 3 or 4 numbers per point (linear). Typed arrays `positions` (3) and `colors` (4, RGBA); `setSize`, `markDirty`, `setActiveCount`, `material.set`, as instance batches. Opaque by default; a disc `map` with `alphaMode: 'mask'` makes round points. About 215 bytes of engine memory per point. Docs `api/points` |
| `createParticles(ctx, { rate, bursts, lifetime, shape, speed, direction, spread, velocity, follow, subEmitters, gravity, drag, wind, turbulence, groundHeight, groundMode, size, sizeOverLife, colors, colorOverLife, alphaOverLife, intensity, facing, stretch, spin, blending, map, flipbook, softness, nearFade })` from `@null3d/particles` (0.2) | Promise<ParticleSystem> | A GPU particle system: the GPU moves each particle in closed form, and the CPU writes only births. Call `system.update()` every frame in `onLateUpdate`; it allocates nothing. `shape`: `point`, `sphere`, `cone`, `box`, `disc`. `facing`: `camera`, `velocity` (sparks, rain), `ground`, `tumble` (leaves). `colors` takes one color input or two that particles mix; `intensity` above 1 blooms; curves over life up to 16 steps. `follow: object` leaves trails in the world. `particleTextures.glow`, `spark`, `smoke`, `flame`, `rain`, `leaves` make maps in code: spread them into the options. `system.burst(n)`, `system.rate`, `system.emitting`, `system.set(values)`, `system.destroy()`. Docs `api/particles` |
| `createImpostors(scene, { texture, atlas, positions, size, center, colors, alphaMode, color, origin, layers })` and `mergeFarGeometry(parts)` from `@null3d/impostors` (0.2) | Promise<ImpostorBatch>, MeshArrays | Far objects as one sprite batch of camera-facing cards: each card shows the atlas cell nearest the camera. Each frame, call `camera.getWorldPosition(eye)` into an array you keep, then `update(eye)`; it marks only the cards whose view changed, skips a still eye, and allocates nothing. Positions are relative to `origin`; after you write `sprites` rows, call `markDirty(start, count)`. `octahedralAtlas(views)` gives `{ columns, rows }`; `impostorFrame(direction, atlas)` and `frameDirection(frame, atlas)` are inverses a bake and the cards share. `mergeFarGeometry([{ arrays, transform }])` writes copies of a mesh into one mesh's arrays, turning normals and tangents and reversing mirrored copies; `farCellGroups(centers, cellSize)` groups by grid cell. `alphaMode: 'mask'` cuts the cards out; one view shows, with no blend yet. Docs `api/impostors` |
| `createTerrain(ctx, { size, height, resolution, layers, splat, splatResolution, chunkQuads, maxLevel, split, skirt, metalness, castShadows, receiveShadows, maxBlocks, blocksPerUpdate })` from `@null3d/terrain` (0.2) | Terrain | A height field drawn as a camera-centered quadtree of blocks with a splat-mapped surface, built on public APIs. `height` is a function or a `Float32Array` height map; `layers` is one to four `{ map, tile, roughness }`. Call `terrain.update(x, z)` with the camera's ground position in `onUpdate`; it picks blocks again only when the camera crosses a cell, and builds at most `blocksPerUpdate` new blocks per call while the last complete ground stays on screen. `terrain.setVisible(visible)`, `terrain.building`, `terrain.heightAt(x, z)`, `terrain.normalAt(x, z, out)`, `terrain.drawn`, `terrain.triangles`, `terrain.destroy()`. `terrainTextures(textures, { size, seed })` makes grass, soil, rock and snow maps in code. No collision. Docs `api/terrain` |
| `scene.overrideMaterial = material` or `null` (0.3) | | Draws every mesh and instance batch of the main pass with the material, each keeping its mesh, place and instances, as three.js's `scene.overrideMaterial`. Sprites, points, lines and particle systems keep their own materials, and shadow maps keep each object's material. Throws E1223 for a sprite, point or line material |
| `scene.createView({ camera, rect })` (0.3) | View | Split screens; until then, minimaps use a render-to-texture pass (`guides/multiple-views`) |
| `scene.animateProperty(target, path, keyframes)` | PropertyAnimation | Animates one value of a light, a camera, a material or an object, and the engine writes it every frame. `path`: `'light.intensity'`, `'light.color'`, `'light.range'`, `'light.decay'`, `'light.angle'`, `'light.penumbra'`, `'camera.fov'` (degrees), `'camera.near'`, `'camera.far'`, `'camera.height'` (orthographic), a material value that `setUniform` takes, or `'position'`, `'rotation'`, `'scale'`, `'visible'`; the prefix is optional. `keyframes`: `{ times, values, interpolation, loop, speed, time, paused }`, where a key holds 1 number, 3 for a color, a position or a scale, 4 for a rotation, and a cubic key holds an in-tangent, the value and an out-tangent. The animation has `setTime`, `setSpeed`, `setPaused`, `setLoop`, `stop`, `time`, `playing` |
| `scene.raycast(...)` and other queries (0.2) | | Section 13 |
| `await scene.warmUp()` | | Resolves when every pipeline the scene needs is built, hidden objects included |

## 4. Objects and transforms (`api/objects`)

Groups, meshes, cameras and lights are objects, and they share these calls.

```ts
obj.setPosition(x, y, z);            obj.getPosition(out);         // out: number[3] or Float32Array
obj.setPose(position, rotation);    // (0.2) both from arrays: no number crosses the call, for a pose written every frame
obj.setRotation(qx, qy, qz, qw);     obj.getRotation(out);         // quaternion
obj.setRotationEuler(x, y, z, 'XYZ');                               // radians, three.js order names
obj.rotateX(a); obj.rotateY(a); obj.rotateZ(a);                     // about the object's own axes
obj.setScale(x, y, z);               obj.translate(x, y, z);       // along the object's own axes, scale ignored
obj.lookAt(x, y, z);                                                // cameras and lights look down -Z, other objects turn +Z to it
obj.getWorldPosition(out); obj.getWorldQuaternion(out); obj.getWorldMatrix(out);  // last frame; matrix column by column
obj.setParent(parent);               obj.setParent(parent, { keepWorld: true }); obj.setParent(null);
obj.getParent();                                                    // the parent, or null for a root object
obj.setVisible(false);               obj.setDynamic(true);
obj.setLayers(mask);                 obj.getLayers();              // bit n puts it on layer n; no rebuild
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
mesh.shaderId;                       // (0.2) the number a custom material reads as object.id
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
  colors: true,               // adds batch.colors (RGBA, linear, 4 floats per row); drawn from 0.2: multiplies the base color
  values: true,               // (0.2) adds batch.values (4 floats per row), read as object.values in custom WGSL
  layers: 1 << 2,             // every row is on layer 2; the default, 1, is layer 0
  origin: [0, 0, 0],          // (0.2) rows are relative to this point; set it in large worlds
});

rocks.positions;   // Float32Array, 3 floats per row
rocks.rotations;   // Float32Array, 4 floats per row (quaternion x, y, z, w)
rocks.scales;      // Float32Array, 3 floats per row
rocks.colors;      // Float32Array, 4 floats per row, when colors: true
rocks.values;      // (0.2) Float32Array, 4 floats per row, when values: true
rocks.shaderId;    // (0.2) every row's object.id in custom WGSL; input.instance is the row
rocks.count;              // capacity
rocks.setActiveCount(n);  // draw only the first n rows (pooling)
rocks.setBoundingRadius(2400);  // (0.2) every row's sphere, for vertices a shader moves
rocks.setLayers(mask);    // every row's layers; no rebuild (concepts/render-layers)
rocks.setCastShadows(true);  rocks.setReceiveShadows(true);  // (0.2) every row; a change rebuilds the draw tables
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
camera.setFocalLength(85);        camera.focalLength;          // (0.2) the fov of that lens on a full-frame sensor; depth of field takes it
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
  map, castShadows: true, shadow: { bias: 0.2, normalBias: 0.3 } });  // or direction; map is (0.3)
scene.createHemisphereLight({ skyColor, groundColor, intensity });  // (0.2) lights surfaces: sky from +Y, ground from below
scene.createRectAreaLight({ position, direction, width: 3, height: 2, range: 15, color, intensity });  // (0.2) range is required; light leaves along -Z
scene.createTubeLight({ position, direction, length: 2, radius: 0.025, range: 8, color, intensity });  // (0.2) the tube runs along -Z
const day = timeOfDay('goldenHour');  // (0.2) or an hour: { sky, atmosphere, skyIntensity, light, fog, ambient, exposure }, plain values
timeOfDay(17.5, { model: 'physical' });  // (0.2) values that match setBackground({ atmosphere: day.atmosphere })
const cycle = emptyTimeOfDay();             // (0.2) a day cycle calls timeOfDay(hour, {}, cycle): fills it in place, no settings object
scene.createDirectionalLight(cycle.light);  // the sun by day, the moon after sunset
// every light also takes the node options: name, position, rotation, parent, dynamic, layers
// castShadows: directional, spot and point lights; point lights cast where pointLightShadows is on
sun.setShadow({ contactDistance: 0.3 });  // (0.2) contact shadows' reach in meters, 0 = off; drawn where contactShadowSteps > 0 (High and Ultra, and Medium on WebGL2)

light.setIntensity(v); light.setColor(c);   // every light; call from a small step so the browser inlines it
light.setDirection(x, y, z);                 // directional, spot and area lights: the way the light travels, or the tube's axis
light.setRange(r); light.setDecay(d);        // point and spot lights; setRange on area lights too
rect.setSize(width, height); tube.setSize(length, radius);  // (0.2) area lights; the object's scale does not size them
rect.setImage({ width, height, data });     // (0.2) sRGB pixels shown over the light, top row first; null for one color
spot.setMap({ width, height, data });        // (0.3) sRGB pixels projected over the cone; null for one color
light.setAngle(a); light.setPenumbra(p);     // spot lights; angle in radians, up to π/2
light.setGroundColor(c);                     // hemisphere lights; setColor sets the sky
light.setCastShadows(true);                  // directional, spot and point lights
sun.setShadow({ cascades: 2, distance: 80 }); // directional lights; changes only the settings given
sun.setShadow({ distance: 'auto' });          // follow the farthest visible receiver (the default)
spot.setShadow({ bias: 1 });                  // spot and point lights take bias and normalBias alone
light.setVisible(false); light.destroy();    // lights are objects: section 4
```

- Directional and spot lights shine along their -Z axis, so `lookAt` aims them; a directional light's position does not matter. A hemisphere light's sky is its +Y axis.
- three.js aims a directional light from its position to a target. Pass the target minus the position as `direction`, or call `lookAt`.
- A light lights a camera's view when their layer masks share a bit, and then lights every object in it. Its mask also picks the objects that cast its shadows. An object with `castShadows` on a layer that the light lacks casts nothing, with no warning, and the light shines through it. Give the light that layer too, such as `layers: 1 | INTERIOR`. three.js tests casters against the camera's layers instead (`concepts/render-layers`). Without lights, standard materials draw black.
- A fixed shadow `distance` and a camera that zooms out: the whole subject leaves the range at once, so its shadows vanish and pop back. Keep the default, `distance: 'auto'`, or set the distance each frame from the camera's distance to the subject. Round it up on steps of 1.25 that fall a whole step late. The automatic distance measures to the far side of each receiver's bounds, so give far scenery `receiveShadows: false` (`concepts/shadows`).
- Units follow three.js r155 and later: point and spot intensity in candela, the others in lux. The same colors and intensities give the same light as in three.js. For real units, give point and spot lights `intensityUnit: 'lumen'` (0.2), and set the camera with `post.set({ ev100: 15 })` (0.2) for a sunny day (`concepts/lighting`).
- Area lights (0.2): `createRectAreaLight` for windows, screens and soft boxes, `createTubeLight` for neon and fluorescent tubes. Intensity is the surface's brightness in nits, as three.js's `RectAreaLight`. Shiny surfaces show the light's whole shape. They need a `range` and cast no shadows. Each costs a surface several times a point light, so the preset's `areaLights` caps them per frame: 4 on Low to 32 on Ultra. The lights that give the camera the most light shade first, and a light fades across the cap. Put the lights that matter nearest the camera, or make them brightest. They light from the frame after their 19 KB table file downloads with the first one. A failed download reports E1431 (`api/lights`).
- Spot light maps (0.3): the `map` option and `setMap({ width, height, data })` take sRGB pixels, top row first, and the light projects them over its cone. The picture fills the square around the cone, so a circle in its middle lands on the cone's edge. Its top row follows the world's up, as three.js aims the camera that projects `light.map`, so aim the light rather than rolling it. Its colors and brightness tint the light. The engine resamples it to 128 x 128 texels with mip levels, and up to 32 lights show one at once, rectangle lights included. `setMap(null)` goes back to one color (`api/lights`).
- Point and spot lights light the surfaces their ranges reach, through clustered lighting, so keep each range as short as the look allows. Surfaces show the first visible directional light, every ambient light, every hemisphere light (0.2), and the point and spot lights. Hemisphere lights are diffuse only and add to an environment's light; the environment's `intensity` and a material's `envIntensity` do not scale them. A scene lit by the sky's environment needs no hemisphere light.
- Shadows: that directional light casts them when it has `castShadows`, from meshes with `castShadows` onto meshes with `receiveShadows`. Its cascades fit the camera's view and keep still edges as it turns. The nearest cascade draws every frame, and far ones every few frames (`farCascadeInterval`). A far one that a dynamic object touches draws every frame on every preset. `followMovingCasters: false` keeps its turns, so far moving shadows trail by a few frames. Neighboring cascades blend over a band, a share of each cascade's length (`shadowCascadeBlend`, 0.1). `shadowFilter` softens edges over 3 or 5 texels. Both follow the preset. Defaults: the preset's `shadowCascades` and `shadowMapSize`, the automatic `distance`, bias 0.01 m and normal bias 0.02 m. Both are in meters, up to one texel of the surface's cascade, scaled by each surface's angle to the light. The map stores 16-bit depth. In far cascades a smaller `bias` then acts as 1.5 depth steps, about 2 cm 200 m out. Unlit materials show no shadows. Both GPU paths draw them. Instance batches take `castShadows` and `receiveShadows` in `createInstances`, or `batch.setCastShadows(true)` / `setReceiveShadows(true)`, for every row (0.2); sprite, point and line batches take none (`concepts/shadows`).
- A hero shadow fits a map to one object: `sun.setShadow({ hero: object })` (0.2), with `castShadows` on that object. Surfaces near it read the tile instead of the cascades. It suits one subject in close-up; for several, aim a shadowed spot light at each. `hero: null` turns it off (`concepts/shadows`).
- Spot and point light shadows: each spot light with `castShadows` takes a tile of the shared shadow atlas, and each point light six. Point lights cast only where the preset's `pointLightShadows` is on (High and Ultra), or with that `createEngine` option. The preset's `shadowTiles` caps the tiles, and the lights that look largest on screen get them first. `shadowTileSize` sets each tile's texels. All three are `createEngine` options. A tile draws again only when its light moves, or a caster in its view moves, changes its layers or changes its pose. So still scenes cost nothing per frame, and at most 12 tiles draw again in a frame. The biases are in meters, up to one texel of the tile, and `shadowFilter` softens its edges too (`concepts/shadows`).

## 8. Geometry (`api/geometry`)

`ctx.geometry` has `box`, `sphere`, `plane`, `cylinder`, `cone`, `torus`, `capsule`, `circle` and `ring`, with the same parameters and defaults as the three.js geometry classes, as named options (for example `geometry.sphere({ radius, widthSegments, heightSegments })`). They build three.js's vertices, texture coordinates included. A mesh keeps the vertices its generator built, so turn, move or scale the object, not the mesh: three.js's `geometry.rotateX()` has no match. The package `@null3d/geometry` (0.2) adds `torusKnot`, `icosahedron`, `octahedron`, `tetrahedron`, `dodecahedron`, `polyhedron`, `lathe`, `extrude`, `shape` and `tube`, with three.js's options. Each returns arrays for `geometry.fromArrays`: `geometry.fromArrays(torusKnot({ radius: 1, tube: 0.4 }))`. It also has `Shape`, `Path`, the curves (such as `CatmullRomCurve3`) and `ShapeUtils`, with points as `[x, y]` or `[x, y, z]` arrays.

```ts
const mesh = geometry.fromArrays({
  positions,                // 3 numbers per vertex: a Float32Array or a number[]
  normals,                  // 3 per vertex, or computeNormals: true instead
  uvs, uvs1, colors,        // 2, 2, and 3 or 4 per vertex; colors are linear
  tangents,                 // 4 per vertex, or computeTangents: true (needs uvs)
  joints, weights,          // (0.2) 4 per vertex each, together, for skinning
  indices,                  // Uint16Array, Uint32Array or number[]; omit for one triangle per 3 vertices
  morphTargets: { positions: [smile, blink], normals, names: ['Smile', 'Blink'] },  // (0.2) deltas, 3 per vertex per target
  // morphTargets.colors: color deltas, as many per vertex as colors; morphed colors clamp to 0..1
});
mesh.radius;                // the distance from the mesh's origin to its farthest vertex
mesh.morphTargets;          // (0.2) the target count; mesh.morphTargetNames lists their names
mesh.destroy();             // (0.2) after the objects and batches that use it, in the same frame or before; E1111 while one does
geometry.memoryBytes;       // (0.2) GPU bytes of every mesh; destroyed meshes give their room to later ones
mesh.updateVertices('positions', positions, start, count);  // (0.2) new values of every vertex, same array type; start/count pick vertices; no allocation
mesh.setLevels([{ mesh: mid, error: 0.02 }, { mesh: far, distance: 80, material: farShading }]);  // (0.2) levels of detail, most detailed first
// every object and batch of `mesh` draws the coarsest level whose switch the distance passes:
// error (in the mesh's units), distance (meters at scale 1) or coverage (a share of the screen height);
// a level given by distance or a hand-set error fades over a band, a measured error switches at once;
// setLevels(levels, { fade: false }) or { fade } on one level switches it at once; switches grow; E1221 for bad levels;
// a level's `material` shades its own way, and a level without one draws with the level before's
object.setLevelBias(0.5);   // (0.2) this object's own threshold: below 1 keeps detail, above 1 turns coarse sooner
object.setDrawRange(8, 120);   // (0.2) draw only between 8 m and 120 m, fading at each edge; batch.setDrawRange too
```

(0.2) Each attribute also takes the 8-bit and 16-bit integer arrays that glTF's `KHR_mesh_quantization` allows. The GPU keeps them as integers, at half or a quarter of the floats' size. Plain integers read as whole numbers; `{ array, normalized: true }` reads them as fractions, as three.js's `BufferAttribute` does. Normals and tangents take `Int8Array` or `Int16Array`, colors and weights `Uint8Array` or `Uint16Array`, and joints `Uint8Array`, `Uint16Array` or whole numbers. Integer positions keep their units, so scale the object to meters, as a glTF node does. A mesh keeps the attributes it gets in their types. Meshes whose attributes have the same types share GPU buffers, so pass only the attributes the materials use. Bad arrays throw E1206, and a generator option that is not a finite number throws E1203. `api/geometry` covers vertex formats and meshes over 65,535 vertices. `updateVertices` (0.2) takes `positions`, `normals`, `uvs`, `uvs1`, `colors` and `tangents`. Update the normals with the positions, because the engine does not compute them again. The mesh keeps the bounding sphere it was made with, so give objects whose vertices move outside it bounds with `setBounds`. A mesh with joints or morph targets takes no updates. The first update rebuilds the draw tables once, so make it in the setup.

## 9. Materials (`api/materials`)

```ts
const paint = materials.standard({
  color: '#e8554e',                            // base color (sRGB), converted to linear once
  metalness: 0, roughness: 1,                  // glTF metallic-roughness, three.js's defaults
  emissive: '#000000', emissiveIntensity: 1,   // light the surface gives off itself
  ior: 1.5, specularIntensity: 1, specularColor: '#ffffff',  // (0.2) non-metal reflection, as three.js's physical material
  transmission: 0, thickness: 0,              // (0.2) glass and clear water: give transmission at creation to let light through; bends by ior, blurs by roughness
  transmissionMap: tmap, thicknessMap: tmap,  // (0.3) linear: the red multiplies transmission, the green thickness; a material with them takes no specular maps
  attenuationColor: '#ffffff', attenuationDistance: Infinity,  // (0.2) the volume's color over that distance
  diffuseTransmission: 0, diffuseTransmissionColor: '#ffffff',  // (0.2) leaves, petals, ears: light behind shows on the front; give it at creation; the base color does not tint it
  subsurfaceRadius: 0, subsurfaceColor: '#ffffff',  // (0.2) skin 0.012 and [1, 0.4, 0.25], wax, jade: light spreads under the surface; give it at creation; blurs on High and Ultra only
  clearcoat: 0, clearcoatRoughness: 0,        // (0.2) car paint, varnish: give a layer option at creation to have the layers
  sheenColor: '#000000', sheenRoughness: 1,   // (0.2) velvet and cloth; black gives no sheen; no light or specular maps and no diffuseTransmission with layers
  iridescence: 0, iridescenceIor: 1.3, iridescenceThicknessRange: [100, 400],  // (0.3) soap bubbles, beetles, oil: a thin film tints the reflection; no light or specular maps and no coat or sheen maps
  anisotropy: 0, anisotropyRotation: 0,       // (0.3) brushed metal: the highlight stretches along the tangent; needs a map, whose coordinates give the tangent frame
  opacity: 1,                                  // part of the alpha that 'mask' tests and 'blend' blends
  doubleSided: false, vertexColors: false, flatShading: false,  // fixed at creation
  contactShadows: true,                        // (0.2) fixed at creation; false on grass, leaf cards and other thin surfaces that crowd or sway, where contact shadows darken and flicker
  alphaMode: 'opaque', alphaCutoff: 0.5,       // 'mask' cuts out below the cutoff; 'hash' (0.2) draws the share the alpha sets; 'blend' shows through
  alphaToCoverage: true,                       // (0.2) with 'mask': MSAA smooths the cut edges
  forceSinglePass: false,                      // (0.2) with 'blend' and doubleSided: one draw for both faces
  blending: 'normal',                          // with 'blend': 'normal', 'additive', 'multiply' or 'weighted' (0.2)
  depthWrite: true, depthTest: true,           // fixed at creation
  depthBias: { constant: 0, slopeScale: 0 },   // three.js's polygonOffset, for decals
  wireframe: false,                            // (0.2) each triangle's edges as lines, any material
  toneMapped: true,                            // false keeps the display color; works on the 8-bit path, which hdr: false takes
});
const glow = materials.unlit({ color: '#ffcc00' });      // ignores lights, like three.js's MeshBasicMaterial
paint.set({ roughness: 0.4 });  // changes only the options you pass; set() is for setup, several values at once
paint.setUniform('roughness', 0.4);  // one value per call and no allocation: the call for a value a frame changes

const brick = materials.standard({   // maps are fixed at creation; the mesh needs texture coordinates
  map: color,                        // sRGB texture; multiplies color (its alpha multiplies opacity)
  metalnessRoughnessMap: orm,        // linear: roughness in G, metalness in B, as glTF packs them
  aoMap: orm, aoMapIntensity: 1,     // linear: occlusion in R darkens ambient light
  normalMap: normals, normalScale: [1, 1],   // linear, tangent space
  // bumpMap: heights, bumpScale: 1,          // (0.2) linear; a normalMap wins over it
  // displacementMap: heights,                // (0.2) linear; moves vertices along their normals,
  // displacementScale: 1, displacementBias: 0, // shadows and bounds follow; parallax: true adds
                                              // parallax occlusion mapping from the same map
  emissiveMap: glow, emissive: '#ffffff',    // sRGB; multiplies emissive times emissiveIntensity
  lightMap: baked, lightMapIntensity: 1,     // baked light; load it with uvSet: 1
  specularIntensityMap: spec, specularColorMap: tint,  // (0.2) linear alpha; sRGB color, as three.js's physical material
  envIntensity: 1,                   // (0.2) the scene environment's light on this material
  uvTransform: { repeat: [4, 2], offset: [0, 0], rotation: 0 },  // every map shares it; set() changes it
});
// (0.2) A decal: a mesh of geometry.box() with this material projects it onto every opaque surface in
// the box, lit there. The box's z axis points out of the surface; its x and y sides hold the map.
const decal = materials.decal({ map: color, normalMap: normals, metalnessRoughnessMap: orm,
  angleFade: [Math.PI / 3, (4 * Math.PI) / 9],   // fades on surfaces that turn away from its z axis
  edgeFade: 0.2 });                              // fades near both ends of the box along z
scene.createMesh({ mesh: geometry.box(), material: decal, position, rotation, scale: [2, 2, 0.5] });

const stripes = materials.shader({ ...standardOptions, wgsl, uniforms });  // any standard option but the maps; wgsl: a tagged /* wgsl */ literal or .wgsl import with fn surface, fn vertexOffset or both, or a full shader
stripes.set({ speed: 2, roughness: 0.3 });  // uniforms of struct Uniforms and standard values alike
const worn = materials.shader({ wgsl, textures: { detail, wear } });  // (0.2) each `var detail: texture_2d<f32>;` of the WGSL, sampled with detailSampler
worn.destroy();   // (0.2) objects that still use it draw nothing; its place frees once none does
```

- `materials.standard` shades as three.js's `MeshStandardMaterial` does, with its formulas and its table of specular terms.
- `fog: false` keeps a material's color out of the scene's fog (`scene.setFog`).
- `materials.shader` keeps the standard look and lighting, and a WGSL surface function changes the surface before the engine lights it. Every `materials.standard` option but the texture maps feeds `defaultSurface()`. `references/shaders.md` has the contract.
- A map reads the texture coordinates that its texture's `uvSet` names, and a mesh without a second set gives its first. A mesh without texture coordinates draws the material without its maps. A normal map takes its frame from the mesh's tangents (`computeTangents: true`) where the mesh has them, and otherwise from the pixels around it, as three.js does.
- `alphaMode: 'mask'` with `alphaCutoff` draws nothing where the alpha falls below the cutoff, as three.js's `alphaTest`. `alphaMode: 'blend'` is three.js's `transparent: true`, and `blending` picks `'normal'`, `'additive'` or `'multiply'`. Blended objects cost culling and sorting in every frame, so use `'mask'` for cut-out shapes. (0.2) `blending: 'weighted'` blends smoke, dense particles and crossing panes in any order, as three.js's `OITPassNode` does, where the sort by object would pop. It draws as one layer over the camera's other see-through surfaces, and custom materials and materials with `transmission` do not take it (`api/materials#weighted-blending`). `depthWrite`, `depthTest` and `depthBias: { constant, slopeScale }` set the depth state.
- (0.2) `alphaToCoverage`, on by default, smooths a mask's cut edges with MSAA, for foliage and fences. `false` gives three.js's hard `alphaTest` edges. Without MSAA it is a plain mask. The `'hash'` alpha mode draws a share of the surface that its alpha sets, in a pattern fixed to the mesh. Fades and crossing see-through surfaces then need no sort. A double-sided `'blend'` material draws its back faces, then its front faces, so a glass ball shows its far side. On flat surfaces, `forceSinglePass: true` saves that second draw.
- Full shaders work in `materials.shader`: a `@vertex` entry point that takes an `InstanceIn`, and a `@fragment` one (`guides/custom-shaders`). They take no textures.
- (0.2) A custom material's `textures` option gives the textures that its WGSL declares, up to 6, fixed at creation. `references/shaders.md` section 4 has the rules. Standard texture maps do not reach `materials.shader`.
- (0.2) `material.destroy()` frees a material that no object needs, as three.js's `material.dispose()`. Objects that still use it draw nothing, and later calls with it throw E1101. Its textures stay: destroy them apart.
- `envIntensity` (0.2) scales the scene environment's light on one standard material, times `setEnvironment`'s `intensity`. `materials.shadowCatcher({ color, opacity })` (0.2) makes a ground plane that shows only the main directional light's shadow, where the mesh sets `setReceiveShadows(true)`. The default color is black, as three.js's.
- `set()` changes values cheaply at any time. Options that change the shader or the pipeline are fixed when you create the material. They are the texture maps, `doubleSided`, `vertexColors`, `flatShading`, `alphaMode`, `alphaToCoverage`, `forceSinglePass`, `blending`, `fog`, `toneMapped`, `contactShadows` and the depth options. So create each variant before play, and switch with `setMaterial`.

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
// An OffscreenCanvas drawn in the sketch: refresh only the rectangle that changed, at most 30 times a second
const context = canvas.getContext('2d', { willReadFrequently: true })!;
const screen = textures.fromCanvas(canvas, { refreshHz: 30 });  // the canvas stands upright on a plane
screen.refresh({ x, y, width, height });  // uploads only that rectangle; screen.refresh() reads all of it
tex.update(bitmap);        // a new size is fine; or tex.update(data) of the same size
tex.width; tex.height; tex.bytes;   // size and GPU memory
tex.droppedLevels;         // (0.2) largest mip levels the memory budget dropped, 0 to 3; width and height stay
tex.destroy();
textures.memoryBytes; textures.maxSize;  // GPU bytes of every texture; the largest width or height
```

- Data rows go from the bottom up: the first row is at v = 0. `rgba8unorm` takes a `Uint8Array` or `Uint8ClampedArray`, and `rgba16float` a `Float32Array` or a `Uint16Array` of half floats. Bad data or options throw E1208.
- Textures return at once and upload over the next frames, within each frame's upload budget.
- `scene.setBackground(tex)` shows a texture behind every object. The color set before it shows until its texels are on the GPU.
- `textures.fromPass(pass)` (0.2) gives the texture of a scene or reflection pass from `render.addPass` (section 16).
- `textures.fromCanvas(canvas, { refreshHz })` (0.2) follows an `OffscreenCanvas`. Give the rectangle of the refresh in the canvas's coordinates. A 256 x 256 rectangle is 256 KiB, so a 30 Hz screen stays within the upload budget. The rectangle must lie inside the canvas.
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
const stop = assets.registerGltfExtension({                     // (0.3) an add-on draws a glTF extension's primitives; the parts join the model
  extensions: ['KHR_gaussian_splatting'],                       // load(data, makers) returns { mesh, material } or a list, from makers.geometry and makers.materials
  load: (data, makers) => ({ mesh: makers.geometry.box(), material: makers.materials.unlit({ color: [1, 1, 1] }) }),
});
stop();                                                          // unregisters the handler
ship.find('Turret');       // (0.2) a node: { name, position, rotation, scale, mesh, material, occluder }
ship.bounds;               // (0.2) { center, radius, min, max } of the whole model
ship.materials;            // (0.2) the file's materials; set() changes every copy
ship.clips;                // (0.2) clip names, which a copy's animator plays
const env = await assets.loadEnvironment('/env/sunset.ktx2');  // (0.2) from `bunx @null3d/cli assets env`
const hdr = await assets.loadEnvironment('/hdri/sunset_2k.hdr');  // (0.2) .hdr or .exr, filtered on the GPU at load
const room = await assets.builtinEnvironment('room');          // (0.2) three.js's RoomEnvironment, made on the GPU; no file. Ask while loading: the next frame makes it whole (50-110 ms on phones)
const skyLight = await assets.skyEnvironment();                 // (0.2) the light of setBackground({ sky }); follows the sun by itself, 19 frames after each change
const sky = await assets.loadCubemap([px, nx, py, ny, pz, nz]);  // (0.2) square faces in three.js's order, for scene.setBackground
const lut = await assets.loadLut('/grade.cube');                // (0.2) .cube or .3dl; lut.size, lut.title, lut.destroy()
const made = await assets.lutFromData({ size: 17, data });      // (0.2) 3 or 4 floats (0-1) per texel, red fastest as in .cube; domainMin, domainMax, title
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
anim.play('run', { fade: 0.3, transition: 'inertial' }); // samples only the run: the walk carries on at its speed and eases in
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
anim.setUpdateInterval(4);              // a far crowd: sample this copy's pose once in 4 frames; 1 is every frame
anim.updateInterval;                    // reads it back
const off = anim.onEvent('footstep', (e) => page.post('sfx', e.clip));  // also 'loop' and 'finished'
anim.stop('walk', { fade: 0.3 });
anim.stop();                            // every clip; the object holds its rest pose
const head = anim.joint('Head');        // a joint's index; throws E1218 for a name it lacks
anim.setJointRotation(head, q, 0.5);    // turn halfway from the animated rotation toward q
anim.addJointRotation('Spine', twist);  // turn on top of the clips, in the joint's own frame
anim.clearJoint(head);                  // rotations hold every frame until cleared; 8 per object
const AIM = Object.freeze({ joints: ['Spine', 'Neck', 'Head'], limit: 0.8 }); // radians per joint
anim.lookAt(target, AIM, weight);       // the chain aims its last joint at a world point
anim.lookAt(point);                     // keeps the chain; anim.lookAt(null) stops
const twin = scene.clone(hero);         // the clone gets an animator of its own
// Joints are not objects. Meshes under bones (a sword in a hand) follow their joints.
// Clips also animate a model's morph weights, blended with the weights that setMorphWeight sets.

// Joint overrides (0.2): anim.setJointRotation(joint, q, weight) until anim.clearJoint(joint).
// Property animation: a lamp's intensity pulses, and glTF's KHR_animation_pointer tracks play with the clip.
const pulse = scene.animateProperty(lamp, 'light.intensity', { times: [0, 1, 2], values: [0, 5, 0], loop: true });
pulse.setTime(0.5);                     // any time; setSpeed, setPaused, setLoop, stop
// A glTF file's KHR_animation_pointer tracks move lights, material values and node visibility
// through the animator: copy.animator().play(name) plays them with the clip's time and weights.
```

Sampling and blending run on job workers; there is no update call. Playing a clip that already plays keeps its time, so calling `play` again costs nothing. Event handlers get one reused object, so copy what you keep. They run at the start of the next frame, before `onUpdate`.

## 13. Raycasting and queries (0.2) (`api/raycast`)

```ts
const ray = { origin: [0, 0, 0], direction: [0, 0, -1] };
const hit: RaycastHit = { object: null, instance: -1, point: vec3.create(), normal: vec3.create(), distance: 0, triangle: -1 };
const opts = { maxDistance: 100, layers: PICKABLE };   // layers default: layer 0 alone, as three.js
camera.screenToRay(input.pointer.x, input.pointer.y, ray);   // (0.2)
if (scene.raycast(ray.origin, ray.direction, opts, hit)) { /* hit.object, hit.point, hit.normal */ }
scene.raycastAny(origin, direction, opts);             // true or false; fastest: line of sight
const n = scene.raycastAll(origin, direction, opts, hits);   // every triangle hit, nearest first
scene.raycastBatch(rays, opts, { distances });         // 6 numbers per ray; job workers; -1 = miss
scene.overlapSphere(center, radius, opts, out);        // objects with a triangle in the sphere
scene.overlapBox(min, max, opts, out);                 // returns the count, as overlapSphere
scene.raycast(o, d, { pointThreshold: 0.2, lineThreshold: 0.1 }, hit);   // three.js's Points and Line thresholds
sprites.on('click', (e) => select(e.instance));        // sprite, point and line batches take pointer events
scene.pick(x, y).then((picked) => { /* pixel-exact: the object drawn at a CSS pixel, or null */ });
```

Hit objects are the same wrappers you created. The fields name the same values: `hit.instance` is the row of a batch, and `hit.triangle` is three.js's `faceIndex`. A hit on a mesh with texture coordinates also carries `hit.uv`, where on the surface the ray landed, and `hit.hasUv` says whether to read it. A sprite, a point and a line have none. Pick with `scene.pick(x, y)`: it answers a promise a frame or more later, with `{ object, instance }` or `null`. It tests the pixel that the camera draws: cut-out masks and surfaces thinner than a pixel answer as the image shows them. A scene with a whole shader of your own answers its picks with a raycast instead. So does a scene with a blended or transmissive material, or a sprite, point or line. A raycast ignores masks. Raycasts hit sprites, points and lines where they draw, through the active camera. Then `hit.object` is the batch, `hit.instance` the sprite, point or segment, and `hit.triangle` -1. Overlap queries skip them. Queries test triangles, front faces only unless the material is `doubleSided`, and never hit hidden objects. They see the positions of the last frame's update, or this frame's in `onLateUpdate`. In `setup`, before the first frame, a query first applies the objects that `setup` has created and their transforms. A bake there then sees the built scene. A skinned character is tested in its bind pose. A NaN, an infinite number or a direction of length 0 throws in every build (E1203, E1108), so guard computed rays. Create `ray`, `hit`, `opts` and the `hits` and `out` arrays once and reuse them: queries then allocate nothing. The first query after a mesh appears builds its tree, about 0.25 µs per triangle on the job workers. The asset tool's `--bvh <triangles>` stores the trees of large meshes in the file instead (default 20,000).

## 14. Input (`api/input`) and controls (`api/controls`)

```ts
input.pointer;          // { x, y (CSS pixels), ndcX, ndcY, buttons, dx, dy, dragDx, dragDy, wheel, pinch, isTouch, locked (0.2) }
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
controls.stop();                        // drop the motion damping still carries, as a handover to a route does
createMapControls(ctx, camera);         // pans over the ground
// (0.2) createFlyControls(ctx, camera, { movementSpeed, rollSpeed, dragToLook, autoForward }): WASD RF move, arrows QE turn, the pointer steers
// (0.2) createFirstPersonControls(ctx, camera, { movementSpeed, lookSpeed, pointerSpeed, minPolarAngle, maxPolarAngle }):
//   WASD walks, a drag looks; while input.pointer.locked the mouse turns the view as PointerLockControls do
//   controls.moveForward(d); controls.moveRight(d); controls.getDirection(out); controls.lookAt(x, y, z)
// either camera kind: an orthographic camera zooms by its view height, within minZoom and maxZoom

import { createTransformControls, createDragControls } from '@null3d/controls';
const gizmo = createTransformControls(ctx, camera, { mode: 'translate', space: 'world' });
gizmo.attach(crate);                    // the handles follow this object; gizmo.detach() hides them
gizmo.update(dt);                       // every frame in onUpdate; true when it moved the object
gizmo.dragging; gizmo.axis;             // 'X' | 'Y' | 'Z' | 'XY' | 'YZ' | 'XZ' | 'XYZ' | 'E' | null
// mode: 'translate' | 'rotate' | 'scale'; space: 'world' | 'local' (a scale drag always uses local)
// showX/showY/showZ; size; translationSnap, rotationSnap, scaleSnap; layers (30) and pickLayers (29)
// a press on a handle reaches the handle alone, so a click handler on the object behind it does not hear it
const dragger = createDragControls(ctx, camera, [crate, barrel], { layers: 1 });
dragger.update(dt);                     // true when it moved a held object
dragger.dragging; dragger.hovered;      // the object each names, or null
// a press drags the object over a plane that faces the camera; the right button turns it
```

Input changes once per frame, before `onUpdate`. Give a canvas that takes touch gestures `touch-action: none` in its CSS, or the browser scrolls the page and cancels the touches. When the wheel or a pinch zooms the camera, stop the page from scrolling and zooming with `canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })` on the page.

## 15. Post-processing (`api/post`)

`toneMapping`, `exposure`, `autoExposure`, `bloom`, `ao`, `ssr`, `dof`, `outline`, `lut`, `grading`, `vignette` and `sharpen` are built. A view whose scene stops changing sharpens itself and rests the GPU; `createEngine({ still: false })` draws every frame instead (`concepts/post-processing`). Lit fog is built as a scene setting, `scene.setFog({ volumetric })`, not a post effect. Contact shadows are a directional light's shadow option, `contactDistance`, not a post effect. The default tone mapping is `'agx-punchy'`, AgX with more contrast and color; use `'neutral'` for product views. three.js defaults to none. Ambient occlusion draws where the quality setting `aoScale` is above 0: on High and Ultra, or after `quality.set({ aoScale: 0.5 })` on phones and tablets. Screen-space reflections draw where `ssrScale` is above 0: from Medium up, or after `quality.set({ ssrScale: 0.5 })` on phones. Depth of field draws where `dofSamples` is above 0: from Medium up, or after `quality.set({ dofSamples: 16 })` on Low.

```ts
post.set({
  toneMapping: 'agx-punchy', // the default | 'agx' | 'neutral' | 'aces' | 'none'
  exposure: 1,
  ev100: 15,                // (0.2) camera exposure for lights in real units; false turns it off
  autoExposure: { minEv: -6, maxEv: 2 },  // (0.2) the eye adapts from the camera's exposure: metering, percentiles, centerWeight, speedUp, speedDown, compensation; false turns it off
  bloom: { intensity: 0.2, threshold: 1 },  // (0.2) knee, blend ('mix' | 'add' | 'screen') and weights too; false turns it off
  ao: { radius: 0.5, intensity: 1 },     // (0.2) GTAOPass's meanings; darkens only ambient light; false turns it off
  ssr: { maxDistance: 50, thickness: 0.5 },  // (0.2) smooth opaque surfaces reflect the screen in place of the environment; intensity, maxRoughness (0.5) too; false turns it off
  dof: { aperture: 1.8, focusPoint: [0, 1, 0] },  // (0.2) a camera lens: f-number, focusDistance or a world point, focalLength ('camera'), maxBlur, blades; false turns it off
  lut, lutIntensity: 0.8,                // (0.2) a table from assets.loadLut or lutFromData, or false; LUTPass's meanings
  grading: { whiteBalance: { temperature: 5000 }, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1.04, 1.0, 0.94],
             saturation: 0.9, splitToning: { shadows: '#3a4a7a', highlights: '#f0c088', balance: 0, strength: 0.25 } },  // (0.3) a colorist's controls baked into a table by a job worker; false turns it off
  vignette: { intensity: 1, size: 1 },   // (0.2) darkens HDR color before the tone curve; falloff (2) and roundness (0) too; false turns it off
  outline: { color: '#ffcc00', width: 3 },  // (0.2) a crisp line, width in CSS pixels; hiddenColor draws it around hidden parts; meshes opt in with setOutlined(true)
});
post.set({ toneMapping: curveWgsl });   // (0.2) WGSL with fn toneCurve(color: vec3f) -> vec3f in place of a built-in curve
const fx = post.addEffect({ wgsl, uniforms: { size: 4 }, order: 0 });  // (0.2) WGSL with fn effect(input: EffectInput) -> vec4f; per-pixel effects join into one pass, at most 8
post.addEffect({ wgsl: streakWgsl, bloomLevel: 2 });  // (0.3) WGSL that calls effectBloom(input.uv) reads that level of bloom's chain: a streak or a glare without its own blur; draws in a pass of its own
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
const water = render.addPass({
  kind: 'reflection',                // the camera's view mirrored across a plane, clipped at the plane
  writes: 'water',
  plane: { point: [0, 0, 0] },       // normal: [0, 1, 0] by default
  scale: 0.5,                        // optional: the preset's reflectionScale by default
  every: 1,                          // optional: draw in one frame of every N
});
const half = render.addPass({ kind: 'scene', camera: mapCamera, writes: 'half', scale: 0.5 }); // share of the render size
const blur = render.addPass({
  kind: 'fullscreen',                // an effect's WGSL (fn effect) over a texture of its own
  wgsl: blurWgsl,
  writes: 'blur',
  scale: 0.5,                        // or size: [w, h]
  input: 'outlineMask',              // optional: 'sceneColor' | 'outlineMask'
  textures: { map: textures.fromPass(half) },  // optional: var map: texture_2d<f32> in the WGSL
  uniforms: { radius: 3 },
});
render.setPassUniform(blur, 'radius', 4);   // allocates nothing
post.addEffect({ wgsl: addBlur, textures: { blur: textures.fromPass(blur) } }); // effects take textures too
```

- A pass runs only while a texture shows it or another pass or effect reads it. Scene and reflection passes draw the sun, its shadows, the ambient and environment light and fog. They draw the point and spot lights their view sees, and the scene's background; a scene pass with `clearColor` shows that color instead. A light that only the pass sees casts no shadow there. No pass draws ambient occlusion.
- A custom material reads a reflection with `reflection_uv` from `null3d::reflection` and sets `s.reflection` (`shaders/surface-functions`, recipe 20).
- A full-screen pass's `input.uv` is (0, 0) at its top left. Pass textures hold their bottom row first: sample one at `effectPassUv(input.uv)`. `effectInputSize()` is the input image's size. A pass that reads the scene (input or depth) runs after the camera: materials showing it see the frame before; effects see the same frame.

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
quality.set({ lodThreshold: 1, lodShadowFactor: 2, lodFade: true });  // (0.2) levels of detail: pixels, shadows' factor, distance band fades
quality.governor.steps;                 // the governor's steps past the render scale; onChange runs after each
quality.governor.farCascadeInterval;    // the shadow settings drawn now, which the governor may lower
quality.set({ governor: false });       // no governor: maxRenderScale, and the shadow settings as set
quality.settings.shadowCascades;        // cascades of lights that name none; fixed at the start, with shadowMapSize
quality.settings.morphTargets;          // (0.2) most morph weights per object on WebGL2, the largest; fixed at the start
quality.set({ textureMemoryMiB: 512 }); // (0.2) texture GPU memory budget; past it, textures from files drop mip levels
quality.textureMemory;                  // (0.2) { bytes, budgetBytes, droppedLevels, droppedTextures }; onChange runs on drops
await quality.setPreset('low');         // the live settings take Low's values; start-time ones stay; resolves once its frame is on screen
const PARTICLES = { low: 500, medium: 2000, high: 5000, ultra: 10000 };  // your values per preset, in one table
quality.onChange(() => { particles.setActiveCount(PARTICLES[quality.preset]); });
const ai = quality.setBudget({ name: 'ai', ms: 2, min: 0.25, onScale: (scale) => { aiRate = scale; } });  // (0.2) the governor lowers it in steps of 0.25 before each render-scale step; ai.ms = 2 x scale; ai.remove()
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
ui.trackLabel(panel, 'card', { transform: 'world', offset: [0, 1.4, 0] });      // (0.2) a plane of the scene
ui.trackLabel(head, 'title', { transform: 'billboard', rotation: 0.1 });        // (0.2) faces the camera
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

debug.stats(true);                       // overlay at the canvas's top right: fps, CPU ms per thread and phase, tier, preset, render scale; (0.2) option { collapsed }, a card of work bars against the target, GPU ms, memory, triangles, objects
const s = debug.frameStats();            // the same figures: s.presentedFps, s.completedFps, s.cpuMs, s.threads, s.drawCalls; (0.2) s.gpuMs, s.triangles, s.objects, s.wasmBytes, s.meshBytes, s.gpuTextureBytes, s.gpuBufferBytes
debug.view('normals');                   // 'lit' | 'normals' | 'depth' | 'wireframe' | 'overdraw' | 'shadows' | 'motion'; 'lit' draws the materials again
debug.shadowCamera(player);              // place the sun's shadow cascades from another camera; no argument goes back
```

Debug drawing and `debug.view` exist in development builds only. In a production build every drawing call and `debug.view` do nothing, and the build holds none of their code. A debug view replaces every material until the next call, clears to black and skips tone mapping. `'motion'` instead shows each pixel's motion since the last frame, camera included. Hue is the direction (red right, cyan left), and brightness the length, full at 16 pixels. It catches objects that jump, batch rows that teleport and vertex offsets that stutter. Lines are one pixel wide, and objects in front of them hide them. `debug.stats` and `debug.frameStats` work in every build. The figures are means over the last half second. They are 0 for about half a second after the first call. `frameStats()` allocates nothing, so you can call it every frame. The object changes, so copy it with `JSON.parse(JSON.stringify(s))` before you send it. In 0.2 its first call turns on GPU timing on one frame in eleven for the engine's life. Triangles and objects count every pass, shadow maps included, so an object counts once per pass that draws it. For percentiles of CPU and GPU time and memory, call `engine.measure(seconds)` on the page (section 1). A three.js page shows its own figures in the overlay's panel with `StatsPanel` from `@null3d/engine/stats` (0.2), or as text with `statsText`.

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

## 21. Tasks on the job workers (`api/tasks`, 0.3)

```ts
import { runTask, type Task } from '@null3d/engine';

const sort: Task = {
  name: 'splat-sort',                                   // an add-on's own name
  script: new URL('./sort-task.js', import.meta.url),   // a module that exports run(input, wasm)
  wasm: [{ name: 'sort', url: new URL('./sort.wasm', import.meta.url), what: 'the sorter' }],
};
const answer = await runTask<{ order: number[] }>(sort, { view }, []);  // view: a SharedArrayBuffer
```

- The task runs in a job worker, never in the thread that runs the sketch. A frame never waits for it.
- An answer arrives between two frames, so its `then` callback runs before the next `onUpdate`, and that frame draws what the task wrote.
- A `SharedArrayBuffer` in the input is shared with the worker, not copied. Write it with `Atomics` while the task runs, and read it once the promise resolves.
- Tasks run at the same time in different job workers. Their answers come back in no fixed order.
- A failed task rejects with a `TaskFailure` whose `stage` is `'load'`, `'run'` or `'stopped'`. A WebAssembly file that does not download or compile rejects with an engine error.
