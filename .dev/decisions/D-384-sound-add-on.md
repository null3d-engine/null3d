# D-384: Sound is a foundation add-on, mixed on the audio thread

Status: decided by the owner: positional sound ships as the foundation add-on `@null3d/sound`, and the core stays free of audio. The owner has yet to confirm one choice. The mixer that picks each group's voices runs on the browser's audio thread, not as a Rust task on the job workers. Built: the add-on's sketch half, page half and mixer, its unit tests and its own page. Pending: the sounds of the three showcase scenes, which need the recorded loops in the sample content.

Summary: `@null3d/sound` gives a sketch loops, groups and one-shots placed in the scene. The sketch writes each emitter's place, level, rate and tone into a shared table. An AudioWorklet mixer reads it on the browser's audio thread, and drives each voice's panner, gain, filter and playback rate through audio parameter inputs. So no frame sends a message, and the page's thread does no work while the page shares memory. The mixer costs about 4.7 ms of work per second of audio with 32 voices and a group of 200 moving emitters.

## Question

null3D runs the sketch in a worker, and the browser offers Web Audio only on the page's main thread. Should the engine offer sound, and where should each part of the work run?

## Rule

- Design principle 6: the main thread belongs to the page, and the engine does no frame work there when a worker is available.
- Hard rule 1: no per-frame allocation in a hot path.
- Hard rule 42: a frame's loops run in Rust.
- Rule 11 of the add-on module rules: each feature lives in one place.
- Ruling 4 of [D-173](D-173-addon-hooks.md): a later add-on is a foundation when many kinds of project build on it.

## Data

What a page must build to play positional sound from a sketch, with no add-on:

| Part | Why every page needs it |
| --- | --- |
| A table of places that the sketch writes and the page reads | Positions change every frame, and a message per frame costs a copy and a handler |
| A way to hand the page the table | The first handler of `engine.onSketchMessage` takes the messages that came before it ([api/page](../../docs/api/page.md)), so a library that listens there takes the app's early messages |
| Both builds | Without cross-origin isolation, the sketch runs on the page's thread, and a message port copies what it carries |
| A start on the user's input | Browsers start a page's audio only in answer to a press, a click, a tap or a key |
| Pause, a hidden page and the engine's stop | `setPaused` stops the frames but not the sound, and so does a hidden tab |
| The iPhone's silent switch | It mutes Web Audio unless the page's audio session plays media (`navigator.audioSession.type`) |
| A few voices for many emitters | A street of cars cannot each have a voice, and voices must not jump from one car to the next |
| Loops that join with no click | MP3 and AAC add padding at a file's ends, which some browsers keep after decoding |

The three showcase scenes need all of these parts, so each would carry the same code.

Browser facts that shape the design:

- An AudioWorklet node may have outputs of up to 32 channels, and a channel splitter up to 32 outputs. A node's output may drive any audio parameter. So one mixer node drives 32 voices. It has an output for each value: three for the place, then the gain, the rate and the cutoff. Each output has a channel for each voice.
- Firefox's `AudioListener` has no `positionX` parameter. So the listener stays at the origin, and the mixer turns each emitter's place into the listener's frame. Every browser then moves only the panners' positions.
- A panner and a filter that follow an audio-rate input work out their coefficients for each sample. Their parameters take `automationRate = 'k-rate'`, so they follow the input once per render quantum, 375 times a second at 48 kHz. The gain stays at audio rate, so the mixer eases it across each quantum.

`bun --conditions=null3d-source tools/sound-mixer-cost.ts` measures the mixer's cost. It plays 4 loops and a group of 200 emitters with 28 voices, 32 voices in all. Every emitter moves every sixth quantum. It ran ten seconds of audio at 48 kHz, five times, in Bun 1.4.4 (JavaScriptCore) on the M3 Max. The one-minute load average was 21. The work was 4.63, 4.65, 4.69, 5.16 and 8.83 ms per second of audio. The median, 4.69 ms, is about half of one percent of one core. The machine was busy with other sessions' builds, so the lowest figures are nearest the cost. Chrome runs the mixer in V8, which this run does not measure.

## Look

The options differ in how they sound:

- Gain eased across each quantum by the mixer has no steps. Gain set by the page once a display frame steps 60 to 120 times a second. It also stops changing when the page's thread is busy, so a sound's level and place freeze while the page works.
- The browser's HRTF panner places a sound around the head on headphones, which equal-power panning cannot. It costs more on the audio thread. So the High and Ultra presets take HRTF. Low and Medium take equal-power panning, the cheaper technique of the same placement in stereo.
- Recorded loops sound better than sounds made in code for the sea, surf, wind, leaves, water, rain, thunder and engines. So the showcase scenes play recordings.

## Decision

Sound is a foundation add-on, `@null3d/sound`, with two entry points:

- `@null3d/sound` runs in the sketch: `createSound(ctx, { listener })` makes loops, groups and shots. Each sound owns emitters in the table and voices on the page. Once a frame, in `onLateUpdate`, `update()` writes the listener's place and turn and counts the frame. The sketch writes emitter values with setters, or in bulk through a group's arrays.
- `@null3d/sound/page` runs on the page. `connectSound(engine)` opens a message port of its own to the sketch and starts an AudioContext on the user's input. It loads each file once, and builds each voice's nodes: the source, a low-pass filter, a gain and a panner. A sound that plays in both ears skips the panner.
- The mixer runs on the audio thread. Each quantum it reads the table and eases each voice's gain. It follows each voice's rate and tone, and turns its place into the listener's frame. Every four quanta it ranks each group's emitters by their loudness where the listener stands, and hands the voices to the loudest. A voice keeps its emitter while that emitter keeps 70% of the weakest chosen emitter's loudness, so voices do not flap. A voice that moves fades out first. The frame count stands still while the engine is paused or the page is hidden. After 0.3 s of that, the mixer fades every voice out, and the page suspends the audio until the frames move again.

The table is a SharedArrayBuffer where the page is cross-origin isolated, so the mixer reads the sketch's writes directly. Without isolation, the sketch runs on the page's thread. It then puts its table in a box that the engine hands it uncopied. The page sends the mixer a copy of the table once per display frame. The page builds the mixer from a module that imports nothing. Vite copies such a module unchanged from an installed package, so the same file works from the repository's source and from npm.

Options rejected:

- **Leave sound to each app**, with the guide's pattern. Every app would build the parts in the table above, and the showcase scenes would carry three copies.
- **Sound in the core.** A page without sound would pay for it, and rule 11 keeps a feature in one place. The core keeps no audio code.
- **The page drives each voice once a display frame**, as the guide's pattern does. That is frame work on the main thread, against principle 6. A busy page thread freezes the sound, and gain steps at the display's rate.
- **Voices chosen in Rust on the job workers**, as rule 42 would have a frame's loop. A task each frame adds a hop and a frame of delay between the sketch and the mixer, for at most a few hundred emitters. The mixer's ranking runs in the browser's audio callback, outside the engine's frames, and writes the browser's audio outputs, which are JavaScript arrays. That is the same reason that keeps the draw-list replay in TypeScript ([D-01](D-01-gpu-layer.md)). The owner confirms or overturns this one.
- **The engine's own message channel** (`page.post` and `engine.onSketchMessage`). The add-on would take an app's early messages whenever it listened first.
- **All mixing in the worklet**, with the add-on's own panning. It would lose the browser's HRTF panner.
- **Sounds made in code.** They sound worse than recordings for every sound the showcase scenes need.

## Consequences

- AGENTS.md: rule 13 of the add-on module rules lists sound among the foundations, and "Where things are" lists the package. [D-173](D-173-addon-hooks.md) ruling 4 lists it too, and [D-54](D-54-addon-modules.md) says that the add-on's page half and mixer run on the page and the audio thread.
- The allocation gate of `bunx @null3d/cli check-addon` samples the sketch and render workers. It sees the sketch half's `update` and setters, which allocate nothing. It does not see the page half, which allocates only when a sound starts, stops or plays a shot. Nor does it see the mixer, which allocates only when a sound is added or removed.
- Docs: `docs/api/sound.md` documents the add-on, `docs/guides/audio.md` shows it and how the bridge works, and the three.js mapping's audio entry points at it. The skills point audio at the add-on.
- The showcase scenes play recorded loops from the sample content, which `tools/samples/sound/loops.ts` cuts from CC0 and CC BY recordings ([Sample content](../sample-content.md)).
