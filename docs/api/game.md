---
id: api/game
title: "Game API: defineGame and the context"
status: planned
since: "0.1"
summary: "The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks."
---

<!-- sokko3d:placeholder -->

# Game API: defineGame and the context

> Planned for sokko3d 0.1. No release has these APIs yet, so coding agents must not use them. The reference below lists what the engine in this repository has so far, and the rest of the page is not written yet.

This page will cover: The context object: scene, assets, materials, geometry, textures, input, time, quality, post, render, page, ui, debug; the callbacks.

## API reference

This reference is generated from the TSDoc comments in `packages/engine/src`. To change it, edit the comments.

### `defineGame`

```ts
function defineGame(setup: GameSetup): GameDefinition
```

Declares a game. The module that calls it must export the result as its default export.

### `GameCallbacks`

Interface `GameCallbacks`.

Callbacks a game returns from its setup function.

| Member | Description |
| --- | --- |
| `onUpdate(dt: number): void` | Runs once per frame, before transforms, with the frame time in seconds. |

### `GameContext`

Interface `GameContext`.

What the engine passes to a game's setup function.

| Member | Description |
| --- | --- |
| `scene: Scene` | Objects, cameras, lights and instance batches. |
| `materials: Materials` | Material factories. |
| `geometry: Geometry` | Mesh generators. |
| `time: { now: number; frame: number; }` | Time since the game started, in seconds, and the current frame number. |
| `page: { post(type: string, data?: unknown, transfer?: Transferable[]): void; onMessage(handler: (type: string, data: unknown) => void): void; }` | Messages between the game and the page. |

### `GameDefinition`

Interface `GameDefinition`.

A game, as `defineGame` returns it.

| Member | Description |
| --- | --- |
| `readonly setup: GameSetup` | The setup function passed to `defineGame`. |

### `GameSetup`

```ts
type GameSetup = (context: GameContext) => GameCallbacks | undefined | Promise<GameCallbacks | undefined>;
```

A game's setup function. The engine calls it once, in the game worker, and it returns the game's callbacks, directly or through a promise.
