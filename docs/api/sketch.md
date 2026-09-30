---
id: api/sketch
title: "Sketch API: defineSketch and the context"
status: planned
since: "0.1"
summary: "The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks."
---

<!-- null3d:placeholder -->

# Sketch API: defineSketch and the context

> Planned for null3D 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists the APIs the engine has now. The rest of the page is not written yet.

This page will cover: The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks.

## API reference

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
| `post: Post` | Post-processing: the tone mapping and the exposure of the scene's color. |
| `time: { now: number; frame: number; }` | Sketch time in seconds, which is the sum of every step that `onUpdate` received, so paused and hidden time do not count. Also the current frame number. In hold mode, the last frame's time is the held time exactly. |
| `preferences: SketchPreferences` | What the user's system asks of every page, and a notice when that changes. |
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
