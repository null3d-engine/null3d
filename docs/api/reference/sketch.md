---
id: api/reference/sketch
title: "Sketch API: defineSketch and the context: API reference"
status: generated
since: "0.1"
summary: "Every export of the Sketch API: defineSketch and the context API, from the engine's doc comments."
---

# Sketch API: defineSketch and the context: API reference

> [Sketch API: defineSketch and the context](../sketch.md) explains these exports. The engine's doc comments make this page.

## `defineSketch`

```ts
function defineSketch(setup: SketchSetup, options: SketchOptions = {}): SketchDefinition
```

Declares a sketch. In null3D, a 3D scene is called a sketch: a module that builds the scene and updates it every frame, in the sketch worker. The module must export the result as its default export. `options` sets the rate of the fixed steps.

## `SketchCallbacks`

Interface `SketchCallbacks`.

Callbacks a sketch returns from its setup function. In each frame the engine calls `onFixedUpdate` as many times as fixed steps fall due, then `onUpdate`, then updates transforms, then calls `onLateUpdate`.

| Member | Description |
| --- | --- |
| `onFixedUpdate(step: number): void` | Runs at a fixed rate, 60 times per second of sketch time unless `defineSketch`'s options set another, with the step's length in seconds. A frame runs it once for each step that falls due since the previous frame, so 0 or more times, before `onUpdate`. After a slow frame, a frame runs at most 8 steps unless the options set another number, and drops the rest. Use it for simulation, such as physics, that must step the same at every frame rate. |
| `onUpdate(dt: number): void` | Runs once per frame, before transforms, with the frame's step in seconds. The first frame, and the first after a pause or a hidden page, gets 0. No step is longer than a quarter second, so a very slow frame slows the sketch instead of jumping it. In hold mode, each frame after the first gets a fixed step of 1/60 second. |
| `onLateUpdate(dt: number): void` | Runs once per frame after the engine updates transforms, and before it culls and draws, with the frame's step in seconds. World positions already hold the frame's changes, and the engine updates the objects that it moves before it draws the frame. A camera that follows an object here does not lag a frame behind it. |
| `onDestroy(): void` | Runs once when the engine stops, on the sketch's thread, before its workers stop. Remove the timers, event listeners and message handlers that the sketch added outside the engine here. After it, every call to the engine fails with E1420. |

## `SketchContext`

Interface `SketchContext`.

What the engine passes to a sketch's setup function.

| Member | Description |
| --- | --- |
| `scene: Scene` | Objects, cameras, lights and instance batches. |
| `materials: Materials` | Material factories. |
| `geometry: Geometry` | Mesh generators. |
| `textures: Textures` | Textures from decoded images and from data. |
| `assets: Assets` | Loading of textures and files, with a count of downloads for loading screens. |
| `input: Input` | Pointer, touch, keyboard and gamepad input, which the page forwards to the sketch. |
| `post: Post` | Post-processing: the tone mapping and the exposure of the scene's color. |
| `render: Render` | The sketch's own render passes, such as a camera that draws into a texture. |
| `ui: Ui` | HTML labels that follow scene objects, which the page binds with `engine.labels.bind`. |
| `quality: Quality` | The quality preset that the engine runs, its settings, and a notice when they change. |
| `time: SketchTime` | Sketch time, the frame's step and the frame number. |
| `engine: SketchEngine` | The canvas's size, and what the device can do. |
| `preferences: SketchPreferences` | What the user's system asks of every page, and a notice when that changes. |
| `page: { post(type: string, data?: unknown, transfer?: Transferable[]): void; onMessage(handler: (type: string, data: unknown) => void): () => void; }` | Messages between the sketch and the page. `onMessage` returns a function that removes the handler. |
| `debug: Debug` | Debug drawing: lines, boxes, spheres, arrows, axes, grids, camera frustums and lights, drawn for one frame. Only development builds draw them. |

## `SketchDefinition`

Interface `SketchDefinition`.

A sketch, as `defineSketch` returns it.

| Member | Description |
| --- | --- |
| `readonly setup: SketchSetup` | The setup function passed to `defineSketch`. |
| `readonly options: SketchOptions` | The options passed to `defineSketch`. |

## `SketchEngine`

Interface `SketchEngine`.

The engine as the sketch sees it: the canvas's size, and what the device can do.

| Member | Description |
| --- | --- |
| `readonly viewport: SketchViewport` | The canvas's size in CSS pixels, and the pixel ratio the engine draws with. |
| `readonly capabilities: EngineCapabilities` | The GPU path the engine chose, and what it offers: the values of `engine.capabilities` on the page. |

## `SketchOptions`

Interface `SketchOptions`.

Options for `defineSketch`.

| Member | Description |
| --- | --- |
| `fixedRate?: number` | Fixed steps per second of sketch time, the rate of `onFixedUpdate`. The default is 60. |
| `maxFixedSteps?: number` | The most fixed steps that one frame runs, after a slow frame. The default is 8. |

## `SketchPreferences`

Interface `SketchPreferences`.

The user's display preferences, which the page reads from the system and passes on.

| Member | Description |
| --- | --- |
| `readonly reducedMotion: boolean` | True when the user asks for less motion: the `prefers-reduced-motion` setting. Bring motion that only decorates to rest, such as an idle spin, camera sway or drifting particles. Keep motion the user controls, and motion that carries meaning, and prefer cuts to long camera flights. In hold mode it is always false, so a held frame is the same on every machine. |
| `onChange(handler: () => void): () => void` | Calls `handler` at the start of the first frame after a preference changes. Returns a function that removes the handler. |

## `SketchSetup`

```ts
type SketchSetup = (context: SketchContext) => SketchCallbacks | undefined | Promise<SketchCallbacks | undefined>;
```

A sketch's setup function. The engine calls it once, in the sketch worker, and it returns the sketch's callbacks, directly or through a promise.

## `SketchViewport`

Interface `SketchViewport`.

The canvas's size. The engine reads it at the start of each frame, so it stays the same throughout a frame.

| Member | Description |
| --- | --- |
| `readonly width: number` | The canvas width in CSS pixels. |
| `readonly height: number` | The canvas height in CSS pixels. |
| `readonly pixelRatio: number` | Device pixels per CSS pixel that the engine draws with: the display's ratio, capped by the `maxPixelRatio` quality setting. It is lower on a canvas too large for the GPU's largest texture at that ratio. |
