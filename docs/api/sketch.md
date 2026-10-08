---
id: api/sketch
title: "Sketch API: defineSketch and the context"
status: experimental
since: "0.1"
summary: "The context object: scene, assets, materials, geometry, textures, input, time, engine, quality, post, render, page, ui, debug; the callbacks."
---

# Sketch API: defineSketch and the context

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The context field `render` is not built yet, so coding agents must not use it. Of `post`, only `post.set` with `toneMapping` and `exposure` is built.

In null3D, a 3D scene is called a sketch. A sketch module builds the scene and updates it every frame, and its default export is `defineSketch(setup)`. The engine loads the module, calls `setup` once with the sketch's context, and then calls the callbacks that `setup` returns.

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, input, page }) => {
  const camera = scene.createPerspectiveCamera({ position: [0, 2, 6], target: [0, 0, 0] });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  const ball = scene.createMesh({
    mesh: geometry.sphere({ radius: 0.5 }),
    material: materials.standard({ color: '#4a8cff' }),
    dynamic: true, // it moves in most frames
  });
  page.post('ready');

  let x = 0;
  return {
    onUpdate(dt) {
      if (input.isDown('ArrowLeft')) x -= 3 * dt;
      if (input.isDown('ArrowRight')) x += 3 * dt;
      ball.setPosition(x, 0, 0);
    },
  };
});
```

## Where the sketch runs

The page passes the module's address to `createEngine`, and the engine loads the module in the sketch worker. The sketch worker has no `document` and no `window`, so the page keeps the HTML and the two sides talk through [messages](page.md). On a page without cross-origin isolation, the engine runs the sketch on the page's own thread, with the same API ([Hosting and cross-origin isolation](../getting-started/hosting.md)).

A module whose default export is not `defineSketch(...)` fails the start with [E1401](../errors/E1401.md). A module that does not load fails it with [E1410](../errors/E1410.md): the module did not download, or its code threw an error while it loaded. The engine imports a module that does not load once more, after a short wait, and the console notes the second import. So a short break in the network does not fail the start. Only a second failure gives E1410, with the first failure's reason.

Code at the top of the module runs once, when the module loads, before the engine calls `setup`. With worker threads, the module loads after the engine has started in the sketch worker. In the single-threaded build, the engine downloads the module while it downloads its core, to start sooner on a slow network. So there, code at the top of the module can run before the engine has started, and also when the start fails.

## The setup function

The engine calls `setup` once, with the context, before the first frame. `setup` returns the callbacks, or nothing when the sketch needs no frame callback. It can also be `async` and return them through a promise, for example to await data first. The first frame waits for the promise, and `createEngine` resolves only after it.

An error that `setup` throws ends the start: `createEngine` rejects with it. An engine error keeps its code, such as [E1204](../errors/E1204.md) for a color the engine cannot read. In the threaded build, any other error arrives as [E1405](../errors/E1405.md), with its message.

## Options

`defineSketch` takes options after the setup function. They set the fixed steps, which [Time](time.md#fixed-steps) explains.

| Option | Default | What it sets |
| --- | --- | --- |
| `fixedRate` | 60 | Fixed steps per second of sketch time: how often `onFixedUpdate` runs |
| `maxFixedSteps` | 8 | The most fixed steps that one frame runs, after a slow frame |

```ts
export default defineSketch(setup, { fixedRate: 120 });
```

An option out of its range fails the start with [E1214](../errors/E1214.md), before the engine calls `setup`.

## The context

| Field | What it holds |
| --- | --- |
| `scene` | Objects, cameras, lights, instance batches and the background: [Scene](scene.md) |
| `geometry` | Mesh generators, such as `geometry.box` and `geometry.sphere` |
| `materials` | Material factories: [Materials](materials.md) |
| `textures` | Textures from decoded images and from data: [Textures](textures.md) |
| `assets` | Downloads of textures, JSON and binary files, with preloads and progress: [Assets](assets.md) |
| `input` | Pointer, touch, keyboard and gamepad input, and action maps: [Input](input.md) |
| `post` | The tone mapping and the exposure: [Post-processing API](post.md) |
| `quality` | The quality preset that the engine runs, and its settings: [Quality API](quality.md) |
| `time` | Sketch time in seconds, the frame's step and the frame number: [Time](time.md) |
| `engine` | The canvas's size, and what the device can do: [The engine field](#the-engine-field) |
| `preferences` | What the user's system asks of every page, such as less motion: [Accessibility](../guides/accessibility.md) |
| `page` | Messages to and from the page: [Messages between sketch and page](page.md) |
| `ui` | HTML labels that follow scene objects: [UI overlays and labels](ui.md) |
| `debug` | Lines, boxes, spheres, axes, grids, frustums and lights, drawn for one frame in development builds: [Debug drawing and stats](debug.md) |

## The engine field

`engine.viewport` holds the canvas's size in CSS pixels, as `width` and `height`. Its `pixelRatio` gives the device pixels per CSS pixel that the engine draws with. That is the display's ratio, capped by the `maxPixelRatio` setting of [`ctx.quality`](quality.md). It is lower on a canvas too large for the GPU's largest texture at that ratio. The engine reads the size at the start of each frame, so it stays the same throughout a frame. The object changes in place, so read its fields when you need them.

`engine.capabilities` holds the values of `engine.capabilities` on the page: the GPU path, its optional features and limits, the depth mode, and the most objects the device draws. [Page API: createEngine](engine.md#what-the-engine-reports) describes them. Check a capability before you use an optional feature, and never check GPU or browser names.

```ts
export default defineSketch(({ scene, engine }) => {
  // A portrait screen gets a wider view, so the scene still fits across it.
  const portrait = engine.viewport.height > engine.viewport.width;
  const camera = scene.createPerspectiveCamera({ fov: portrait ? 75 : 50, position: [0, 2, 6] });
  scene.setActiveCamera(camera);
});
```

## The callbacks

Each frame runs the callbacks in this order, and each callback is optional:

| Callback | When it runs | Use it for |
| --- | --- | --- |
| `onFixedUpdate(step)` | Once for each fixed step that falls due, so 0 or more times per frame, before `onUpdate` | Simulation that must step the same at any frame rate, such as physics |
| `onUpdate(dt)` | Once per frame, before the engine updates transforms | Input, movement and game logic |
| `onLateUpdate(dt)` | Once per frame, after the engine updates transforms and before it culls and draws | Cameras that follow objects, and other code that needs the frame's world positions |

`step` is the length of a fixed step in seconds, 1/60 at the default rate. `dt` is the frame's step in seconds, the same value as `time.dt`. It is 0 in the first frame and after a pause, and it is never longer than a quarter second. [Time](time.md) gives the details.

## When changes show

Setters take effect at once. Changes that `onFixedUpdate` and `onUpdate` make show in the frame that the engine draws next. Creating, destroying and reparenting objects take effect when the engine processes the frame, after `onUpdate` returns ([Scene](scene.md#when-changes-take-effect)).

In `onLateUpdate`, world positions already hold the frame's changes, so `getWorldPosition` gives the place where the frame draws an object. Setters that `onLateUpdate` calls also show in the same frame. Before it culls and draws, the engine updates the objects that they move and the objects below them. A camera that follows an object there does not lag a frame behind it. Structural changes that `onLateUpdate` makes, such as creating an object, take effect in the next frame.

The engine runs this second update only for a sketch with `onLateUpdate`, and then only for the objects that it moved and the objects below them.

## Example: a camera that follows a moving object

```ts
import { defineSketch, vec3 } from '@null3d/engine';

export default defineSketch(({ scene, geometry, materials, time }) => {
  const camera = scene.createPerspectiveCamera({ fov: 50 });
  scene.setActiveCamera(camera);
  scene.createDirectionalLight({ direction: [-1, -2, -1], intensity: 3 });
  const car = scene.createMesh({
    mesh: geometry.box({ width: 1, height: 0.5, depth: 2 }),
    material: materials.standard({ color: '#e8554e' }),
    dynamic: true,
  });
  const at = vec3.create(); // made once, reused in every frame

  return {
    onUpdate() {
      car.setPosition(Math.sin(time.now) * 10, 0.25, Math.cos(time.now) * 10);
    },
    onLateUpdate() {
      car.getWorldPosition(at); // where this frame draws the car
      camera.setPosition(at[0], at[1] + 3, at[2] + 8);
      camera.lookAt(at[0], at[1], at[2]);
    },
  };
});
```

The camera moves in `onLateUpdate`, after the car's move in `onUpdate` reached its world position. In `onUpdate`, `getWorldPosition` would give the car's place in the previous frame, and the camera would trail it.

## Errors in callbacks

An error that a callback throws does not stop a live engine. The engine logs each distinct error once in the console, and calls the callback again when it next runs. An error in one fixed step does not skip the fixed steps after it. Hold mode stops at the first error instead ([Testing your sketch](../guides/testing.md)).

## Related pages

- [Your first scene](../getting-started/first-scene.md): a page and a sketch that run together.
- [Time](time.md): the step, sketch time and fixed steps.
- [Page API: createEngine](engine.md): the page's side of the engine.
- [Architecture: threads and the frame](../concepts/architecture.md): which thread runs what.

## API reference

[The API reference](reference/sketch.md) lists every export of this page with its type and description. The engine's doc comments make it.
