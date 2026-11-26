---
id: guides/deterministic-simulation
title: Using null3D with a deterministic simulation
summary: "The maths entry a simulation may import; createMath with an exact math library; input, picking and physics that decide a result stay out of the sketch; createEngine's input option; a camera that the player aims from recorded input; a production build of a game's engine files."
---

# Using null3D with a deterministic simulation

```mermaid
flowchart LR
    recorder["A library on the page<br/>records the player's input"] --> simulation["The simulation steps by ticks:<br/>@null3d/engine/math and<br/>createMath on an exact library"]
    log["A server replays<br/>the same input log"] --> simulation
    simulation --> state["The simulation's state"]
    state --> post["The page sends it:<br/>engine.postToSketch"]
    post --> sketch["The sketch draws it with<br/>@null3d/engine's helpers"]
```

Some games keep their rules in a simulation: code that steps the game by ticks from a seed and a log of the player's input. A server can then replay the log and check a score. The replay must give the same bits as the player's browser, on every JavaScript engine. So the simulation may use only exact arithmetic, and no page API.

null3D draws such a game. The sketch draws the simulation's state, and nothing that the sketch does changes that state. The simulation may import one part of null3D: the helpers in its maths entry.

## What a simulation may import

The maths entry holds the math helpers that use exact arithmetic alone: `+`, `-`, `*`, `/`, `Math.sqrt`, `Math.abs`, `Math.min` and `Math.max`. Their results are the same bits in V8, JavaScriptCore and SpiderMonkey.

| Import from | Helpers |
| --- | --- |
| `@null3d/engine/math/vec3` | `create`, `set`, `copy`, `add`, `sub`, `multiply`, `scale`, `scaleAndAdd`, `negate`, `dot`, `cross`, `length`, `squaredLength`, `distance`, `squaredDistance`, `normalize`, `lerp`, `min`, `max`, `transformQuat` and `transformMat4` |
| `@null3d/engine/math/quat` | `create`, `set`, `copy`, `identity`, `fromMat4`, `lookAt`, `rotationTo`, `multiply`, `invert`, `normalize` and `dot` |
| `@null3d/engine/math/mat4` | `create`, `identity`, `copy`, `multiply`, `invert`, `compose` and `decompose` |
| `@null3d/engine/math/math` | `clamp`, `lerp`, `inverseLerp`, `mapLinear`, `smoothstep`, `degToRad`, `radToDeg` and `euclideanModulo` |
| `@null3d/engine/math` | `createMath`, and the types `Vec2Like`, `Vec3Like`, `QuatLike`, `Mat4Like`, `EulerOrder`, `MathFunctions`, `MathHelpers`, `NumberHelpers`, `QuatHelpers` and `Vec3Helpers` |

Each helper is the same function as the main entry's helper of that name, so the [Math helpers](../api/math.md) page describes it. Import a sub-path as a namespace or by name. A bundler then keeps only the helpers that the simulation calls: six helpers add about 1.2 KB.

```ts
// sim/ship.ts: simulation code
import * as math from '@null3d/engine/math/math';
import * as quat from '@null3d/engine/math/quat';
import * as vec3 from '@null3d/engine/math/vec3';

const forward = vec3.create();
const AHEAD = [0, 0, -1];

export function stepShip(position: number[], heading: number[], thrust: number): void {
  vec3.transformQuat(forward, AHEAD, heading);
  vec3.scaleAndAdd(position, position, forward, math.clamp(thrust, 0, 1) * 0.2);
  quat.normalize(heading, heading);
}
```

Never import `@null3d/engine` itself in simulation code. Bun 1.4.3 bundles six helpers from it into 9,133 bytes, against 1,202 bytes from the sub-paths. The rest is engine code that the simulation never calls, with a top-level `FinalizationRegistry`, which a replaying engine's scan refuses. A bundler that keeps each re-exported namespace whole brings far more. Bun 1.3.11 does, and its bundle of the same six takes 87,857 bytes, with `Atomics`, `document`, `navigator`, `requestAnimationFrame`, and helpers that call `Math.sin`, `Math.cos`, `Math.acos`, `Math.exp` and `Math.random`.

The maths entry leaves out four groups:

- The helpers that turn by an angle or ease over time, `quat.setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ` and `slerp`, `vec3.angle` and `math.damp`. They need a sine, a cosine, an arc cosine or an exponential. The browser's `Math` computes those differently on different JavaScript engines. Build them with `createMath` on exact functions instead.
- The random helpers, `math.random`, `seed`, `randFloat`, `randInt` and `randFloatSpread`. They share one generator per thread, which starts from `Math.random`. Draw a simulation's random numbers from its own seeded generator.
- The `color` helpers. Most of them use `**`, and a simulation has no use for color.
- Everything else of the engine: scenes, cameras, raycasts and input belong to the sketch and the page.

## Angles and exponentials: createMath

`createMath({ sin, cos, acos, exp })` returns the eight helpers that the maths entry leaves out, built on the four functions that you pass. Pass an exact math library's functions, which give the same bits on every JavaScript engine. clockwork2's `dmath` is one:

```ts
// sim/turn.ts: simulation code
import { createMath } from '@null3d/engine/math';
import * as quat from '@null3d/engine/math/quat';
import { acos, cos, exp, sin } from '@clockwork2/engine/dmath';

// Once, at load: createMath allocates the helpers.
const exact = createMath({ sin, cos, acos, exp });
const turn = quat.create();
const UP = [0, 1, 0];

export function steer(heading: number[], angle: number): void {
  exact.quat.setAxisAngle(turn, UP, angle);
  quat.multiply(heading, heading, turn);
}

export const ease = (speed: number, goal: number, dt: number) => exact.math.damp(speed, goal, 4, dt);
```

- The helpers come grouped as the main entry groups them: `exact.quat.setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ` and `slerp`, `exact.vec3.angle` and `exact.math.damp`.
- Each takes the same arguments and does the same arithmetic as the main entry's helper of its name. Given `Math.sin`, `Math.cos`, `Math.acos` and `Math.exp`, its results are the main entry's, bit for bit.
- Import the four functions by name, as above. A whole namespace passed as a value, as in `createMath(dmath)`, makes a bundler keep every function of the library.
- `createMath` throws [E1213](../errors/E1213.md) when one of the four is not a function.
- The helpers and the error that `createMath` throws cost about 2.7 KB together, in one object, which a bundler keeps whole.

An exact library and the browser's `Math` can differ in the last bit. So the sketch draws the state that the simulation computed, rather than computing it again with its own helpers.

## Keep decisions out of the sketch

Nothing in the sketch is in the input log, and no server runs it. So anything that decides a result belongs in the simulation:

- **Input.** The sketch's `ctx.input` hears the page's events, which the log does not hold. The simulation reads its input from the library that records it. Turn null3D's own listening off, as the next section shows.
- **Picking.** Pointer events on objects, `scene.raycast` and `camera.screenToRay` test the scene that the engine last drew, in its WebAssembly core. A replay has no such scene. Hit-test the recorded pointer position against the simulation's own shapes, with a camera that the simulation owns. The simulation builds the camera's projection matrix itself. Then `mat4.multiply`, `mat4.invert` and `vec3.transformMat4` turn a screen point into a ray.
- **Physics.** A physics library in the sketch, as [Using a physics library](physics.md) shows, moves things that only look right. Collisions and forces that decide a result run in the simulation, written with exact arithmetic.
- **The camera.** [Camera controls](../api/controls.md) move the camera from the sketch's input. A camera that the game's rules aim, such as one that follows the player, comes from the simulation's state.
- **Time.** The sketch's `dt` follows the display. The simulation steps by its own ticks, and the sketch draws the latest state it got, or blends between the last two.

The sketch still draws with the main entry's helpers, which use the browser's `Math` at full speed.

## Input that another library records

`createEngine({ input: false })` keeps the engine from listening for input. The engine then adds no listener that takes input: none for pointers, keys, the wheel, focus, the pointer lock or gamepads. It captures no pointer on the canvas, and leaves the canvas's context menu to the browser. It keeps its listeners that take no input, such as the `visibilitychange` that keeps a hidden page's time out of the sketch's steps. [Input off](../api/input.md#input-off) lists them. The library that records the player's input listens alone.

```ts
// page.ts
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas')!;
await createEngine({
  canvas,
  sketch: new URL('./sketch.ts', import.meta.url),
  input: false, // another library records the input
});
```

The sketch's `ctx.input` then stays at rest. Every key, button and action is up, `value` gives 0 and `input.touches` is empty. The pointer stays at the canvas's top-left corner, with no movement, wheel or buttons. Objects get no pointer events.

- `engine.requestPointerLock()` fails with [E1426](../errors/E1426.md). A game that locks the pointer locks it through the library that records the input, which reads the movement. Stopping the engine leaves that lock.
- A development build warns in the console when the sketch relies on input anyway. It warns once for each kind: a read of `ctx.input`, an object's pointer event handler, and `@null3d/controls`. A production build carries no trace of the warnings.

## Where the player looks

A game whose result depends on where the player looks records the look as input. An example is a game that scores what the player aims at. The camera is then the simulation's, and the sketch only draws it:

1. The page's input code locks the pointer on the canvas with `canvas.requestPointerLock()`, in a click handler. When a drag also turns the view, ask only on a click that barely moved, since a drag ends in a click too. Read `document.pointerLockElement` at each event, since a press can come before `pointerlockchange` does. Take no pointer capture under the lock: the browser refuses one with an `InvalidStateError`. The engine's own `requestPointerLock()` belongs to its input, and fails with [E1426](../errors/E1426.md) when that is off.
2. Each tick, the page records the mouse's movement since the last tick as whole counts, and carries the fraction to the next tick. A browser can report a fraction of a pixel, and the log holds what the simulation reads.
3. The simulation turns the counts into a yaw and a pitch, and builds the camera's rotation with `createMath`'s `quat.fromEuler`.
4. The sketch sets its camera to the pose in the state. It turns no camera of its own, and neither `ctx.input` nor camera controls take part.

A replay of the log then gives the same camera path, and every aim that it decided. The [deterministic simulation demo](https://github.com/null3d-engine/null3d/tree/main/examples/replay) does this:

```ts
// page.ts: the page's own lock, and the movement that each tick records
canvas.addEventListener('click', () => canvas.requestPointerLock());
let turn = 0;
canvas.addEventListener('pointermove', (event) => {
  if (document.pointerLockElement === canvas) turn += event.movementX;
});
// In each tick:
const counts = Math.trunc(turn);
turn -= counts;
log.push(counts);
step(state, counts);
```

```ts
// sim.ts: simulation code
const TURN = 0.0024; // radians for each count

export function step(state: State, counts: number): void {
  state.yaw = math.euclideanModulo(state.yaw - counts * TURN, 2 * Math.PI);
  exact.quat.fromEuler(state.look, state.pitch, state.yaw, 0, 'YXZ');
}
```

## Sending the state to the sketch

The page sends the simulation's state with `engine.postToSketch`. The sketch takes it with `page.onMessage`, as [Messages between the page and the sketch](../api/page.md) shows, and draws it in `onUpdate`. Send only the numbers that the sketch draws, in a small typed array. Send a new array each time: a sketch on the page's thread gets the very array that the page sent. When the sketch runs in a worker, the browser copies each message's data.

Until the first state arrives, as in a held frame, the sketch can draw the run's start. It imports the simulation's start function and builds the first state from the same seed, and it never steps the state.

A display can draw more frames than the simulation has ticks, such as 120 frames a second against 60 ticks. Send the poses of the last two ticks, and how far the frame is between them, once a frame. The sketch then blends them with the main entry's `vec3.lerp` and `quat.slerp`, so the camera moves smoothly at any rate:

```ts
// sketch.ts, in onUpdate
vec3.lerp(at, before, now, between);
quat.slerp(turned, beforeTurn, nowTurn, between);
camera.setPosition(at[0], at[1], at[2]);
camera.setRotation(turned[0], turned[1], turned[2], turned[3]);
```

## A production build of a game's engine files

A game can take null3D's files as one folder: the engine's code, its workers, its cores, its shader modules and the sketch. This suits a game whose page module another build makes. A Vite build with the null3D plugin writes the folder from a two-line entry, and the game's own module imports the entry.

```ts
// engine-entry.ts
export { createEngine } from '@null3d/engine';
export const SKETCH = new URL('./sketch.ts', import.meta.url);
```

```ts
// vite.config.ts
import null3d from '@null3d/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // the folder works from any address
  plugins: [null3d()],
  build: {
    outDir: 'dist/engine',
    modulePreload: false, // the entry is a module that another module imports, not a page
    rollupOptions: {
      input: { entry: 'engine-entry.ts' },
      preserveEntrySignatures: 'exports-only', // keep the entry's exports
      output: { entryFileNames: 'entry.js' },
    },
  },
});
```

The game's module then imports `createEngine` and `SKETCH` from the folder's `entry.js`, and passes `SKETCH` as the `sketch` option. The plugin also writes `null3d-files.json`, which lists the files that the start loads and those of each feature, as [Hosting](../getting-started/hosting.md) describes.

The shader modules decide most of the folder's size. Build only the shader permutation words that the game draws with:

1. Record the words from a run of the game's page, as [Build only the shader permutations you draw with](assets-pipeline.md#build-only-the-shader-permutations-you-draw-with) shows. Name the game's pages with `--page`, or `--live` for a page that the recorder drives through its states. Record on both GPU paths, and at the low and high presets.
2. In a checkout of null3D, build the shader modules from the list: `NULL3D_SHADER_PERMUTATIONS=<list> bun run shaders`. The checkout's `packages/engine/src/generated` then holds them.
3. Build the game with `NULL3D_ENGINE_SHADERS` set to that folder, such as `NULL3D_ENGINE_SHADERS=<checkout>/packages/engine/src/generated bunx vite build`. The plugin then takes the narrowed modules in place of the full set.

A game whose page module another build makes records differently from a sketch page. Its engine starts on a click, so name its page with `--live` and give the recorder the start control: `--click "#play"`. Its files folder is a production build, and a production build ignores `?permutations`, `?gpu` and `?preset`. Record against a development build of that folder (`vite build --mode development`). Then build the narrowed set, and rebuild the folder in production. A real game recorded this way drew with 5 words, and its folder held 300 files and 26 MB. The same folder built with the 172-word example list held 762 files and 226 MB.

The shader modules in a release asset are the full set. A game that builds against that asset and names no list copies every module into its files folder. That can exceed the folder's file and byte limits. Narrow the set first.

A small game scene with three lanes and a ship drew with 5 words. Its folder held 297 files and 26,057,130 bytes, 4,737,421 after Brotli. The same folder built with the 172 words of null3D's examples held 759 files and 225,683,678 bytes. The full set of shader modules is 4,117,799,356 bytes. Record again after the game gains a feature that turns on a new word. The engine names a word that the set lacks the first time a pipeline needs it.

## API reference

The [Math helpers reference](../api/reference/math.md) lists `createMath` and its types, and the [createEngine reference](../api/reference/engine.md) lists the `input` option.
