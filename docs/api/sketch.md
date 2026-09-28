---
id: api/sketch
title: "Sketch API: defineSketch and the context"
status: planned
since: "0.1"
summary: "The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks."
---

<!-- null3d:placeholder -->

# Sketch API: defineSketch and the context

> Planned for null3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.

This page will cover: The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks.

## API reference

### `defineSketch`

```ts
function defineSketch(setup: SketchSetup): SketchDefinition
```

Declares a sketch. In null3d, a 3D scene is called a sketch: a module that builds the scene and updates it every frame, in the sketch worker. The module must export the result as its default export.

### `SketchCallbacks`

Interface `SketchCallbacks`.

Callbacks a sketch returns from its setup function.

| Member | Description |
| --- | --- |
| `onUpdate(dt: number): void` | Runs once per frame, before transforms, with the frame's step in seconds. The first frame, and the first after a pause or a hidden page, gets 0. No step is longer than a quarter second, so a very slow frame slows the sketch instead of jumping it. |

### `SketchContext`

Interface `SketchContext`.

What the engine passes to a sketch's setup function.

| Member | Description |
| --- | --- |
| `scene: Scene` | Objects, cameras, lights and instance batches. |
| `materials: Materials` | Material factories. |
| `geometry: Geometry` | Mesh generators. |
| `time: { now: number; frame: number; }` | Sketch time in seconds, which is the sum of every step that `onUpdate` received, so paused and hidden time do not count. Also the current frame number. |
| `page: { post(type: string, data?: unknown, transfer?: Transferable[]): void; onMessage(handler: (type: string, data: unknown) => void): void; }` | Messages between the sketch and the page. |

### `SketchDefinition`

Interface `SketchDefinition`.

A sketch, as `defineSketch` returns it.

| Member | Description |
| --- | --- |
| `readonly setup: SketchSetup` | The setup function passed to `defineSketch`. |

### `SketchSetup`

```ts
type SketchSetup = (context: SketchContext) => SketchCallbacks | undefined | Promise<SketchCallbacks | undefined>;
```

A sketch's setup function. The engine calls it once, in the sketch worker, and it returns the sketch's callbacks, directly or through a promise.
