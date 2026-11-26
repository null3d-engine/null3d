---
id: api/sketch
title: "Sketch API: defineSketch and the context"
status: experimental
since: "0.1"
summary: "The context object: the start data, scene, assets, materials, geometry, textures, input, time, engine, quality, post, render, page, ui, debug; the callbacks; the options, with the download list."
---

# Sketch API: defineSketch and the context

> Roadmap step 0.1, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

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

Code at the top of the module runs once, when the module loads, before the engine calls `setup`. The engine loads the module while it downloads its core, in the sketch worker or, in the single-threaded build, on the page. So the module's own imports and its top-level code take no time of their own on a slow network. Code at the top of the module can therefore run before the engine has started, and also when the start fails. Work there must not need the engine. Every call that makes scene data goes through the setup's context, and an engine call before the core starts fails with [E1403](../errors/E1403.md). Work that needs no engine, such as a large table that the first view reads, can run there and overlap the download.

Hold mode, a replay and a recording load the module only after the engine has started and seeded the thread's random numbers. There, code at the top of the module draws the same numbers from `Math.random` on every run ([Testing](../guides/testing.md)).

## The setup function

The engine calls `setup` once, with the context, before the first frame. `setup` returns the callbacks, or nothing when the sketch needs no frame callback. It can also be `async` and return them through a promise, for example to await data first. The first frame waits for the promise, and `createEngine` resolves only after it.

The setup reads the page's start data as `ctx.data`. It holds what the page knows before the scene starts, such as the section that its address names. With `defineSketch<Data>(setup)`, its type is `Data | undefined`. It is `undefined` when the page passes no `sketchData`. [Start data](page.md#start-data) shows both sides.

An error that `setup` throws ends the start: `createEngine` rejects with it. An engine error keeps its code, such as [E1204](../errors/E1204.md) for a color the engine cannot read. In the threaded build, any other error arrives as [E1405](../errors/E1405.md), with its message.

## Options

`defineSketch` takes options after the setup function. They set the fixed steps, which [Time](time.md#fixed-steps) explains, and the files that the setup loads.

| Option | Default | What it sets |
| --- | --- | --- |
| `fixedRate` | 60 | Fixed steps per second of sketch time: how often `onFixedUpdate` runs |
| `maxFixedSteps` | 8 | The most fixed steps that one frame runs, after a slow frame |
| `lowestTier` | true | False keeps the governor's lowest quality tier out, for a scene that its own sketch thread limits |
| `downloads` | none | The files that the setup loads, which start to download as soon as the module has loaded ([The download list](#the-download-list)) |
| `serialLoadWarning` | true | False turns off a development build's warning for a load that waited for another one ([Loads one after another](#loads-one-after-another)) |

```ts
export default defineSketch(setup, { fixedRate: 120 });
```

An option out of its range fails the start with [E1214](../errors/E1214.md), before the engine calls `setup`.

### The download list

A setup that awaits its files one after another waits for each download in turn. The `downloads` option names the files that the setup loads, so they download before the setup asks for them:

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

const SHIP = 'models/ship.glb';
const SKY = 'env/harbor.ktx2';

export default defineSketch(
  async ({ assets, scene }) => {
    const [ship, sky] = await Promise.all([assets.loadGltf(SHIP), assets.loadEnvironment(SKY)]);
    scene.setEnvironment(sky);
    scene.instantiate(ship);
  },
  { downloads: [SHIP, SKY] },
);
```

A live start begins the downloads as soon as the module has loaded. That is often before the engine's core has arrived, so the files download while the engine starts. The setup's loads take the bytes that arrived or are on their way, and nothing downloads twice. Each address resolves against the page's address, as the loading calls' addresses do.

- List the files in the order that the setup needs them. Two download at a time, so the engine's own files, such as the shaders of the first frame, still find free connections to the server. A load of a later file moves it to the front of the list. While loads wait for listed files, up to four download at once, which still leaves connections for the engine's own files.
- Name only the files that the first frame waits for. A file that loads after the first frame takes bandwidth from the files that the first frame needs. Start its load when `engine.firstFrame` resolves instead ([The engine field](#the-engine-field)).
- A file that no load takes costs its download, and its bytes stay in memory until the engine stops. Nothing decodes it.
- Hold mode, a replay and a recording download each file at its load, as without the list, so their runs stay the same.
- `assets.onProgress` counts the listed files, also the bytes that arrived before the setup added the handler.

An entry that is not a file's address, such as an empty string, fails the start with [E1214](../errors/E1214.md). A listed file that does not download fails the load that takes it with [E1411](../errors/E1411.md).

### Loads one after another

A development build watches the setup's loads. Sometimes a load starts its download only after another load's file has arrived, while no other file downloads. The console then shows one warning that names both files. The two files could have downloaded together, and the first frame waited for the gap. Start both loads before you await either, as `Promise.all` does above, or name both files in `downloads`. An environment that the engine makes with no file counts as an earlier load too. A load that starts only after `assets.builtinEnvironment` or `assets.skyEnvironment` has finished could have started beside it.

When the second file's address comes from the first file, as a level file names its models, the order is needed. A JSON file that holds the second file's name passes without a warning. For other such cases, pass `serialLoadWarning: false`. The engine watches only the loads of a live setup, not a model's own files and not loads after the first frame. A production build has no warning.

## The context

| Field | What it holds |
| --- | --- |
| `data` | The page's start data, or `undefined` when it passes none: [Start data](page.md#start-data) |
| `scene` | Objects, cameras, lights, instance batches and the background: [Scene](scene.md) |
| `geometry` | Mesh generators, such as `geometry.box` and `geometry.sphere` |
| `materials` | Material factories: [Materials](materials.md) |
| `textures` | Textures from decoded images and from data: [Textures](textures.md) |
| `assets` | Downloads of textures, JSON and binary files, with preloads and progress: [Assets](assets.md) |
| `input` | Pointer, touch, keyboard and gamepad input, and action maps: [Input](input.md) |
| `post` | The tone mapping and the exposure: [Post-processing API](post.md) |
| `render` | The sketch's own render passes, such as a camera that draws into a texture: [Render graph API](render.md) |
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

`engine.held` is true when the engine steps the sketch itself, as hold mode and a replay do. It is false when the sketch runs live. A sketch that returns before its scene is complete waits for it when this is true. A held frame or a replay then shows the finished scene. A live page starts the work without awaiting it, and the result appears as it lands.

`engine.firstFrame` is a promise that resolves once the GPU has finished the engine's first frame, as `engine.firstFrame` does on the page. Start the downloads that the first frame does not need when it resolves. They then leave the network to the first frame's own files, such as its shaders. A frame number is no such signal: the thread that draws can still be drawing the first frame while the sketch runs the second. Never await the promise in the setup, because the first frame waits for the setup. In hold mode and a replay, the promise resolves once the engine has stepped the sketch to its last frame. No frame follows that one, so the work that it starts never changes what those modes show. The promise never resolves when the engine stops first.

```ts
export default defineSketch(({ scene, engine }) => {
  // A portrait screen gets a wider view, so the scene still fits across it.
  const portrait = engine.viewport.height > engine.viewport.width;
  const camera = scene.createPerspectiveCamera({ fov: portrait ? 75 : 50, position: [0, 2, 6] });
  scene.setActiveCamera(camera);
});
```

A scene that adds far scenery after the first frame starts its download then, and in hold mode loads it in the setup:

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';

export default defineSketch(async ({ assets, engine, scene }) => {
  const addForest = async () => scene.instantiate(await assets.loadGltf('models/forest.glb'));
  // Build the first view here.
  if (engine.held) await addForest(); // a held frame shows the finished scene
  else void engine.firstFrame.then(addForest).catch((error) => console.error(error)); // the forest appears as it lands
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

`onDestroy()` runs once when the engine stops, on the sketch's thread, before its workers stop. Remove the timers, event listeners and message handlers that the sketch added outside the engine there. After it, every call to the engine fails with [E1420](../errors/E1420.md).

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
