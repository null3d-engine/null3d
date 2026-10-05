# null3D recipes

Each recipe states the goal, gives the code, explains why it is written that way, and names the docs pages to read. Code runs in `sketch.ts` unless it says `page.ts`. A version in parentheses marks a recipe whose APIs arrive after 0.1. Check the docs status before using them.

## Contents

1. Start a new project
2. Orbit camera around a model
3. Load a glTF model and play its animations (0.2)
4. Thousands of moving objects
5. Pool short-lived objects such as bullets
6. Click to select, with an outline (0.2)
7. HTML labels above objects (0.2)
8. Loading screen with progress and warm-up
9. HTML settings panel that controls the scene
10. Day and night: sun, sky and environment (0.2)
11. Physics with a library in the sketch worker
12. Minimap with a second camera (0.2)
13. Screenshots
14. Video on a surface, with frames from the page
15. Custom full-screen effect (0.2)
16. Very large worlds (0.2)
17. Move a player with keys, a gamepad or touch
18. Camera that follows a moving object

## 1. Start a new project

```sh
mkdir my-project && cd my-project
bun add @null3d/engine
bun add -d vite @null3d/vite-plugin
```

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import null3d from '@null3d/vite-plugin';

export default defineConfig({ plugins: [null3d()] });
```

Add `index.html` with a canvas that CSS sizes and a module script for `page.ts`. Then write `page.ts` and `sketch.ts` as SKILL.md section 2 shows. Run `bunx vite`, and open the address it prints. The Vite plugin sends the cross-origin isolation headers, so the threaded build runs. It also compiles the sketch for its worker and the WGSL in your code. Templates from `bunx @null3d/cli create` come in 0.3. Docs: `getting-started/install`, `getting-started/first-scene`, `getting-started/hosting`.

## 2. Orbit camera around a model

```ts
import { defineSketch } from '@null3d/engine';
import { createOrbitControls } from '@null3d/controls';

export default defineSketch(async (ctx) => {
  const { scene, geometry, materials } = ctx;
  const camera = scene.createPerspectiveCamera({ fov: 45, position: [3, 2, 5], target: [0, 1, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });
  scene.createMesh({ mesh: geometry.box(), material: materials.standard({ color: '#4a8cff' }), position: [0, 1, 0] });
  const controls = createOrbitControls(ctx, camera, {
    target: [0, 1, 0], enableDamping: true, dampingFactor: 0.08,
    minDistance: 1.5, maxDistance: 12, maxPolarAngle: Math.PI * 0.49,
  });
  return { onUpdate(dt) { controls.update(dt); } };
});
```

Controls read forwarded input inside the sketch worker, so the sketch adds no DOM listeners. On the page, give the canvas `touch-action: none` in its CSS, and stop its wheel events from scrolling and zooming the page: `canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })`. Damping only works when `update(dt)` runs every frame, and it takes the same time at every frame rate. Docs: `api/controls`.

## 3. Load a glTF model and play its animations (0.2)

```ts
const heroPrefab = await assets.loadGltf('/models/hero.glb');  // parsed in a worker
const hero = scene.instantiate(heroPrefab, { position: [0, 0, 0], dynamic: true, castShadows: true });
const sword = hero.find('Sword');           // this copy's mesh named Sword, which follows its bone
const anim = hero.animator();               // the copy's group plays the file's clips: heroPrefab.clips
anim.play('idle', { loop: true });

let moving = false;
return {
  onUpdate(dt) {
    const wantMove = input.isDown('KeyW');
    if (wantMove !== moving) {
      anim.crossFade(wantMove ? 'run' : 'idle', 0.25);
      moving = wantMove;
    }
    if (moving) hero.translate(0, 0, -4 * dt);
    debug.skeleton(hero);                   // development builds draw the joints
  },
};
```

The joints of a model's skins, and every node that its clips move, become the copy's skeleton, not objects. So `hero.find('Hips')` finds nothing, and a crowd costs one object per mesh. A mesh that the file puts under a bone, such as a sword in a hand, follows its joint; hide it with `sword.setVisible(false)`. The job workers resample every clip while `loadGltf` waits, so no frame stalls. Every copy shares the prefab's meshes, materials and textures, so load a model once and instantiate it many times. For hundreds of still props, `scene.createInstances(prefab, count)` draws them with batches, and one row places a whole copy. Optimize models first with `bunx @null3d/cli assets optimize models/ public/models/` (0.2): integer vertices and KTX2 textures in a `textures` folder beside each `.glb`. In a Vite project, `import heroUrl from './models/hero.glb?optimized'` (0.2) runs the same steps, cached, and gives the URL for `loadGltf`. Cross-fade on state changes only; calling `play` every frame restarts blending work. A face's morph targets load with the model. The call `(hero.find('Face') as Mesh).setMorphWeight('Smile', 0.8)` sets a weight by name. The file's clips animate the weights too, blended with the ones you set. Set weights in `onUpdate` freely; it allocates nothing. Docs: `api/assets`, `api/animation`, `guides/assets-pipeline`.

## 4. Thousands of moving objects

```ts
import { defineSketch, math } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera({ fov: 60, far: 300, position: [0, 40, 90], target: [0, 10, 0] }));
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });
  const N = 10_000;
  const boids = scene.createInstances(geometry.cone({ radius: 0.1, height: 0.3, radialSegments: 8 }), N, {
    material: materials.standard({ color: '#e0e0e0' }),
    dynamic: true,
  });
  const vel = new Float32Array(N * 3);        // your own data, next to the engine's arrays
  const start = boids.positions;
  for (let i = 0; i < N; i++) {
    start[i * 3] = math.randFloat(-50, 50); start[i * 3 + 1] = math.randFloat(0, 20); start[i * 3 + 2] = math.randFloat(-50, 50);
    vel[i * 3] = math.randFloat(-1, 1); vel[i * 3 + 2] = math.randFloat(-1, 1);
  }
  return {
    onUpdate(dt) {
      const p = boids.positions;              // read the view each frame: engine memory can grow
      for (let i = 0; i < N * 3; i++) p[i] += vel[i] * dt;   // no allocation, no setters
    },
  };
});
```

A dynamic batch uploads all rows every frame, so no `markDirty` call is needed. Small objects need few triangles, so the cones have 8 sides instead of the default 32. Keep per-object data (velocity, health) in your own typed arrays indexed by row. The batch's arrays are views of engine memory, which can grow when you create meshes or batches, so read them in each frame. Docs: `concepts/instances`, `concepts/static-dynamic`.

## 5. Pool short-lived objects such as bullets

```ts
import { defineSketch, math } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, input }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera({ fov: 60, position: [0, 3, 12], target: [0, 0, -10] }));
  const MAX = 512;
  const bullets = scene.createInstances(geometry.sphere({ radius: 0.05 }), MAX, {
    material: materials.unlit({ color: '#ffee88' }), dynamic: true,
  });
  bullets.setActiveCount(0);
  const life = new Float32Array(MAX);
  const dir = new Float32Array(MAX * 3);
  let active = 0;
  let cooldown = 0;

  function fire() {
    if (active === MAX) return;
    const i = active++;
    const p = bullets.positions;
    p[i * 3] = 0; p[i * 3 + 1] = 0; p[i * 3 + 2] = 0;
    dir[i * 3] = math.randFloatSpread(0.4); dir[i * 3 + 1] = math.randFloat(0, 0.3); dir[i * 3 + 2] = -1;
    life[i] = 2;
  }

  return {
    onUpdate(dt) {
      cooldown -= dt;
      if (cooldown <= 0 || input.wasPressed('Space')) { fire(); cooldown = 0.05; }
      const p = bullets.positions;
      for (let i = 0; i < active; i++) {
        life[i] -= dt;
        if (life[i] <= 0) {                 // swap-remove: copy the last live row over this one
          const last = --active;
          p.copyWithin(i * 3, last * 3, last * 3 + 3);
          dir.copyWithin(i * 3, last * 3, last * 3 + 3);
          life[i] = life[last];
          i--;
          continue;
        }
        p[i * 3] += dir[i * 3] * 30 * dt; p[i * 3 + 1] += dir[i * 3 + 1] * 30 * dt; p[i * 3 + 2] += dir[i * 3 + 2] * 30 * dt;
      }
      bullets.setActiveCount(active);
    },
  };
});
```

No objects are created or destroyed during play. `setActiveCount` draws only the live rows, so keep them at the front of the arrays. Unlit bullets need no lights. Docs: `concepts/instances`.

## 6. Click to select, with an outline (0.2)

```ts
post.set({ outline: { color: '#ffcc00', width: 3 } });   // a crisp line, width in CSS pixels

let selected: (typeof units)[number] | null = null;
let clicked = false;
for (const unit of units) {
  unit.on('click', () => {
    clicked = true;
    selected?.setOutlined(false);
    selected = unit;
    unit.setOutlined(true);
    page.post('selected', { name: unit.name });
  });
}
// in onUpdate: a click on nothing clears the selection. Handlers run before onUpdate.
if (input.wasReleased('Mouse0') && !clicked && selected) {
  selected.setOutlined(false);
  selected = null;
}
clicked = false;
```

A click goes to the closest object under the pointer that the camera draws. So a wall in front of a unit takes the click, and the unit behind it stays unselected. A drag that turns the camera is no click. On a model, put the handler on the group that `scene.instantiate` returns: clicks on its parts go on up to it. Each click casts its ray from the frame that was on screen, and a frame with no handlers casts none.

A ray of your own skips objects that should not block, such as effects:

```ts
const PICKABLE = 1 << 1;
const WORLD = 1 << 2;   // walls and terrain: they block the ray
for (const u of units) u.setLayers(1 | PICKABLE);   // layer 0 stays on so cameras still draw it
for (const wall of walls) wall.setLayers(1 | WORLD);
const unitSet = new Set(units);
const ray = { origin: vec3.create(), direction: vec3.create() };
const hit: RaycastHit = { object: null, instance: -1, point: vec3.create(), normal: vec3.create(), distance: 0, triangle: -1 };
// in onUpdate:
if (input.wasPressed('Mouse0')) {
  camera.screenToRay(input.pointer.x, input.pointer.y, ray);
  if (scene.raycast(ray.origin, ray.direction, { layers: PICKABLE | WORLD }, hit) && unitSet.has(hit.object)) {
    /* select hit.object */
  }
}
```

The ray tests units and the walls and terrain on `WORLD`, and returns the nearest hit. Effects stay off both layers, so they never block the ray. Create `ray`, `hit` and `unitSet` once. Docs: `api/input` (pointer events on objects), `api/raycast`, `concepts/render-layers`, `api/post`.

## 7. HTML labels above objects (0.2)

```ts
// sketch.ts
ui.trackLabel(unit, `hp-${id}`, { offset: [0, 2.2, 0] });
page.post('hp', { id, value: 80 });           // only when the value changes
```

```ts
// page.ts: labelsLayer is a div over the canvas with position: absolute; inset: 0; pointer-events: none
const el = document.createElement('div');
el.id = `hp-${id}`;
el.className = 'hp';
labelsLayer.appendChild(el);
const unbind = engine.labels.bind(`hp-${id}`, el);   // centers el over the label; unbind() stops it
engine.onSketchMessage((type, d) => { if (type === 'hp') document.getElementById(`hp-${d.id}`)!.textContent = String(d.value); });
```

The sketch places each label with each frame's camera. The page moves the element over it in the frame on screen, so labels never run ahead of the image. Only value changes travel as messages. The engine sets `visibility: hidden` while the object is hidden, off the camera's layers, or outside its near and far planes. The offset turns and scales with the object, like a `CSS2DObject` child in three.js. The engine holds 4,096 labels by default (`createEngine({ maxLabels })`); more fail with E1219. Docs: `guides/ui-overlays`, `api/ui`.

## 8. Loading screen with progress and warm-up

```ts
// sketch.ts
assets.onProgress((loaded, total) => page.post('loading', loaded / total));
await assets.preload(['/levels/one.json', '/tex/terrain.png', '/tex/rocks.png']);
const level = await assets.loadJson<Level>('/levels/one.json');   // from memory: preload downloaded it
const terrain = await assets.loadTexture('/tex/terrain.png', { wrap: 'repeat', anisotropy: 8 });
buildLevel(scene, level, terrain);
await scene.warmUp();                          // build every pipeline before the first frame
```

```ts
// page.ts
let shown = 0;
const show = (progress: number) => {
  shown = Math.max(shown, progress);           // the bar never moves back
  bar.style.width = `${Math.round(shown * 100)}%`;
};
try {
  const engine = await createEngine({
    canvas,
    sketch: new URL('./sketch.ts', import.meta.url),
    onProgress: (stage) => { if (stage === 'core') show(0.1); },
    onSketchMessage: (type, loaded) => { if (type === 'loading') show(0.1 + 0.8 * (loaded as number)); },
  });
  engine.onFailure((error) => showMessage(`The scene stopped: ${error.message}`));
  await engine.firstFrame;                     // the GPU has finished the first frame
  loadingScreen.remove();
} catch (error) {
  showMessage(`This browser cannot show the scene: ${(error as Error).message}`);
}
```

- Pass `onSketchMessage` to `createEngine`. A handler added after `createEngine` resolves hears the setup's messages only once setup is over, which is too late for a progress bar.
- Remove the loading screen when `engine.firstFrame` resolves, not when setup ends. Until the GPU finishes the first frame, the canvas is blank.
- `createEngine` rejects when the browser cannot run the engine. Examples are Safari before 18 and every iPhone or iPad browser before iOS 18 (E1306), and a browser without WebAssembly SIMD (E1303). Show a message or a still image in place of the canvas.
- `warmUp` resolves once every pipeline that the scene needs is built, hidden objects included. For a later loading stage, create its objects hidden, await it, then show them, so nothing appears late or stalls a frame. The Godot browser port measured seconds of such stalls.

Docs: `guides/loading-screens`, `api/engine`.

## 9. HTML settings panel that controls the scene

```ts
// page.ts (any UI library works here, including lil-gui)
const gui = new GUI();
const settings = { sun: 3, spin: true };
gui.add(settings, 'sun', 0, 6).onChange((v: number) => engine.postToSketch('sun', v));
gui.add(settings, 'spin').onChange((v: boolean) => engine.postToSketch('spin', v));
```

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, page }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera({ fov: 50, position: [0, 1.5, 4], target: [0, 0, 0] }));
  const sun = scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });
  const cube = scene.createMesh({ mesh: geometry.box(), material: materials.standard({ color: '#4a8cff' }), dynamic: true });
  let spin = true;
  page.onMessage((type, value) => {
    if (type === 'sun') sun.setIntensity(value as number);
    if (type === 'spin') spin = value as boolean;
  });
  return { onUpdate(dt) { if (spin) cube.rotateY(dt); } };
});
```

UI libraries need the DOM, so they live on the page. Each change sends one message, and the sketch keeps the value until the next one. Docs: `guides/ui-overlays`, `api/page`.

## 10. Day and night: sun, sky and environment (0.2)

```ts
const sun = scene.createDirectionalLight({ direction: [0, -1, 0], intensity: 3, castShadows: true });
const dir = vec3.create();
let t = 0.3; // 0 = midnight, 0.5 = noon
return {
  onUpdate(dt) {
    t = (t + dt / 240) % 1;                                  // 4-minute day
    const a = t * Math.PI * 2;
    vec3.set(dir, 0.3, -Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2));
    sun.setDirection(dir[0], dir[1], dir[2]);
    const daylight = math.clamp(-dir[1] * 2, 0, 1);
    sun.setIntensity(3 * daylight);
    scene.setBackground({ sky: { sunDirection: dir, turbidity: 8, rayleigh: 2 } });
  },
};
```

Calling `setBackground` every frame is fine: sky parameters are uniform values and do not recompile anything. Docs: `api/scene`, `concepts/lighting`.

## 11. Physics with a library in the sketch worker

```ts
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
const N = 1000;
const crates = scene.createInstances(geometry.box({ width: 1, height: 1, depth: 1 }), N, {
  material: materials.standard({ color: '#a0703c' }), dynamic: true,
});
const bodies = Array.from({ length: N }, (_, i) =>
  world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation((i % 10) * 1.1, 5 + Math.floor(i / 10), 0)));
bodies.forEach((b) => world.createCollider(RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5), b));

return {
  onFixedUpdate() {
    world.step();
    const p = crates.positions, r = crates.rotations;
    for (let i = 0; i < N; i++) {
      const t = bodies[i].translation(), q = bodies[i].rotation();
      p[i * 3] = t.x; p[i * 3 + 1] = t.y; p[i * 3 + 2] = t.z;
      r[i * 4] = q.x; r[i * 4 + 1] = q.y; r[i * 4 + 2] = q.z; r[i * 4 + 3] = q.w;
    }
  },
};
```

WebAssembly physics libraries run in workers. The fixed step keeps the simulation stable at any frame rate. Check the library's own docs for allocation: some return new objects from `translation()`; prefer bulk-read APIs where the library has them. Docs: `guides/physics`.

## 12. Minimap with a second camera (0.2)

```ts
const MAP = 1 << 2;                                    // layer for map-only markers
const mapCamera = scene.createOrthographicCamera({ height: 200, near: 1, far: 500, position: [0, 300, 0], target: [0, 0, 0] });
mapCamera.setLayers(1 | MAP);
render.addPass({ name: 'Minimap', kind: 'scene', camera: mapCamera, writes: 'minimap', size: [256, 256], before: 'Post' });
post.addEffect({
  name: 'minimap-overlay',
  stage: 'final',
  textures: { map: textures.fromPass('minimap') },
  wgsl: /* wgsl */ `
    fn effect(input: EffectInput) -> vec4f {
      let c = sampleScene(input.uv);
      let size = vec2f(256.0) / input.resolution;          // the map's size in screen UV
      let local = (input.uv - vec2f(1.0 - size.x - 0.02, 0.02)) / size;
      if (all(local >= vec2f(0.0)) && all(local <= vec2f(1.0))) {
        return textureSampleLevel(map, mapSampler, local, 0.0);
      }
      return c;
    }`,
});
```

Several full views, such as split screens, come after 1.0 (`guides/multiple-views`). From 0.2, a minimap or picture in picture works with a render-to-texture pass and a final effect. The effect samples the map with `textureSampleLevel` because the branch differs between pixels, and WGSL forbids implicit-mip sampling there (`references/shaders.md`, section 8). Docs: `guides/custom-passes`, `api/post`.

## 13. Screenshots

```ts
// page.ts
shotButton.onclick = async () => {
  const blob = await engine.capture();          // the next frame, as a PNG
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'shot.png' });
  a.click();
};
```

The thread that draws reads the frame back and encodes it, so the canvas needs no `preserveDrawingBuffer`. After `destroy()` the call fails with E1414. For tests, use `bunx @null3d/cli shot` or hold-mode tests instead (`references/testing-and-debugging.md`). Docs: `api/engine`.

## 14. Video on a surface, with frames from the page

Video textures (`engine.registerVideo` with `textures.fromVideo`) come after 1.0. Until then, the page can send frames as `ImageBitmap` objects, which transfer to the sketch without a copy. The sketch's half shows them with an unlit material's map:

```ts
// page.ts
const video = Object.assign(document.createElement('video'), { src: '/intro.mp4', muted: true, loop: true, playsInline: true });
await video.play();
const sendFrame = async () => {
  // flipY: textures take their first row at the bottom, as three.js flips them
  const bitmap = await createImageBitmap(video, { resizeWidth: 640, resizeHeight: 360, imageOrientation: 'flipY' });
  engine.postToSketch('video-frame', bitmap, [bitmap]);   // transfer, do not copy
  video.requestVideoFrameCallback(sendFrame);           // or requestAnimationFrame where this is missing
};
video.requestVideoFrameCallback(sendFrame);
```

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, textures, page }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera({ fov: 50, position: [0, 0, 1.6], target: [0, 0, 0] }));
  // One dark texel until the first frame arrives. Create the material at setup, so no pipeline compiles during play.
  const screen = textures.fromData({ width: 1, height: 1, format: 'rgba8unorm', colorSpace: 'srgb', data: new Uint8Array([24, 24, 24, 255]) });
  scene.createMesh({ mesh: geometry.plane({ width: 16 / 9, height: 1 }), material: materials.unlit({ map: screen }) });
  page.onMessage((type, bitmap) => {
    if (type === 'video-frame') screen.update(bitmap as ImageBitmap);   // a new size is fine
  });
});
```

Each frame costs one decode-and-resize on the page and one upload in the render worker, so keep frames small. Docs: `guides/video-textures`, `api/textures`.

## 15. Custom full-screen effect (0.2)

```ts
post.addEffect({
  name: 'pixelate',
  stage: 'final',                   // runs in the merged final pass, after tone mapping
  uniforms: { size: 4 },
  wgsl: /* wgsl */ `
    fn effect(input: EffectInput) -> vec4f {
      let px = max(effect.size, 1.0);
      let uv = floor(input.fragCoord.xy / px) * px / input.resolution;
      return sampleScene(uv);
    }`,
});
post.setEffectUniform('pixelate', 'size', 8);
```

Per-pixel effects merge into the single final pass, so they add no extra full-screen pass. Effects that read neighboring pixels many times, such as blurs, get their own pass: `stage: 'hdr'`. Docs: `api/post`, `references/shaders.md` section 6.

## 16. Very large worlds (0.2)

```ts
// page.ts
await createEngine({ canvas, sketch, largeWorld: true });
```

```ts
// sketch.ts: keep vertex data small; put large coordinates in object positions and batch origins
const tileCenter = computeTileCenterEcef(x, y, zoom);          // JavaScript numbers are 64-bit
const tile = scene.createMesh({ mesh: buildTileRelativeTo(tileCenter), material });
tile.setPosition(tileCenter[0], tileCenter[1], tileCenter[2]); // stored as a cell plus a small offset

const trees = scene.createInstances(treeMesh, 5000, { material: bark, origin: tileCenter });
// trees.positions rows are relative to the origin, so they stay small and precise
```

The engine stores positions relative to cells 1,024 m wide, and each frame it sends the GPU one camera-to-cell offset per cell in use. So objects millions of meters from the origin do not jitter, and static objects stay on the GPU without re-uploads. With `largeWorld: true`, setters keep each position exact: without it, a position you set moves in steps of 0.5 m at the Earth's radius. Batch origins work in both modes. Vertex positions must be small offsets from their object's center, and batch rows small offsets from the batch origin. At most 512 cells are in use at once: keep thinly spread content under a few parents, which share their root's cell. Docs: `concepts/large-worlds`.

## 17. Move a player with keys, a gamepad or touch

```ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, input }) => {
  scene.setActiveCamera(scene.createPerspectiveCamera({ fov: 50, position: [0, 4, 10], target: [0, 0, 0] }));
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });
  const player = scene.createMesh({
    mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
    material: materials.standard({ color: '#4a8cff' }),
    dynamic: true,
  });
  input.actions.define({
    left: ['KeyA', 'ArrowLeft', 'GamepadLeftStickLeft', 'GamepadDpadLeft'],
    right: ['KeyD', 'ArrowRight', 'GamepadLeftStickRight', 'GamepadDpadRight'],
    jump: ['Space', 'GamepadA'],
  });
  let x = 0, y = 0, vy = 0, fingers = 0;
  return {
    onUpdate(dt) {
      let steer = input.value('right') - input.value('left');            // -1 to 1
      // Touch: a finger on the left or right half steers, and a second finger jumps.
      if (input.pointer.isTouch && input.isDown('Mouse0')) steer = input.pointer.ndcX < 0 ? -1 : 1;
      const secondFinger = input.touches.length === 2 && fingers < 2;
      fingers = input.touches.length;
      if (y === 0 && (input.wasPressed('jump') || secondFinger)) vy = 6;
      vy -= 20 * dt;
      y = Math.max(0, y + vy * dt);
      if (y === 0) vy = 0;
      x += steer * 5 * dt;
      player.setPosition(x, y + 0.5, 0);
    },
  };
});
```

An action names the keys and buttons for one move, so keyboard and gamepad players share one code path. With `value`, a stick pushed part of the way steers slowly, and a key steers at full speed. Touch has no keys: the first finger presses `Mouse0` and moves `input.pointer`, and `input.touches` lists every finger. Give the canvas `touch-action: none` in the page's CSS, or the browser scrolls the page and cancels the touches. Input changes once per frame, before `onUpdate`, and a tap shorter than a frame still counts as a press. Docs: `api/input`.

## 18. Camera that follows a moving object

```ts
import { defineSketch, vec3 } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, input }) => {
  const camera = scene.createPerspectiveCamera({ fov: 50 });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  scene.createAmbientLight({ intensity: 0.4 });
  const player = scene.createMesh({
    mesh: geometry.box({ width: 1, height: 1, depth: 1 }),
    material: materials.standard({ color: '#4a8cff' }),
    dynamic: true,
  });
  const at = vec3.create();                  // scratch arrays, made once
  const eye = vec3.create();
  const offset = vec3.create();
  vec3.set(offset, 0, 4, 10);                // above and behind the player
  let x = 0;
  return {
    onUpdate(dt) {
      x += (input.value('ArrowRight') - input.value('ArrowLeft')) * 5 * dt;
      player.setPosition(x, 0.5, 0);
    },
    onLateUpdate() {
      player.getWorldPosition(at);           // this frame's position, after onUpdate moved it
      vec3.add(eye, at, offset);
      camera.setPosition(eye[0], eye[1], eye[2]);
      camera.lookAt(at[0], at[1], at[2]);
    },
  };
});
```

`onLateUpdate` runs after the engine updates transforms and before it culls and draws. So `getWorldPosition` gives the player's place in this frame, and the camera's move shows in the same frame. In `onUpdate` the same code reads the previous frame's place. The camera then trails the player by a frame, which shows as jitter at speed. For a softer follow, keep the camera's own position in a vector. Ease it toward `eye` with `vec3.lerp` and the factor `1 - Math.exp(-lambda * dt)`, where `dt` is the argument that `onLateUpdate` gets. Docs: `api/sketch`, `api/time`.
