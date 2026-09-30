---
id: api/sketch
title: "Sketch API: defineSketch and the context"
status: experimental
since: "0.1"
summary: "The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks."
---

# Sketch API: defineSketch and the context

> Ships in null3D 0.1. The API is experimental, so it can still change between versions. The context fields `assets`, `textures`, `quality`, `post`, `render`, `ui`, `debug` and `engine`, and the callbacks `onFixedUpdate` and `onLateUpdate`, are not built yet, so coding agents must not use them.

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

A module whose default export is not `defineSketch(...)` fails the start with [E1401](../errors/E1401.md). Code at the top of the module runs once, when the module loads, before the engine calls `setup`.

## The setup function

The engine calls `setup` once, with the context, before the first frame. `setup` returns the callbacks, or nothing when the sketch needs no frame callback. It can also be `async` and return them through a promise, for example to await data first. The first frame waits for the promise, and `createEngine` resolves only after it.

An error that `setup` throws ends the start: `createEngine` rejects with it. An engine error keeps its code, such as [E1204](../errors/E1204.md) for a color the engine cannot read. In the threaded build, any other error arrives as [E1405](../errors/E1405.md), with its message.

## The context

| Field | What it holds |
| --- | --- |
| `scene` | Objects, cameras, lights, instance batches and the background: [Scene](scene.md) |
| `geometry` | Mesh generators, such as `geometry.box` and `geometry.sphere` |
| `materials` | Material factories: [Materials](materials.md) |
| `input` | Pointer, touch, keyboard and gamepad input, and action maps: [Input](input.md) |
| `time` | Sketch time in seconds and the frame number: [Time](time.md) |
| `preferences` | What the user's system asks of every page, such as less motion: [Accessibility](../guides/accessibility.md) |
| `page` | Messages to and from the page: [Messages between sketch and page](page.md) |

## The callbacks

`onUpdate(dt)` runs once per frame, before the engine updates transforms. `dt` is the frame's step in seconds. It is 0 in the first frame and after a pause, and it is never longer than a quarter second. [Time](time.md) gives the details.

Changes that `onUpdate` makes show in the frame that the engine draws next. Setters take effect at once. Creating, destroying and reparenting objects take effect when the engine processes the frame, after `onUpdate` returns ([Scene](scene.md#when-changes-take-effect)).

An error that `onUpdate` throws does not stop a live engine. The engine logs each distinct error once in the console, and calls `onUpdate` again in the next frame. Hold mode stops at the first error instead ([Testing your sketch](../guides/testing.md)).

## Related pages

- [Your first scene](../getting-started/first-scene.md): a page and a sketch that run together.
- [Page API: createEngine](engine.md): the page's side of the engine.
- [Architecture: threads and the frame](../concepts/architecture.md): which thread runs what.

## API reference

<!-- null3d:api:start -->

### `defineSketch`

```ts
function defineSketch(setup: SketchSetup): SketchDefinition
```

Declares a sketch. In null3D, a 3D scene is called a sketch: a module that builds the scene and updates it every frame, in the sketch worker. The module must export the result as its default export.

### `SketchCallbacks`

Interface `SketchCallbacks`.

Callbacks a sketch returns from its setup function.

| Member | Description |
| --- | --- |
| `onUpdate(dt: number): void` | Runs once per frame, before transforms, with the frame's step in seconds. The first frame, and the first after a pause or a hidden page, gets 0. No step is longer than a quarter second, so a very slow frame slows the sketch instead of jumping it. In hold mode, each frame after the first gets a fixed step of 1/60 second. |

### `SketchContext`

Interface `SketchContext`.

What the engine passes to a sketch's setup function.

| Member | Description |
| --- | --- |
| `scene: Scene` | Objects, cameras, lights and instance batches. |
| `materials: Materials` | Material factories. |
| `geometry: Geometry` | Mesh generators. |
| `input: Input` | Pointer, touch, keyboard and gamepad input, which the page forwards to the sketch. |
| `time: { now: number; frame: number; }` | Sketch time in seconds, which is the sum of every step that `onUpdate` received, so paused and hidden time do not count. Also the current frame number. In hold mode, the last frame's time is the held time exactly. |
| `preferences: SketchPreferences` | What the user's system asks of every page, and a notice when that changes. |
| `engine: { readonly viewport: { readonly width: number; readonly height: number; readonly pixelRatio: number; }; }` | The engine as the sketch sees it. |
| `page: { post(type: string, data?: unknown, transfer?: Transferable[]): void; onMessage(handler: (type: string, data: unknown) => void): () => void; }` | Messages between the sketch and the page. `onMessage` returns a function that removes the handler. |

### `SketchDefinition`

Interface `SketchDefinition`.

A sketch, as `defineSketch` returns it.

| Member | Description |
| --- | --- |
| `readonly setup: SketchSetup` | The setup function passed to `defineSketch`. |

### `SketchPreferences`

Interface `SketchPreferences`.

The user's display preferences, which the page reads from the system and passes on.

| Member | Description |
| --- | --- |
| `readonly reducedMotion: boolean` | True when the user asks for less motion: the `prefers-reduced-motion` setting. Bring motion that only decorates to rest, such as an idle spin, camera sway or drifting particles. Keep motion the user controls, and motion that carries meaning, and prefer cuts to long camera flights. |
| `onChange(handler: () => void): () => void` | Calls `handler` at the start of the first frame after a preference changes. Returns a function that removes the handler. |

### `SketchSetup`

```ts
type SketchSetup = (context: SketchContext) => SketchCallbacks | undefined | Promise<SketchCallbacks | undefined>;
```

A sketch's setup function. The engine calls it once, in the sketch worker, and it returns the sketch's callbacks, directly or through a promise.

<!-- null3d:api:end -->
