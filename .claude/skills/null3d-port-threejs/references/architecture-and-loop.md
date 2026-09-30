# Architecture and the loop: from one thread to two

three.js apps usually run everything on the main thread: DOM, input, scene updates and rendering. null3D splits this in two: the page (main thread) and the sketch (a worker). In null3D, a 3D scene is called a sketch: the module that builds the scene and updates it every frame. It takes the place of the three.js scene setup and animation loop. This file shows where each piece goes, how the two talk, and how to convert the loop. Engine docs: `concepts/architecture`, `api/page`, `porting/threejs-loop-and-threads`.

## Contents

1. What goes where
2. Messages between page and sketch
3. Converting the loop
4. Converting per-object classes to arrays
5. Input and camera controls
6. Libraries in the port
7. The two-step route for large apps

## 1. What goes where

| Piece of the three.js app | null3D location | How |
| --- | --- | --- |
| `<canvas>` or `renderer.domElement` | `index.html` and `page.ts` | Put the canvas in HTML; pass it to `createEngine` |
| Renderer options (antialias, alpha, pixel ratio, tone mapping) | `createEngine` options, `post.set` (later in 0.1) | Mapping table, "Renderer and loop" |
| Resize handling | Nowhere | The engine follows the canvas's CSS size |
| Scene, cameras, lights, meshes, loaders | `sketch.ts` | `defineSketch` setup code |
| The animation loop | `sketch.ts` | `onUpdate`, `onFixedUpdate`, `onLateUpdate` |
| DOM input listeners for the 3D view | `sketch.ts` reads `ctx.input` | The page shim forwards input through shared memory |
| Camera controls | `sketch.ts` | `@null3d/controls` |
| HTML UI, menus, HUD, lil-gui panels, stats panels | `page.ts` | Messages to and from the sketch |
| Labels (CSS2DRenderer) | Both | `ui.trackLabel` in the sketch, `engine.labels.bind` on the page (0.2) |
| Audio (Web Audio, three.js Audio) | `page.ts` | Sketch sends events and positions |
| Video elements | `page.ts` | After 1.0: `engine.registerVideo` and `textures.fromVideo`. Until then, send `ImageBitmap` frames (null3d-develop recipe 14) |
| `localStorage`, cookies, URL parameters | `page.ts` | Send what the sketch needs at start; IndexedDB also works in the sketch |
| `fetch` of JSON, binary data, models | `sketch.ts` | Workers have `fetch`; relative URLs resolve against the page |
| Physics libraries | `sketch.ts` | WebAssembly physics runs in workers |
| Analytics, ads, routing | `page.ts` | Unchanged |

## 2. Messages between page and sketch

Messages are fire-and-forget and structured-cloned, so keep them small and infrequent.

```ts
// sketch.ts
page.post('score', { value: score });                 // on change only
page.onMessage((type, data) => {
  if (type === 'settings') applySettings(data);
});
```

```ts
// page.ts
engine.onSketchMessage((type, data) => {
  if (type === 'score') scoreEl.textContent = String(data.value);
});
engine.postToSketch('settings', { volume: 0.8, quality: 'medium' });
```

Rules:

- Send events and changes, not per-frame state. Some three.js apps update the DOM every frame from scene data, such as a speedometer. Send such a value only when it changes by a visible amount.
- Positions for HTML elements use `ui.trackLabel` (0.2), which needs no messages at all.
- Give message types names and a TypeScript union type shared by both sides, so typos fail at compile time.
- Large one-off data (a level file) goes straight to the sketch with `fetch`, not through the page.

## 3. Converting the loop

```js
// three.js
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const t = clock.getElapsedTime();
  updatePlayer(dt);
  updateEnemies(dt);
  physicsWorld.step(1 / 60, dt, 3);
  followCamera(player);
  controls.update();
  composer.render();
}
animate();
```

```ts
// null3d sketch.ts
return {
  onFixedUpdate(step) { physicsWorld.step(); syncBodies(); },   // fixed rate, 0 to n times per frame
  onUpdate(dt) { updatePlayer(dt); updateEnemies(dt); controls.update(dt); },
  onLateUpdate() { followCamera(player); },                     // after transforms: camera sees final positions
};
```

- `clock.getDelta()` becomes the `dt` argument, also in `ctx.time.dt`; `clock.getElapsedTime()` becomes `ctx.time.now`.
- Physics moves to `onFixedUpdate`, at the rate that `defineSketch(setup, { fixedRate: 60 })` sets, 60 steps per second by default. One call of `world.step()` per fixed step replaces `world.step(1 / 60, dt, 3)`. The engine counts the steps, and `maxFixedSteps` (default 8) caps them per frame.
- Camera-follow code moves to `onLateUpdate`, so the camera uses this frame's final object positions, and its moves show in the same frame.
- Rendering calls and `composer.render()` disappear.
- Code that ran "every N frames" can use `ctx.time.frame % N === 0`.

## 4. Converting per-object classes to arrays

three.js code often wraps each object in a class with an `update()` method. That shape allocates, calls setters one object at a time, and scatters data across the heap. Convert it to arrays: keep the class for setup if it helps readability, but run the per-frame work as loops.

```js
// three.js
class Enemy {
  constructor(scene) { this.mesh = new THREE.Mesh(geo, mat); this.vel = new THREE.Vector3(); scene.add(this.mesh); }
  update(dt, player) {
    const dir = player.position.clone().sub(this.mesh.position).normalize();   // allocates
    this.vel.lerp(dir, 0.1);
    this.mesh.position.addScaledVector(this.vel, dt);
  }
}
enemies.forEach((e) => e.update(dt, player));
```

```ts
// null3d
const N = 2000;
const enemies = scene.createInstances(enemyMesh, N, { material: enemyMat, dynamic: true });
const vel = new Float32Array(N * 3);
const playerPos = new Float32Array(3);

function updateEnemies(dt: number) {
  player.getPosition(playerPos);
  const p = enemies.positions;
  for (let i = 0; i < N; i++) {
    const o = i * 3;
    let dx = playerPos[0] - p[o], dy = playerPos[1] - p[o + 1], dz = playerPos[2] - p[o + 2];
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= len; dy /= len; dz /= len;
    vel[o] += (dx - vel[o]) * 0.1; vel[o + 1] += (dy - vel[o + 1]) * 0.1; vel[o + 2] += (dz - vel[o + 2]) * 0.1;
    p[o] += vel[o] * dt; p[o + 1] += vel[o + 1] * dt; p[o + 2] += vel[o + 2] * dt;
  }
}
```

Enemies that need different meshes become one batch per mesh. Per-enemy state (health, target, timers) goes into typed arrays indexed by row. When an enemy dies, swap-remove its row with the last live row and lower the active count (null3d-develop `references/recipes.md`, recipe 5).

## 5. Input and camera controls

| three.js | null3D |
| --- | --- |
| `addEventListener('pointermove', ...)` with NDC math | `input.pointer.ndcX`, `ndcY`; `input.pointer.x`, `y` in CSS pixels |
| `addEventListener('keydown', ...)` and a key-state object | `input.isDown('KeyW')`, `input.wasPressed('Space')` |
| `addEventListener('touchstart', ...)` and a list of touches | `input.touches`, and `touch-action: none` on the canvas |
| Gamepad API polling | `input.isDown('GamepadA')`, `input.value('GamepadLeftStickRight')`, or an action map |
| `OrbitControls(camera, renderer.domElement)`, `MapControls` | `createOrbitControls(ctx, camera, options)`, `createMapControls`; same option names and defaults; `controls.update(dt)` every frame |
| `controls.listenToKeyEvents(window)` | Read the keys with `input.isDown`, and call `controls.pan(dx, dy)` or `controls.rotateLeft(angle)` |
| The controls' own `preventDefault` on wheel events | On the page: `canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false })`, so the wheel and a pinch zoom the camera, not the page |
| `controls.addEventListener('change', render)` for on-demand rendering | Not needed: the engine renders continuously and skips unchanged work. `update(dt)` returns true when the camera moved |
| `PointerLockControls` | `createFirstPersonControls` plus `engine.requestPointerLock()` on the page (0.2) |
| Clicks on UI buttons over the canvas | Handled on the page; send the action to the sketch |

Pointer events that land on HTML UI elements above the canvas do not reach the engine, which matches what users expect.

## 6. Libraries in the port

| Library | What to do |
| --- | --- |
| lil-gui, dat.gui, Tweakpane | Keep on the page; send values to the sketch |
| stats.js | `engine.measure()` on the page now; the overlay `debug.stats(true)` comes later in 0.1 |
| GSAP, tween.js | For scene values, lerp in `onUpdate` (property animation comes after 1.0); DOM tweens stay on the page |
| cannon-es, Rapier, Ammo | Run in the sketch worker; copy transforms into dynamic objects or batches after each step |
| three-mesh-bvh | Delete; raycasting uses built-in acceleration structures (0.2) |
| troika-three-text | Not available: use HTML labels, pre-rendered text textures, or text meshes baked into glTF |
| postprocessing (pmndrs) | Map effects to `post.set`: tone mapping later in 0.1, effects in 0.2 (`references/post-processing.md`) |
| three-stdlib, three/addons utilities | Check each import in the mapping table; many become built-in features |

## 7. The two-step route for large apps

Large apps mix DOM and scene code everywhere, which makes a direct move to the worker slow and risky. Split the work. The first step needs `createEngine({ sketchThread: 'main' })`, which comes later in 0.1. Until then, do the second step first, then port straight into the worker.

1. Port with `createEngine({ sketchThread: 'main' })` (later in 0.1). Sketch code runs on the main thread, so DOM access keeps working while you replace three.js calls. Reach parity here.
2. Move the DOM-touching code into `page.ts` and messages, then switch to the default worker mode. The scanner's "DOM access" warning lists the files to fix.

Main-thread mode keeps the render and job workers. But sketch code then shares the main thread with the page, so layout work and page scripts can delay frames. Treat it as a stage of the port, not the destination.
