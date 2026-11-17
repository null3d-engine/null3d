# D-369: An option that keeps the engine from listening for input

Status: decided by the owner, and built. The engine keeps its input in the core, on by default, and `createEngine({ input: false })` turns it off. Task: none.

Summary: With `input: false`, the engine adds no listener that takes input and captures no pointer, and `ctx.input` stays at rest. The engine's `requestPointerLock()` then fails with E1426, and stopping leaves a lock that the page took. A development build names a sketch that relies on input anyway. A demo plays and replays a seeded simulation that the page drives.

## Question

A game whose server replays its simulation records the player's input with a library of its own. null3D's page listens for input too. Should null3D handle input at all, and how does such a page keep it from listening?

## Rule

- With the option, the engine adds no listener that takes input and captures no pointer. The sketch then reads nothing that the input log lacks.
- A page without the option runs as before.
- Nothing about the option costs a production build any bytes.

## Data

The sketch runs in a worker, which hears no DOM event, so the page forwards input through a ring in shared memory. The sketch reads the ring once a frame with no allocation. Each record carries the frame on screen, which makes a click during a pan pick what the user saw (D-31). Pointer events on objects, the pointer lock (D-110), hold scripts and replays of the engine's own recordings all build on that ring.

A study measured what depends on the page's listeners, by search:

| Area | What reads the input |
| --- | --- |
| Examples | 64 of 68 sketches, 58 of them through the shared orbit controls |
| Packages | All six modules of `@null3d/controls`, and no other add-on |
| Tests | 15 of 233 browser specs drive real devices; about 127 unit tests in 10 files are about input |
| Docs and skills | 21 of 92 doc pages and 10 skill files |

None of the engine's own machinery needs the listeners. Hold mode, its scripts and the replays of the engine's recordings write the ring on the sketch's thread.

What the listeners cost a page, measured in Chromium 141 on SwiftShader:

- The listeners take 1,370 bytes after Brotli in every start. With the lock request and the key table, they take 1,955, from 1.07% to 1.25% of a start.
- With listening on, the engine adds 12 listeners and 2 gamepad listeners, and one pointer capture for each press.
- Each pointer move costs the page's thread about 1.45 µs. 20,000 moves took a median of 74.6 ms with listening on and 45.5 ms off, over 35 bursts.
- With a pad connected, the page reads the gamepads 56 to 60 times a second. With none, it reads none.

With `input: false`, in all five thread modes on WebGPU and two on WebGL2, the engine added none of those listeners. It captured no pointer and read no gamepad, and `ctx.input` and object events stayed silent.

The study weighed five designs:

| Design | What it saves in a start | What it costs null3D's other users |
| --- | --- | --- |
| A: input in the core, on by default, with `input: false` | Nothing | Nothing |
| B: input off unless a page asks | Nothing, unless the listeners also load on first use | Every interactive page opts in, and one that forgets fails silently |
| C: input in an add-on | 1,955 bytes after Brotli | One more package, and a public hook that writes the ring |
| D: no engine input | About 5.6 to 5.8 KB, 3.1% to 3.5% of a start | Every page forwards its own events, and picks lose D-31's frame stamp: about 8 pixels at the center during a pan |
| E: input fed from a source the page supplies | Nothing | A public hook, as for C |

Other engines draw the line two ways. Babylon.js, Godot and Bevy keep input in the engine, and each can turn it off. three.js and PlayCanvas leave input out until an app attaches it, and Unity moved it into a package.

For a vbz game, the 1,955 unused bytes are 0.04% of the 4.7 MB, after Brotli, that a game's engine files take. E is a trap for such a game. Input fed into `ctx.input` reaches the sketch a frame or two after the rules code reads it. Anything that the sketch then decides is in neither the run's checkpoints nor its replay.

The engine's other page listeners take no input. `tests/image/input.spec.ts` records each listener that the engine's code adds, in every thread mode. With the option, they are `visibilitychange` on the document, `change` on media queries, `pagehide` and, in two modes, `securitypolicyviolation` on the window. The rest are `message`, `error` and `abort` on the engine's own objects, and the dev server's shader updates.

## Look

The option draws nothing. The demo that shows it draws an orb hunt in a walled court at dusk, and its pictures are the demo's held frame.

## Decision

The owner ruled for design A: null3D keeps its input in the core, on by default, with the switch `input: false`. A vbz game always passes `input: false`. Nothing feeds null3D's input from another library's recording.

With the option:

- The engine makes no input capture. It adds no listener that takes input. It has none for pointers, keys, the wheel, focus or gamepads, and none for the pointer lock or its input's page visibility. It captures no pointer, and leaves the context menu to the browser.
- It keeps the listeners that take no input, the list above. The canvas watch's `visibilitychange` makes a sketch's step after a hidden page count no hidden time.
- `engine.requestPointerLock()` fails with E1426. The lock is part of the engine's input: the sketch reads the movement through the engine's listeners. The page's own input code locks the canvas and reads the movement.
- Stopping the engine ends a lock that it took or that its input read. With the option it took none, so a lock on the canvas stays the page's.
- In a development build, the page writes the control block's `InputOff` slot. The sketch's thread then warns once for each kind of reliance on input. The kinds are a read of `ctx.input`, an object's first pointer event handler, and `@null3d/controls` among the add-ons that checked their version. Each warning names `input: false`. A production build neither writes nor reads the slot, and carries no warning.

The deterministic simulation demo, `examples/replay`, shows the switch and the maths entry together. It sits in Motion and interaction, beside the input and math demos. Testing and tools holds the engine's own tools, and this replay is the game's.

- Its simulation imports only the maths entry's sub-paths and clockwork2's `dmath` at 0.10.0, which `examples/package.json` pins. `createMath` takes `dmath`'s `sin`, `cos`, `acos` and `exp`.
- `dmath` is the exact library that a vbz game's rules code uses. It is a transcription of fdlibm, and its golden vectors hold its bits on V8, JavaScriptCore and SpiderMonkey. A copy in the examples would be a second implementation with no such check.
- Its page part takes the keys, the mouse, the fingers and the pointer lock itself, and the engine runs with `input: false`. The look decides which orbs count, so the camera is the simulation's, as the owner ruled for such games.
- Replay steps a new run from the seed through the logged input, and ends on the run's state, bit for bit.

Options rejected:

- B, C, D and E, by the study's figures above. Each saves at most 1.96 KB a start, or about 5.7 KB for D, and costs every interactive page.
- A lock that works with the option, with the engine writing `locked` into the ring: the sketch would see a lock and no movement. Two parties would then own one lock.
- Releasing any lock on the canvas as the engine stops: it ended the lock of a page's own input code.
- Warnings in every build: the owner asked that production pay nothing.
- Telling the controls apart by a call stack: a stack names bundled files differently in each bundler. The version check that every first-party add-on already calls names the controls in a development build.
- A new public flag that the controls read: it costs production bytes.
- The demo in Testing and tools: see above.

## Consequences

- `packages/engine/src/page/engine.ts` makes the input capture only when the engine takes input, guards the lock's release, refuses the lock with E1426 and writes the development slot.
- `packages/engine/src/sketch/input-off.ts` holds the warnings. The runner, the input reader, the pointer events and `shared/version.ts` call it behind `DEV`.
- The input test, `tests/image/input.spec.ts`, holds the listeners and the warnings in every thread mode. The lock test, `tests/image/pointer-lock.spec.ts`, holds the refusal and the release in a full Chromium build.
- A unit test, `sketch/input-off.test.ts`, runs the warnings in a development build and a release build. The release check `debug/release-runner.test.ts` finds none of their text in a release build of the runner.
- `tests/image/demo-interaction.spec.ts` drives the demo's page part and holds its replay to the run's camera. The demo's held frame is an image test. Its SwiftShader pictures were drawn on an x86 Linux machine, which `tests/image/local-references.json` records, and its real-GPU pictures need the Mac.
- `api/input`, `api/engine`, `api/controls`, `guides/deterministic-simulation`, both skills and the examples guide describe the switch, the lock and the demo. The guide says how a game whose result depends on where the player looks records the look.
- The website's build installs `@clockwork2/engine` at the version that `examples/package.json` pins, and so does `bun run test:packages`.
