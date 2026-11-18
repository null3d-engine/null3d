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
| `readonly updateInterval: number` | The frames between two updates of the object's pose. The value 1, the default, updates it in every frame. A larger number samples and composes it once every that many frames, and holds the last pose in between. A far crowd then costs less on the job workers, and, where the skinning pass skips a held pose, on the GPU too. The object's clips keep their real speed. Each update covers the frames that it skipped. |
| `setUpdateInterval(frames: number): void` | Sets the frames between two updates of the object's pose, a whole number from 1 to 64. The value 1, the default, updates the pose in every frame, which a character near the camera needs. A larger value leaves a far character in the pose of its last update for longer, which steps. Give a crowd's near characters 1 and its far ones more. It writes engine memory, so calling it every frame costs nothing. |
| `joint(name: string): number` | The index of the joint named `name`, which the joint calls take in place of its name. Look it up once and keep it: an index skips the name lookup in each call. |
| `setJointRotation(joint: number \| string, rotation: QuatLike, weight = 1): void` | Sets a joint's rotation relative to its parent, as a quaternion `[x, y, z, w]`, on top of the clips. The joint turns from its animated rotation toward this one by `weight`, from 0 to 1. At 1 it takes the rotation, as three.js's `bone.quaternion.copy` does after the mixer's update. The joints below it follow. The rotation holds in every frame until `clearJoint`, so call it again only to change it. It writes engine memory, so calling it every frame costs nothing. |
| `addJointRotation(joint: number \| string, rotation: QuatLike, weight = 1): void` | Turns a joint by a rotation, a quaternion `[x, y, z, w]`, on top of its animated rotation, in the joint's own frame, as three.js's `bone.quaternion.multiply` does after the mixer's update. `weight`, from 0 to 1, scales the turn. A walking soldier then twists or leans while the clips move it. The turn holds in every frame until `clearJoint`, and calling it every frame costs nothing. |
| `clearJoint(joint: number \| string): void` | Removes the rotations that `setJointRotation` and `addJointRotation` gave a joint. |
| `lookAt(target: Vec3Like \| null, options?: LookAtOptions, weight = 1): void` | Turns a chain of joints, such as the spine, neck and head, so that the last one aims at `target`, a point in the world. The engine aims again in each frame from the pose that the clips and the joint rotations give, until `lookAt(null)` stops it. So a soldier keeps its rifle on a target while it walks. `weight`, from 0 to 1, blends the turn with the animated pose. Call it every frame to follow a moving point. The options hold until a call gives others, and a frozen options object is read once, so the call allocates nothing. |
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

## `LookAtOptions`

Interface `LookAtOptions`.

How `Animator.lookAt` turns a chain of joints toward a point. A look-at reads a frozen object once, so a game that keeps its options in frozen constants aims without allocating.

| Member | Description |
| --- | --- |
| `joints: string \| readonly string[]` | The joints that turn, parents first, up to 4, such as `['Spine', 'Neck', 'Head']`. The last one aims at the point. Each joint must be below the joint before it. |
| `limit?: number \| readonly number[]` | The most that each joint turns away from its animated pose, in radians: one number for every joint, or one per joint. The default is π / 3, a sixth of a turn. |
| `shares?: readonly number[]` | How the turn splits between the joints, one number per joint. Each joint takes its share of the turn that the joints before it left, so the last joint finishes the aim. The default gives every joint the same share. |
| `forward?: Vec3Like` | The direction that the last joint aims, in the object's space when the model was bound, as `[x, y, z]`. The default, `[0, 0, 1]`, is where glTF models face. |

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
| `transition?: 'blend' \| 'inertial'` | How a play with a `fade` switches what its layer plays. `'blend'`, the default, cross-fades the layer's old clips with the new one, as three.js's `crossFadeTo` does, and samples both while the fade runs. `'inertial'` samples only the new clip: the pose the layer leaves continues on its path and eases into the new clip, which keeps feet from sliding through a mixed gait. It needs a fade above 0, no `weight`, and a clip already playing on the layer, whose pose it carries on from. A play of a clip that already plays on the layer keeps that clip's time and fades it back in instead, so it is no inertial switch. `crossFade` always cross-fades, so a port of `crossFadeTo` shows the blend that three.js shows. |

## `PropertyAnimation`

Class `PropertyAnimation`.

One property's keyframes, playing. `scene.animateProperty` returns one: the engine samples it each frame and writes the target's value, so a sketch has no update call to make. A frozen keyframes object is read once.

| Member | Description |
| --- | --- |
| `readonly time: number` | The animation's time in seconds. |
| `readonly playing: boolean` | True while the animation runs. |
| `readonly loop: boolean` | True when the animation repeats, and false when it holds its last key. |
| `readonly speed: number` | The rate of the animation's time: 1 plays it as made, and a negative rate plays it backward. |
| `setTime(seconds: number): void` | Sets the animation's time in seconds, as three.js's `action.time` does. |
| `setPaused(paused: boolean): void` | Starts or stops the time, without changing the value that the target holds. |
| `setLoop(loop: boolean): void` | Repeats the animation, or makes it hold its last key at its end. |
| `setSpeed(speed: number): void` | Sets the rate of the animation's time: 1 plays it as made, and 2 twice as fast. A negative rate plays it backward. |
| `stop(): void` | Stops the animation, and leaves the target at the value that the last frame wrote. |

## `PropertyInterpolation`

```ts
type PropertyInterpolation = 'linear' | 'step' | 'cubic';
```

How a track's value moves between its keys: in a straight line (the default), held until the next key (`'step'`), or along glTF's cubic spline (`'cubic'`).

## `PropertyKeyframes`

Interface `PropertyKeyframes`.

The keyframes of one property: the time of each key in seconds, and the value of each key. A key holds one number for a value such as an intensity, three for a color or a position, and four for a rotation as a quaternion `[x, y, z, w]`. A cubic key holds three times as many numbers: an in-tangent, the value and an out-tangent.

| Member | Description |
| --- | --- |
| `times: ArrayLike<number>` | The key times in seconds, in order, never falling back. |
| `values: ArrayLike<number>` | The values of the keys, one key after another. |
| `interpolation?: PropertyInterpolation` | How the value moves between keys: `'linear'` (the default), `'step'` or `'cubic'`. |
| `loop?: boolean` | True, the default, repeats the animation. False plays it once and holds its last key. |
| `speed?: number` | The rate of the animation's time: 1, the default, plays it as made, and 2 twice as fast. |
| `time?: number` | The time in seconds at which the animation starts, or its first key. |
| `paused?: boolean` | True starts the animation paused. |

## `StopOptions`

Interface `StopOptions`.

How `Animator.stop` stops clips.

| Member | Description |
| --- | --- |
| `fade?: number` | Seconds over which the clips fade out. The default, 0, stops them at once. |
