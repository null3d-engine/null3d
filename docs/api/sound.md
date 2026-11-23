---
id: api/sound
title: "Sound (@null3d/sound)"
status: experimental
since: "0.3"
summary: "createSound and connectSound: loops, groups and one-shots placed in the scene, played with the browser's audio and driven from the sketch on the audio thread."
---

# Sound (@null3d/sound)

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

```mermaid
flowchart LR
    sketch["Sketch worker<br/>createSound: loops,<br/>groups and shots"] -- "writes places, levels,<br/>rates and tones" --> table[("One shared<br/>table")]
    table --> mixer["Audio thread<br/>the mixer"]
    page["Page<br/>connectSound: files<br/>and audio nodes"] --> nodes["Each voice:<br/>source, filter,<br/>gain, panner"]
    mixer -- "drives every voice<br/>in each quantum" --> nodes
    nodes --> out["Speakers or<br/>headphones"]
```

`@null3d/sound` plays sound that follows the scene. A sketch makes its sounds and moves them as it moves its objects. The page plays them with the browser's audio, through the add-on's page half. A sound can come from a place, such as a waterfall or a car. It can also play in both ears alike, such as wind or rain.

The browser offers its audio only on the page's main thread, and the sketch runs in a worker. The add-on bridges the two. The sketch writes each sound's place, level, playback rate and tone into a table that the page shares. A mixer on the browser's audio thread reads that table and drives every voice. No frame sends a message, and the page's thread does no work while the sound plays.

```sh
bun add @null3d/sound
```

```ts
// sketch.ts
import { defineSketch } from '@null3d/engine';
import { createSound } from '@null3d/sound';

export default defineSketch((ctx) => {
  const { scene } = ctx;
  const camera = scene.createPerspectiveCamera({ position: [0, 1.6, 6], target: [0, 1, 0] });
  scene.setActiveCamera(camera);

  const sound = createSound(ctx, { listener: camera });
  // A waterfall at a place, full within 4 m and gone by 120 m.
  const fall = sound.loop({ file: '/sounds/waterfall.mp3', near: 4, far: 120 });
  fall.setPosition(-20, 2, -30);
  // Wind in both ears, whose level the sketch sets each frame.
  const wind = sound.loop({ file: '/sounds/wind.mp3', positional: false, level: 0.5 });

  return {
    onUpdate() {
      wind.setLevel(0.4 + 0.2 * Math.sin(ctx.time.now * 0.3));
    },
    onLateUpdate() {
      sound.update();
    },
  };
});
```

```ts
// page.ts
import { createEngine } from '@null3d/engine';
import { connectSound } from '@null3d/sound/page';

const engine = await createEngine({
  canvas: document.querySelector('canvas')!,
  sketch: new URL('./sketch.ts', import.meta.url),
});
const sound = connectSound(engine);
document.querySelector('#sound')!.addEventListener('click', () => void sound.start());
```

Call `sound.update()` once a frame, in `onLateUpdate`, after the camera has moved. It reads the listener's place and turn. A browser starts a page's audio only in answer to the user. So the page calls `start` from a click, a tap or a key. `connectSound(engine, { startOnInput: true })` starts it on the user's first input instead.

## The sketch's calls

| Call | What it does |
| --- | --- |
| `createSound(ctx, options)` | Makes the sketch's sounds. `listener` is required: the camera, or another object that hears. `capacity` is the emitters that the sounds hold together, 256 by default and 4,096 at most. `volume` sets every sound's volume, from 0 to 1. |
| `loop(options)` | A sound that plays its file over and over. `positional: false` makes a bed that plays in both ears. `level`, `rate`, `tone` and `position` give its first values. |
| `group(options)` | `count` sounds that play one file, of which the loudest `voices` sound at once. Use it for the cars in a street or the bees of a swarm. |
| `shot(options)` | A sound that plays its file once for each call of its `play`, such as thunder. `voices` plays that many at once, 2 by default. A play past that count stops the oldest. |
| `setVolume(volume)` | The volume of every sound, from 0 to 1. |
| `update()` | Reads the listener's place and turn, and counts the frame. Call it once a frame. |
| `destroy()` | Stops every sound and closes the link to the page. |
| `connected` | True once the page's half has opened its link. |

A loop has `setLevel`, `setRate`, `setTone`, `setPosition` and `destroy`. A group has the same setters with a member's index first, such as `setPosition(index, x, y, z)`. A group also has the arrays `positions`, `levels`, `rates` and `tones`, which are views of the table. A sketch that keeps its places in one array copies them in one call, as in `cars.positions.set(places)`. A shot has `play(x, y, z, level, rate)` and `destroy`.

The setters write numbers into the table and make no object, so a sketch may call them in every frame. `update` makes no object either. A sound made before the page connects plays once it does, and a sketch may make sounds at any time.

## The values of a sound

| Value | Range | What it does |
| --- | --- | --- |
| level | 0 and up, 1 by default | The sound's loudness. 0 silences it. |
| rate | 1 by default | The playback rate. 2 plays the file twice as fast and an octave higher. Tie it to a car's speed for its engine. |
| tone | 0 to 1, 1 by default | A low-pass filter. 1 plays the file as it is, and 0 keeps only its lows, from about 120 Hz down. Strong wind sounds brighter than a breeze, so raise its tone with its speed. |
| place | world units | Where the sound comes from. A bed that plays in both ears has no place. |

Each value eases toward the one that the sketch writes, so a change never clicks. The level eases in about 50 ms, and the tone and the rate in about 80 ms.

## Distance

A sound's options take a placement:

| Option | What it does |
| --- | --- |
| `near` | The distance within which the sound plays at its full level. Beyond it the level falls with distance: at twice `near` it is half, at four times a quarter. |
| `far` | The distance at which the sound has faded out. The fade starts at 60% of it. |
| `muffle` | Whether the sound loses its highs as it nears `far`, as distant sounds do. It is on by default when `far` is given. |

A sound with neither distance keeps the level that the sketch gives it wherever the listener stands. Use that for a bed whose level the sketch works out itself, such as the sea, which grows louder as the camera nears the shore.

## Groups and their voices

A browser mixes a few dozen voices well, and a scene may have hundreds of sources of one kind. A group gives its members a few voices. The mixer ranks the members by their loudness where the listener stands, from their level and distance. It gives each voice to one of the loudest. A voice keeps its member while that member stays close to the cut. So a voice does not flap between two members at the same distance. A voice that moves to another member fades out first, so its sound never jumps across the scene.

The page plays 32 voices at most. A loop takes one voice, a group takes its `voices`, and a shot takes its `voices`. A sketch that asks for more than 32 at once gets error 2501, which names the count.

## The page's calls

| Call | What it does |
| --- | --- |
| `connectSound(engine, options)` | Connects the page to the sketch's sounds. Call it once, after `createEngine` resolves. `startOnInput` starts the audio on the user's first press, click, tap or key. `muted` starts muted. |
| `start()` | Starts the audio. Call it in the handler of a click, a tap or a key. It resolves once the audio runs, and each sound fades in as its file arrives. |
| `setMuted(muted)` | Mutes or unmutes every sound. |
| `state` | `off` before `start`, then `starting`, `on`, `paused` while the engine is paused, and `stopped` after the engine stops. |
| `onState(handler)` | Calls the handler at each change of the state, such as to label a sound button. Returns a function that removes the handler. |
| `stop()` | Stops the audio for good. The engine's stop does the same. |

The page loads nothing until `start` runs: no file and no audio. Each file loads once, however many sounds play it. A file that fails to load leaves its sounds silent, and the console names the file.

## Pauses and hidden pages

When the sketch's frames stop, every sound fades out within about half a second, and the page suspends the audio. That happens when `engine.setPaused(true)` pauses the engine, when the browser hides the page, and when a sketch stops calling `update`. The audio resumes, and the sounds fade back in, when the frames move again.

## Panning and the quality presets

A sound that comes from a place plays through the browser's panner. The High and Ultra presets use its HRTF model, which places a sound around the head on headphones. Low and Medium use equal-power panning, which places it between the speakers and costs less on the audio thread. A change of preset changes every voice's panning.

## Files

Name each file by an absolute address, such as `'/sounds/sea.mp3'`, or with `new URL('./sea.mp3', import.meta.url)`. The page fetches it, so a relative string would resolve against the sketch worker's own address. MP3 decodes in every browser. MP3 and AAC add a little silence at each end of a file. The add-on skips that padding, up to 2,048 samples at each end, so a loop joins with no gap. A loop's own sound must not fall that quiet at its ends. A file made to loop joins its end to its start, as the sample loops do.

## Browsers

- Firefox's audio listener has no place parameters. The mixer turns each sound's place into the listener's frame, so the listener stays still in every browser.
- An iPhone's silent switch mutes a page's audio unless the page plays media. The add-on sets the page's audio session to playback where Safari offers it.
- A page without cross-origin isolation runs the sketch on its own thread ([Hosting and cross-origin isolation](../getting-started/hosting.md)). There the page hands the mixer a copy of the table once per display frame. That costs the page's thread a copy of a few kilobytes a frame.

## Costs and limits

- The mixer runs on the audio thread. Its work grows with the voices and with the members of each group, which it ranks every fourth render quantum. With 32 voices and a group of 200 moving members, it takes about 5 ms of work per second of audio on a desktop computer.
- Each voice is a source, a filter, a gain and a panner. The panner's HRTF model costs the most of them, which is why the lighter presets drop it.
- The table holds 12 numbers for the listener and 6 for each emitter: 6 KB at the default capacity.
- The page plays 32 voices at once and the table holds 4,096 emitters at most.

[The API reference](reference/sound.md) lists every export of this page with its type and
description. The add-on's doc comments make it.
