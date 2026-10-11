---
id: api/reference/animation
title: "Animation: API reference"
status: generated
since: "0.2"
summary: "Every export of the Animation API, from the engine's doc comments."
---

# Animation: API reference

> [Animation](../animation.md) explains these exports. The engine's doc comments make this page.

## `AnimationEvent`

Interface `AnimationEvent`.

An event that a playing clip reached, which `Animator.onEvent` handlers get. The animator passes the same object to every handler of every event, so copy what you keep.

| Member | Description |
| --- | --- |
| `readonly name: string` | The event's name: one of the clip's events, 'loop' when a repeating clip starts again, or 'finished' when a clip that plays once reaches its end. |
| `readonly clip: string` | The clip's name. |
| `readonly layer: number` | The layer the clip plays on. |

## `AnimationEventHandler`

```ts
type AnimationEventHandler = (event: AnimationEvent) => void;
```

A handler of an animated object's events.

## `Animator`

Class `Animator`.

Plays an animated object's clips. It fades between them, blends them in layers with joint masks, adds additive clips on top, and calls handlers for the clips' events. The engine advances every animator on its job workers each frame, so a sketch has no update call to make. Get an object's animator with `object.animator()`.

| Member | Description |
| --- | --- |
| `readonly object: Object3D` | The object that the animator moves. |
| `readonly clips: readonly string[]` | The names of the clips that the object can play. |
| `readonly timeScale: number` | The rate of the object's animation time: 1 by default, 0 to pause every clip. |
| `describe(): string` | The object, as error messages name it. |
| `play(name: string, options?: PlayOptions): void` | Plays a clip. It fades in over `fade` seconds while the other clips of its layer fade out, or with no fade, takes over at once. With a `weight`, it joins the layer's other clips instead. A clip that already plays on the layer keeps its time and fades back in. A clip that played once and reached its end starts again. |
| `crossFade(name: string, duration: number, options?: PlayOptions): void` | Fades to a clip over `duration` seconds while the layer's other clips fade out, as three.js's `crossFadeTo` does. It is `play(name, { ...options, fade: duration })`, but a clip with a weight still takes over. |
| `setWeight(name: string, weight: number): void` | Sets the weight of a clip that plays, 0 or more, on every layer that plays it, as three.js's `setEffectiveWeight` does. A clip at weight 0 leaves the pose but keeps playing, so its time moves on. A fade multiplies the weight. It writes engine memory, so calling it every frame costs nothing. |
| `playBlend(points: Readonly<Record<string, number>>, options?: BlendOptions): void` | Plays a 1D blend of clips. Each clip counts in full at its point, such as `{ idle: 0, walk: 1.4, run: 4 }` for a blend by speed. Between two points, the two clips around the blend value share it, and `setBlend` moves the value. The clips keep one phase: each clip's time moves at its length over the length of the blend's clips, averaged by their weights. A walk and a run of different lengths then keep their steps together. The layer's other clips fade out over `fade` seconds, as with `play`. |
| `setBlend(value: number, layer = 0): void` | Sets the blend value of a layer's blend: the clip at that point counts in full, and a value between two points mixes the two clips around it. A value past the first or the last point gives that point's clip. It writes engine memory, so calling it every frame costs nothing. |
| `stop(name?: string, options?: StopOptions): void` | Stops a clip on every layer, or with no name, every clip, fading out over `fade` seconds. |
| `setLayerWeight(layer: number, weight: number): void` | Sets a layer's weight, from 0 to 1. Layer 0 blends with the rest pose below it, and each layer above replaces the pose below by its weight. Weights start at 1. It writes engine memory, so calling it every frame costs nothing. |
| `setLayerMask(layer: number, joints: string \| readonly string[] \| null): void` | Limits a layer to some joints: each named joint and every joint below it, such as 'Spine' for the upper body. `null` gives the layer every joint again. |
| `setTimeScale(scale: number): void` | Sets the rate of the object's animation time: 1 plays clips as made, 0 pauses them all. |
| `onEvent(name: string, handler: AnimationEventHandler): () => void` | Calls `handler` for each event named `name` that a playing clip reaches: an event in the clip's data, 'loop' when a repeating clip starts again, or 'finished' when a clip that plays once reaches its end. Handlers run on the sketch's thread at the start of the next frame's update, before `onFixedUpdate` and `onUpdate`. Returns a function that removes the handler. |

## `BlendOptions`

Interface `BlendOptions`.

How `Animator.playBlend` plays a 1D blend. Like `PlayOptions`, a frozen object is read once.

| Member | Description |
| --- | --- |
| `value?: number` | The blend value, which picks the mix, as `setBlend` sets it. Without it, the layer keeps its value, 0 at first. |
| `fade?: number` | Seconds over which the blend fades in while the layer's other clips fade out. The default, 0, switches at once. |
| `loop?: boolean` | True, the default, repeats the clips. False plays them once and holds their last frames. |
| `speed?: number` | The rate of the blend. 1, the default, moves it through one cycle in the length of its clips, averaged by their weights. A negative rate plays it backward. |
| `layer?: number` | The layer, a whole number from 0, the default, to 3. |
| `phase?: number` | The share of their cycle, from 0 to 1, at which the clips start: 0.5 starts each clip halfway through. Without it, the blend takes the phase of the layer's blend, or of the first of its clips that the layer plays, so the switch keeps the step. Otherwise the clips start at their first frames. |

## `PlayOptions`

Interface `PlayOptions`.

How `Animator.play` plays a clip. A play reads a frozen object once, so a game that keeps its options in frozen constants switches clips without allocating.

| Member | Description |
| --- | --- |
| `fade?: number` | Seconds over which the clip fades in while the layer's other clips fade out. The default, 0, switches at once. |
| `loop?: boolean` | True, the default, repeats the clip. False plays it once and holds its last frame. |
| `speed?: number` | The rate of the clip's time. 1, the default, plays it as made, and 2 twice as fast. A negative rate plays it backward from its end. |
| `layer?: number` | The layer, a whole number from 0, the default, to 3. Each layer above 0 replaces the pose of the layers below by its weight, on the joints of its mask. |
| `additive?: boolean` | True adds the clip's change from its first frame to the pose of the layers, as three.js's additive clips do. A breathing or aiming clip then plays on top of a walk. An additive play replaces only the additive clips of its layer, and a plain play only the plain ones. |
| `time?: number` | Seconds into the clip at which it starts, as three.js's `action.time` sets it. A repeating clip wraps the time into its length, and a clip that plays once holds it within its length. Without it, a clip starts at its first frame, and a clip that already plays keeps its time. |
| `weight?: number` | The clip's own weight, 0 or more, as three.js's `setEffectiveWeight` sets it. A play with a weight joins the other clips of its layer instead of fading them out, so a walk at 0.3 and a run at 0.7 blend. A fade multiplies the weight. Without it, a clip that starts takes 1, and a clip that already plays keeps its weight. |

## `StopOptions`

Interface `StopOptions`.

How `Animator.stop` stops clips.

| Member | Description |
| --- | --- |
| `fade?: number` | Seconds over which the clips fade out. The default, 0, stops them at once. |
