# null3d recipes

Each recipe states the goal, gives the code, explains why it is written that way, and names the docs pages to read. Code runs in `sketch.ts` unless it says `page.ts`. Versions in parentheses mark APIs that arrive after 0.1; check the docs status before using them.

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
14. Video on a surface (after 1.0; a workaround now)
15. Custom full-screen effect (0.2)
16. Very large worlds (0.2)

## 1. Start a new project

```sh
bunx @null3d/cli create my-project --template empty   # also: third-person, top-down-units, product-viewer
cd my-project && bun install && bun run dev
```

The template contains `page.ts`, `sketch.ts`, `index.html` with a canvas, `AGENTS.md`, and the null3d skills in `.claude/skills/`. Its `vite.config.ts` loads the null3d Vite plugin, which sends the cross-origin isolation headers, so the threaded build runs. Docs: `getting-started/install`, `getting-started/project-structure`, `getting-started/hosting`.

## 2. Orbit camera around a model

```ts
import { defineSketch } from '@null3d/engine';
import { createOrbitControls } from '@null3d/controls';

export default defineSketch(async (ctx) => {
  const { scene } = ctx;
  const camera = scene.createPerspectiveCamera({ fov: 45, position: [3, 2, 5], target: [0, 1, 0] });
  scene.setActiveCamera(camera);
  const controls = createOrbitControls(ctx, camera, {
    target: [0, 1, 0], enableDamping: true, dampingFactor: 0.08,
    minDistance: 1.5, maxDistance: 12, maxPolarAngle: Math.PI * 0.49,
  });
  return { onUpdate(dt) { controls.update(dt); } };
});
```

Controls read forwarded input inside the sketch worker, so they need no DOM listeners. Damping only works when `update(dt)` runs every frame. Docs: `api/controls`.

## 3. Load a glTF model and play its animations (0.2)

```ts
const heroPrefab = await assets.loadGltf('/models/hero.glb');
const hero = scene.instantiate(heroPrefab, { position: [0, 0, 0] });
hero.setDynamic(true);                      // it will move every frame
const anim = hero.animator();
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
  },
};
```

Optimize models first with `bunx @null3d/cli assets optimize models/hero.glb` (meshopt, KTX2). Cross-fade on state changes only; calling `play` every frame restarts blending work. Docs: `api/assets`, `api/animation`, `guides/assets-pipeline`.

## 4. Thousands of moving objects

```ts
import { defineSketch, math } from '@null3d/engine';

export default defineSketch(async ({ scene, geometry, materials }) => {
  const N = 20_000;
  const boids = scene.createInstances(geometry.cone({ radius: 0.1, height: 0.3 }), N, {
    material: materials.standard({ color: '#e0e0e0', roughness: 0.6 }),
    dynamic: true,
  });
  const vel = new Float32Array(N * 3);        // your own data, next to the engine's arrays
  const p = boids.positions;
  for (let i = 0; i < N; i++) {
    p[i * 3] = math.randFloat(-50, 50); p[i * 3 + 1] = math.randFloat(0, 20); p[i * 3 + 2] = math.randFloat(-50, 50);
    vel[i * 3] = math.randFloat(-1, 1); vel[i * 3 + 2] = math.randFloat(-1, 1);
  }
  return {
    onUpdate(dt) {
      for (let i = 0; i < N * 3; i++) p[i] += vel[i] * dt;   // no allocation, no setters
    },
  };
});
```

A dynamic batch uploads all rows every frame, so no `markDirty` call is needed. Keep per-object data (velocity, health) in your own typed arrays indexed by row. Docs: `concepts/instances`, `concepts/static-dynamic`.

## 5. Pool short-lived objects such as bullets

```ts
const MAX = 512;
const bullets = scene.createInstances(geometry.sphere({ radius: 0.05 }), MAX, {
  material: materials.unlit({ color: '#ffee88' }), dynamic: true,
});
const life = new Float32Array(MAX);
const dir = new Float32Array(MAX * 3);
let active = 0;

function fire(origin: ArrayLike<number>, d: ArrayLike<number>) {
  if (active === MAX) return;
  const i = active++;
  bullets.positions.set(origin, i * 3);
  dir.set(d, i * 3);
  life[i] = 2;
  bullets.setActiveCount(active);
}

function update(dt: number) {
  const p = bullets.positions;
  for (let i = 0; i < active; i++) {
    life[i] -= dt;
    if (life[i] <= 0) {                     // swap-remove: copy the last live row over this one
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
}
```

No objects are created or destroyed during play. `setActiveCount` draws only the live rows. Docs: `concepts/instances`.

## 6. Click to select, with an outline (0.2)

```ts
const PICKABLE = 1 << 1;
for (const u of units) u.setLayers(1 | PICKABLE);   // layer 0 stays on so cameras still draw it
post.set({ outline: { color: '#ffcc00', thickness: 2 } });

let selected: typeof units[number] | null = null;
for (const u of units) {
  u.on('click', () => {
    selected?.setOutlined(false);
    selected = u;
    u.setOutlined(true);
    page.post('selected', { name: u.name });
  });
}
```

Without object events (before 0.2), use a ray:

```ts
const WORLD = 1 << 2;   // walls and terrain: they block the ray
for (const wall of walls) wall.setLayers(1 | WORLD);
const unitSet = new Set(units);
const ray = { origin: [0, 0, 0], direction: [0, 0, -1] };
const hit = { object: null as any, point: [0, 0, 0], normal: [0, 0, 0], distance: 0, instance: -1 };
// in onUpdate:
if (input.wasPressed('Mouse0')) {
  camera.screenToRay(input.pointer.x, input.pointer.y, ray);
  if (scene.raycast(ray.origin, ray.direction, { layers: PICKABLE | WORLD }, hit) && unitSet.has(hit.object)) {
    /* select hit.object */
  }
}
```

The ray tests units and the walls and terrain on `WORLD`, and returns the nearest hit. A wall in front of a unit is that nearest hit, so a unit behind a wall is not selected. Effects stay off both layers, so they never block the ray. Create `ray`, `hit` and `unitSet` once. Docs: `api/raycast`, `concepts/render-layers`, `api/post`.

## 7. HTML labels above objects (0.2)

```ts
// sketch.ts
ui.trackLabel(unit, `hp-${id}`, { offset: [0, 2.2, 0] });
page.post('hp', { id, value: 80 });           // only when the value changes
```

```ts
// page.ts
const el = document.createElement('div');
el.className = 'hp';
labelsLayer.appendChild(el);
engine.labels.bind(`hp-${id}`, el);
engine.onSketchMessage((type, d) => { if (type === 'hp') document.getElementById(`hp-${d.id}`)!.textContent = String(d.value); });
```

The engine writes each label's screen position into shared memory every frame, and the page moves the element. Only value changes travel as messages. Hidden and off-screen labels are marked, so the page can hide them. Docs: `guides/ui-overlays`, `api/ui`.

## 8. Loading screen with progress and warm-up

```ts
// sketch.ts
assets.onProgress((loaded, total) => page.post('loading', loaded / total));
await assets.preload(['/models/level.glb', '/env/sunset.ktx2', '/tex/terrain.ktx2']);
const level = scene.instantiate(await assets.loadGltf('/models/level.glb'));
await scene.warmUp();                          // compile every pipeline before the first frame
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
- `createEngine` rejects when the browser cannot run the engine, for example without WebAssembly SIMD (E1303). Show a message or a still image in place of the canvas.
- `warmUp` prevents the hitches that appear when a new pipeline compiles during play; the Godot browser port measured seconds of such stalls.

Docs: `guides/loading-screens`, `api/engine`.

## 9. HTML settings panel that controls the scene

```ts
// page.ts (any UI library works here, including lil-gui)
const gui = new GUI();
const settings = { bloom: 0.8, shadows: true };
gui.add(settings, 'bloom', 0, 2).onChange((v: number) => engine.postToSketch('bloom', v));
gui.add(settings, 'shadows').onChange((v: boolean) => engine.postToSketch('shadows', v));
```

```ts
// sketch.ts
page.onMessage((type, v) => {
  if (type === 'bloom') post.set({ bloom: { strength: v } });
  if (type === 'shadows') sun.setCastShadows(v);
});
```

UI libraries need the DOM, so they live on the page. Docs: `guides/ui-overlays`, `api/page`.

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

Several full views, such as split screens, come after 1.0 (`guides/multiple-views`). A minimap or picture in picture works now with a render-to-texture pass and a final effect. The effect samples the map with `textureSampleLevel` because the branch differs between pixels, and WGSL forbids implicit-mip sampling there (`references/shaders.md`, section 8). Docs: `guides/custom-passes`, `api/post`.

## 13. Screenshots

```ts
// page.ts
shotButton.onclick = async () => {
  const blob = await engine.capture();          // the next complete frame, as a PNG
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'shot.png' });
  a.click();
};
```

For tests, use `bunx @null3d/cli shot` or hold-mode tests instead (`references/testing-and-debugging.md`). Docs: `api/engine`.

## 14. Video on a surface (after 1.0; a workaround now)

Video textures (`engine.registerVideo` with `textures.fromVideo`) come after 1.0. Until then, the page can send frames as `ImageBitmap` objects, which transfer to the sketch without a copy:

```ts
// page.ts
const video = Object.assign(document.createElement('video'), { src: '/intro.mp4', muted: true, loop: true, playsInline: true });
await video.play();
const sendFrame = async () => {
  const bitmap = await createImageBitmap(video, { resizeWidth: 640, resizeHeight: 360 });
  engine.postToSketch('video-frame', bitmap, [bitmap]);   // transfer, do not copy
  video.requestVideoFrameCallback(sendFrame);           // or requestAnimationFrame where this is missing
};
video.requestVideoFrameCallback(sendFrame);
```

```ts
// sketch.ts, at setup: create the material now, so no pipeline compiles during play
const screenTex = textures.fromData({ width: 1, height: 1, format: 'rgba8unorm', colorSpace: 'srgb', data: new Uint8Array([0, 0, 0, 255]) });
scene.createMesh({ mesh: geometry.plane({ width: 16 / 9, height: 1 }), material: materials.unlit({ map: screenTex }) });
page.onMessage((type, bitmap) => { if (type === 'video-frame') screenTex.update(bitmap); });  // update accepts a new size
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

The engine stores positions relative to cells about 1 km wide, and each frame it sends the GPU one camera-to-cell offset per visible cell. Objects millions of meters from the origin do not jitter, and static objects stay on the GPU without re-uploads. Vertex positions must be small offsets from their object's center, and batch rows small offsets from the batch origin. Docs: `concepts/large-worlds`.
