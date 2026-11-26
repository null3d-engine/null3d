---
id: api/reference/sound
title: "Sound (@null3d/sound): API reference"
status: generated
since: "0.3"
summary: "Every export of the Sound (@null3d/sound) API, from the engine's doc comments."
---

# Sound (@null3d/sound): API reference

> [Sound (@null3d/sound)](../sound.md) explains these exports. The engine's doc comments make this page.

## `connectSound`

```ts
function connectSound(engine: Engine, options: PageSoundOptions = {}): PageSound
```

Connects the page to the sketch's sounds, which `createSound` makes in the sketch. Call it once, after `createEngine` resolves. Nothing plays until `start` runs in answer to a click, a tap or a key, or the user's first input with `startOnInput`.

## `createSound`

```ts
function createSound(ctx: SketchContext, options: SoundOptions): Sound
```

Makes the sketch's sounds. Call it in the sketch's setup, and call `update` once a frame in `onLateUpdate`. The sounds play on the page once the page's half, `connectSound` from `@null3d/sound/page`, has started the audio. A sketch may make its sounds at any time; a sound made before the page connects plays once it does.

## `NAMESPACE`

```ts
const NAMESPACE: AddonNamespace
```

The add-on's names, claimed once as the sketch loads: its name, its package and its error codes.

## `PageSound`

Interface `PageSound`.

The page's half of the sound, as `connectSound` makes it.

| Member | Description |
| --- | --- |
| `readonly state: SoundState` | Where the sound stands now. |
| `readonly muted: boolean` | True while the page's sound is muted. |
| `start(): Promise<void>` | Starts the audio. Call it in the handler of a click, a tap or a key, since browsers start a page's audio only in answer to the user. Resolves once the audio runs, with the sounds' files still loading; each sound fades in as its file arrives. |
| `setMuted(muted: boolean): void` | Mutes or unmutes every sound. |
| `onState(handler: (state: SoundState) => void): () => void` | Calls `handler` each time the state changes. Returns a function that removes the handler. |
| `stop(): void` | Stops the audio for good and closes the link to the sketch. The engine's stop does the same. |

## `PageSoundOptions`

Interface `PageSoundOptions`.

Options for `connectSound`.

| Member | Description |
| --- | --- |
| `startOnInput?: boolean` | Starts the sound on the user's first click, tap or key on the page, other than Escape. Browsers let a page start its audio only in answer to such an input. The default is false: the page calls `start` from its own control, such as a sound button. |
| `muted?: boolean` | Starts muted. The default is false. |

## `Sound`

Interface `Sound`.

The sketch's sounds, as `createSound` makes them.

| Member | Description |
| --- | --- |
| `readonly connected: boolean` | True once the page's half has opened its link to the sketch. |
| `loop(options: SoundLoopOptions): SoundLoop` | Makes a sound that plays its file over and over. |
| `group(options: SoundGroupOptions): SoundGroup` | Makes a group of sounds that play one file, of which the loudest few sound at once. |
| `shot(options: SoundShotOptions): SoundShot` | Makes a sound that plays its file once for each call of its `play`. |
| `setVolume(volume: number): void` | Sets the volume of every sound, from 0 to 1. |
| `update(): void` | Reads the listener's place and turn and counts the frame. Call it once a frame, in `onLateUpdate`, after the camera has moved. A sketch that stops calling it fades every sound out, as a paused engine does. |
| `destroy(): void` | Stops every sound and closes the link to the page. |

## `SoundGroup`

Interface `SoundGroup`.

Many sounds that play one file, such as the engines of the cars in a street, as `sound.group` makes it. Its arrays are views of the table, which a sketch may also write in bulk. They belong to the group until `destroy`: after it, the group's emitters may serve another sound, so a sketch drops the arrays with the group.

| Member | Description |
| --- | --- |
| `readonly count: number` | The members of the group. |
| `readonly positions: Float32Array` | Each member's place in the world, three numbers each. |
| `readonly levels: Float32Array` | Each member's level, from 0. |
| `readonly rates: Float32Array` | Each member's playback rate. |
| `readonly tones: Float32Array` | Each member's tone, from 0 to 1. |
| `setPosition(index: number, x: number, y: number, z: number): void` | Moves member `index` to a place in the world. |
| `setLevel(index: number, level: number): void` | Sets member `index`'s level. |
| `setRate(index: number, rate: number): void` | Sets member `index`'s playback rate. |
| `setTone(index: number, tone: number): void` | Sets member `index`'s tone. |
| `destroy(): void` | Stops every member, with a short fade, and frees the group's emitters and voices. |

## `SoundGroupOptions`

Interface `SoundGroupOptions`, which extends `SoundPlacement`.

Options for `sound.group`.

| Member | Description |
| --- | --- |
| `file: string \| URL` | The audio file that every member plays, as `SoundLoopOptions.file` takes it. |
| `count: number` | The members of the group, each with its own place, level, rate and tone. |
| `voices: number` | The members that sound at once: the loudest where the listener stands. |

## `SoundListener`

Interface `SoundListener`.

The object that hears the sounds, usually the active camera. The add-on reads its place and turn in the world once a frame. A camera looks down its own -Z axis, and so does the listener.

| Member | Description |
| --- | --- |
| `getWorldPosition(out: Vec3Like): void` | Writes the object's place in the world into `out`. |
| `getWorldQuaternion(out: QuatLike): void` | Writes the object's turn in the world, as a quaternion, into `out`. |

## `SoundLoop`

Interface `SoundLoop`.

A sound that plays its file over and over, as `sound.loop` makes it.

| Member | Description |
| --- | --- |
| `setLevel(level: number): void` | Sets the level, from 0. A level of 0 silences the sound. |
| `setRate(rate: number): void` | Sets the playback rate, where 1 is the file's own speed and pitch. |
| `setTone(tone: number): void` | Sets the tone, from 0 (muffled) to 1 (the file's own brightness). |
| `setPosition(x: number, y: number, z: number): void` | Moves the sound to a place in the world. A bed that plays in both ears ignores its place. |
| `destroy(): void` | Stops the sound, with a short fade, and frees its emitter and its voice. Its setters then do nothing. |

## `SoundLoopOptions`

Interface `SoundLoopOptions`, which extends `SoundPlacement`.

Options for `sound.loop`.

| Member | Description |
| --- | --- |
| `file: string \| URL` | The audio file's address. A relative address resolves against the page's address, as the engine's loaders do. `new URL('./file.mp3', import.meta.url)` names a file beside the sketch. |
| `positional?: boolean` | True for a sound that comes from a place, which `setPosition` moves. False for a bed that plays in both ears alike, such as wind or rain. The default is true. |
| `level?: number` | The first level, from 0. The default is 1. |
| `rate?: number` | The first playback rate, where 1 is the file's own speed and pitch. The default is 1. |
| `tone?: number` | The first tone, from 0 (muffled) to 1 (the file's own brightness). The default is 1. |
| `position?: readonly [number, number, number]` | The first place in the world. The default is the origin. |

## `SoundOptions`

Interface `SoundOptions`.

Options for `createSound`.

| Member | Description |
| --- | --- |
| `listener: SoundListener` | The object that hears the sounds, usually the active camera. |
| `capacity?: number` | The emitters that the sketch's sounds hold together: one for each loop, one for each member of a group, and one for each voice of a shot. The default is 256 and the most is 4,096. |
| `volume?: number` | The volume of every sound, from 0 to 1. The default is 1. |

## `SoundPlacement`

Interface `SoundPlacement`.

How a sound falls off with distance. A sound with neither distance keeps the level that the sketch gives it wherever the listener stands.

| Member | Description |
| --- | --- |
| `near?: number` | The distance within which the sound is at its full level. Beyond it the level falls as the distance grows: at twice this distance it is half. Leave it out for a sound whose level the sketch sets itself. |
| `far?: number` | The distance at which the sound has faded out. Leave it out for no such distance. |
| `muffle?: boolean` | Whether the sound loses its highs as it nears its far distance, as distant sounds do. The default is true for a sound with a far distance. |

## `SoundShot`

Interface `SoundShot`.

A sound that plays its file once for each call, such as thunder or a door, as `sound.shot` makes it.

| Member | Description |
| --- | --- |
| `play(x: number, y: number, z: number, level?: number, rate?: number): void` | Plays the file once at a place in the world, at a level and a playback rate. A shot that plays in both ears ignores the place. |
| `destroy(): void` | Stops every play and frees the shot's emitters and voices. |

## `SoundShotOptions`

Interface `SoundShotOptions`, which extends `SoundPlacement`.

Options for `sound.shot`.

| Member | Description |
| --- | --- |
| `file: string \| URL` | The audio file that each play starts, as `SoundLoopOptions.file` takes it. |
| `voices?: number` | The plays that sound at once. A play past this count stops the oldest. The default is 2. |
| `positional?: boolean` | True for a shot that comes from a place. The default is true. |

## `SoundState`

```ts
type SoundState = 'off' | 'starting' | 'on' | 'paused' | 'interrupted' | 'stopped';
```

Where the page's sound stands: not started, starting, playing, paused while the engine is paused or the page is hidden, interrupted while the browser holds the audio, as an iPhone does during a call, or stopped for good. An interrupted sound resumes at the user's next input, or when the page shows again.
