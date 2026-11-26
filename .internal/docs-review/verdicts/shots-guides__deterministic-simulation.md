# Verdicts: guides/deterministic-simulation (shots and demo links)

## Shots

### replay-demo: KEEP (fix the alt text)
- Source is right. `tests/image/references/chrome-real-gpu/webgpu/demo-replay.png` exists (also under compat and webgl2). It is 320 x 180, the size of every demo reference.
- What it shows: the held frame. The demo's page part does not run in a held frame, so the sketch draws the run's start, which it builds with the simulation's `startRun` from the seed. The picture is a walled court at dusk with twelve glowing gold orbs and a low sun. So "drawn from the simulation's state" is true.
- Value: modest. A still picture cannot show a camera that recorded input aims. But it shows the reader what the linked demo is before they open it, and it sits next to the existing demo link in "Where the player looks". That is the right place.
- Alt text is vague. Describe the picture: "A walled court at dusk with glowing gold orbs, seen from the player's start point in the deterministic simulation demo."

## Demo links

### camera aimed from recorded input (replay/): DROP as a new link
- The concept is right: page.ts adds the mouse movement to the log each tick, and sim.ts turns the counts into a yaw and pitch and builds the view with `exact.quat.fromEuler`.
- But the page already links this demo in this section (line 138, "The deterministic simulation demo does this"). A second link here repeats it.

### createMath on an exact library (replay/): KEEP
- `replay/` exists in demos.ts. sim.ts calls `createMath({ sin, cos, acos, exp })` on clockwork2's `dmath` and uses `exact.quat.fromEuler`, `exact.quat.setAxisAngle`, `exact.vec3.angle` and `exact.math.damp`. That is the section's exact pattern.

### input: false (replay/): KEEP, with care in the link text
- The demo does run with input off: demos.ts marks it `pagePart: true`, and the shared runner (examples/lib/run.ts) then passes `input: false` to `createEngine`. page.ts takes the keys, mouse, fingers and pointer lock itself.
- The `input: false` line is not in the replay folder. Word the link as "the demo's page takes the input itself", not as a link to the option.

## Concepts said to have no demo

### a production build of a game's engine files: CONFIRMED
- No entry in demos.ts or comparisons.ts builds an engine files folder from a two-line entry. examples/vite.build.config.ts builds the examples site; it is not a demo.

### narrowed shader sets: CONFIRMED
- No demo shows it. examples/vite.build.config.ts sets `NULL3D_SHADER_PERMUTATIONS` to examples/shader-permutations.txt for the examples site build, but that is build tooling, not a demo with a code value, so it cannot be a demo link.
