# D-384: Sound is a foundation add-on, mixed on the audio thread

Status: decided by the owner: positional sound ships as the foundation add-on `@null3d/sound`, and the core stays free of audio. The mixer's work is in Rust, compiled to WebAssembly and run inside the AudioWorklet, so hard rule 42 holds. The owner chose that over a JavaScript mixer. Built: the add-on's sketch half, page half and mixer (`crates/null3d-sound`), their tests and its own page. The three showcase scenes play sound, and the sound demo shows the add-on. A group's voices add as power, and the add-on documents the law rather than normalising. Three points at full level sound about 5 dB louder than one loop. Every sound's reach, from a fountain's fifty meters to thunder's four kilometers, is a scene choice, and the guides give the ranges by kind.

Summary: `@null3d/sound` gives a sketch loops, groups and one-shots placed in the scene. The sketch writes each emitter's place, level, rate and tone into a shared table. A mixer in Rust runs as WebAssembly in an AudioWorklet on the browser's audio thread. It reads the table and drives each voice's panner, gain, filter and playback rate through audio parameter inputs. So no frame sends a message, and the page's thread does no work while the page shares memory. With the worklet's copies, the mixer costs about 3.0 ms of work per second of audio. That holds 32 voices and a group of 200 moving emitters.

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
- An MP3 encoder adds its delay at a file's start and padding at its end. It records both in the LAME extension of the file's first frame. Chrome for Testing reads it: the 6 s mono hover loop decodes to its own 288,000 samples. Playwright's WebKit decoded the same file to 289,152 samples. Lined up against Chrome's, its samples match at an offset of 576 at the start and 576 at the end. It decoded the stereo wind loop to its own length. So the page reads the header itself and drops what the browser kept. The encoder's delay goes from the start and the rest from the end. Chrome and WebKit apply the header of a file whose header names LAME themselves. For such a file, a decoder that applies no header keeps the decoder's own 529 samples as well. So the trim takes them with the delay.
- A panner and a filter that follow an audio-rate input work out their coefficients for each sample. Their parameters take `automationRate = 'k-rate'`, so they follow the input once per render quantum, 375 times a second at 48 kHz. The gain stays at audio rate, so the mixer eases it across each quantum.

`bun --conditions=null3d-source tools/sound-mixer-cost.ts` measures the mixer's cost. It plays 4 loops and a group of 200 emitters with 28 voices, 32 voices in all. Every emitter moves every sixth quantum. It runs the mixer's WebAssembly through the worklet's own wrapper, with the copy of the table in and the copies into the outputs. It ran ten seconds of audio at 48 kHz, five times, in Bun 1.4.4 on the M3 Max. The one-minute load average was 4.2. The work was 3.00, 3.00, 3.00, 3.02 and 3.17 ms per second of audio. The median, 3.00 ms, is about a third of one percent of one core. Chrome runs the same module in V8, which this run does not measure. The JavaScript mixer that it replaced took 2.38 ms in the same script, at a load average of 10.6.

## Look

The options differ in how they sound:

- Gain eased across each quantum by the mixer has no steps. Gain set by the page once a display frame steps 60 to 120 times a second. It also stops changing when the page's thread is busy, so a sound's level and place freeze while the page works.
- The browser's HRTF panner places a sound around the head on headphones, which equal-power panning cannot. It costs more on the audio thread. So the High and Ultra presets take HRTF. Low and Medium take equal-power panning, the cheaper technique of the same placement in stereo.
- Recorded loops sound better than sounds made in code for the sea, surf, wind, leaves, water, rain, thunder and engines. So the showcase scenes play recordings.

## Decision

Sound is a foundation add-on, `@null3d/sound`, with two entry points:

- `@null3d/sound` runs in the sketch: `createSound(ctx, { listener })` makes loops, groups and shots. Each sound owns emitters in the table and voices on the page. Once a frame, in `onLateUpdate`, `update()` writes the listener's place and turn and counts the frame. The sketch writes emitter values with setters, or in bulk through a group's arrays.
- `@null3d/sound/page` runs on the page. `connectSound(engine)` opens a message port of its own to the sketch and starts an AudioContext on the user's input. It loads each file once, and builds each voice's nodes: the source, a low-pass filter, a gain and a panner. A sound that plays in both ears skips the panner.
- The mixer runs on the audio thread. Its work is in Rust, in `crates/null3d-sound`, compiled to WebAssembly, which `bun run build` places in the package's `dist/sound.wasm`. The page fetches its bytes as the sound starts and hands them to the worklet, which compiles them. Each quantum the worklet copies the table into the module's memory and calls it once. The module writes each of a voice's six values for every frame of the quantum. The gain eases across it, and the place, rate and cutoff hold. The worklet copies each run into the browser's output arrays as a block. Filling each frame with one number from JavaScript boxed the number in V8, about 28 bytes a quantum. A loop over the frames took half as long again. The module builds with WebAssembly's 4-wide instructions, which the engine's core needs too. It rewrites a run only when its value changed. On a loaded Mac, the block copies took 5.7 ms of work per second of audio in Bun. The filling took 4.2 ms in the same process. In V8 they allocate 0 bytes a quantum. Hard rule 1 weighs more on the audio thread than a tenth of a percent of a core. A collection there can break the sound. The module imports nothing and never grows its memory, so the worklet's views of it stay valid.
- Each quantum the mixer reads the table and eases each voice's gain. It follows each voice's rate and tone, and turns its place into the listener's frame. Every four quanta it ranks each group's emitters by their loudness where the listener stands, and hands the voices to the loudest. A voice keeps its emitter while that emitter keeps 70% of the weakest chosen emitter's loudness, so voices do not flap. A voice that moves fades out first. The frame count stands still while the engine is paused or the page is hidden. After 0.3 s of that, the mixer fades every voice out, and the page suspends the audio until the frames move again.

The table is a SharedArrayBuffer where the page is cross-origin isolated, so the mixer reads the sketch's writes directly. Without isolation, the sketch runs on the page's thread. It then puts its table in a box that the engine hands it uncopied. The page sends the mixer a copy of the table once per display frame. The page builds the mixer from a module that imports nothing. Vite copies such a module unchanged from an installed package, so the same file works from the repository's source and from npm.

Options rejected:

- **Leave sound to each app**, with the guide's pattern. Every app would build the parts in the table above, and the showcase scenes would carry three copies.
- **Sound in the core.** A page without sound would pay for it, and rule 11 keeps a feature in one place. The core keeps no audio code.
- **The page drives each voice once a display frame**, as the guide's pattern does. That is frame work on the main thread, against principle 6. A busy page thread freezes the sound, and gain steps at the display's rate.
- **Voices chosen in Rust on the job workers**, as rule 42 would have a frame's loop. A task each frame adds a hop and a frame of delay between the sketch and the mixer, for at most a few hundred emitters.
- **The mixer in JavaScript, in the worklet.** It took 2.38 ms per second of audio at a load average of 10.6, and the module 3.00 ms at 4.2. The two runs met different loads, so they show the same scale, not which is faster. Its ranking loops over a group's emitters, which rule 42 puts in Rust, so it would have needed a second exception to the rule. The owner chose the Rust module. The worklet keeps only the browser's part in JavaScript: the copies into the audio outputs. The browser gives those outputs as JavaScript arrays, the reason that keeps the draw-list replay in TypeScript ([D-01](D-01-gpu-layer.md)).
- **The engine's own message channel** (`page.post` and `engine.onSketchMessage`). The add-on would take an app's early messages whenever it listened first.
- **All mixing in the worklet**, with the add-on's own panning. It would lose the browser's HRTF panner.
- **Sounds made in code.** They sound worse than recordings for every sound the showcase scenes need.

## Consequences

- AGENTS.md: rule 13 of the add-on module rules lists sound among the foundations, and "Where things are" lists the package and its crate. The build's table of tool modules builds the crate, and CI's build job carries `packages/sound/dist` with the other add-ons' modules. [D-173](D-173-addon-hooks.md) ruling 4 lists it too, and [D-54](D-54-addon-modules.md) says that the add-on's page half and mixer run on the page and the audio thread.
- The allocation gate of `bunx @null3d/cli check-addon` samples the sketch and render workers. It sees the sketch half's `update` and setters, which allocate nothing. It does not see the page half or the mixer. Where the page shares its memory, the page half allocates only when a sound starts, stops or plays a shot. The mixer then allocates only when a sound is added or removed: in V8 its quanta measure 0 bytes each after the first. Without shared memory, the copy of the table makes a message and a view of the returned buffer on each side, once per display frame. The page reuses its messages and transfer lists, but a transferred buffer returns as a new object, which needs a new view.
- A shot's play is a message. When the page passes it on, the mixer takes the play's level, place and pitch at once. The page starts the file 20 ms after the message. The mixer reads every value from the table through a check. A level or a place that is not a finite number silences its voice for as long as it lasts.
- Docs: `docs/api/sound.md` documents the add-on, `docs/guides/audio.md` shows it and how the bridge works, and the three.js mapping's audio entry points at it. The skills point audio at the add-on.
- The showcase scenes play recorded loops from the sample content, which `tools/samples/sound/loops.ts` cuts from CC0 and CC BY recordings ([Sample content](../sample-content.md)).
- The demos with sound play it by default, as the owner asked. The page calls `start` as the demo loads, and the browser holds the audio until the visitor's first click, tap or key. A round speaker button over the canvas's top right corner turns the sound off and on. Local storage keeps that choice for every demo.
- While the browser holds the audio, the page half loads and decodes the files but starts none. A file started then makes the browser warn once for each voice. The Skyway page warned 12 times before its first input, and warns once now. A shot played in that time is dropped, since it would sound only after the first input.
- The sound demo, `examples/sound/`, shows the add-on alone in a storm on a moor. Each strike's thunder plays once sound could have crossed to the camera.
