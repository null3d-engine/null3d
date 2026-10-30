# D-278: A particle system and a blended mesh stop a reflection pass on WebGL2

Status: decided. The weather add-on keeps its particle systems on a layer its planar reflection
pass leaves out, and that workaround is built. The engine fault is closed: on WebGL2 the
transparent pass sized a view's draw records from its last call alone, so a particle buffer beside
a blended mesh stopped the frame with a core `unreachable` trap when the particle call sorted last.
The smallest scene is named below, and the guard that holds the fix is its regression test,
`crates/null3d-render/tests/reflection_particle_trap.rs`, which the CI `rust-tests` job runs with
`cargo nextest run --workspace`. Found by task M3-B4.

Summary: On WebGL2, a reflection pass that draws a particle system and a blended mesh in the same
view stopped the frame with an `unreachable` trap in the step after culling. Either draw alone drew,
and the same scene without the pass drew. The transparent pass sized a view's draw records from its
last call alone, and a call that writes none, as a particle system's does, left the buffer empty.
The add-on's layer split may go, at its author's decision.

## Question

A weather scene puts a planar mirror under its street and particles in the rain above it. On
WebGL2 the frame stops. Which draws make the pass fail, what is the smallest scene that shows it,
and what does a scene do in the meantime?

## Rule

A scene that draws must draw. A workaround is allowed only when the fault and its smallest scene
are written down, so the next reader fixes the fault instead of copying the avoidance. Hard rule 39
applies: fix the fault, and do not drop the feature.

## Data

The image page (`tests/pages/image.html`) drew each scene in the installed Chrome 156 on the Mac's
M3 Max, at `gpu=webgl2`, `hold=1`, `preset=high` and a size of 640 by 360. The sketch is
`tests/pages/sketches/reflection-particle-trap-sketch.ts`, whose switches leave each part out.

| Scene | WebGL2 |
| --- | --- |
| a reflection pass, a blended mesh and one particle system | stopped without the fix, `E1408` with `unreachable (past its cull phase)` |
| the pass and the particle system | draws |
| the pass and the blended mesh | draws |
| the pass alone | draws |
| the blended mesh and the particle system without the pass | draws |

The weather add-on's own scene repeated the result with more parts: a wet ground and its pass
alone drew, and so did the pass with the five posts and the point light, with the windshield
overlay alone, and with the splashes and steam alone. The pass with the overlay and the particle
systems together stopped. The WebGPU and compatibility tiers drew the same scenes.

The trap fell in the record step, the phase after the cull. The render worker had no panic message
or stack: the wasm build takes the release profile's `panic = "abort"` (`-Z
build-std=panic_abort,std`), so a panic is a trap to JavaScript and no hook runs. The shader tool's
module states the same limit for a failed request (`crates/null3d-shaders-wasm/src/lib.rs`). The
record step also compiles natively, so its frame-builder test runs the same code and prints a
panic's message and source line.

## The cause

The transparent pass writes one aligned block of draw records for each call that draws meshes. The
builder advanced the block only when it opened a mesh call, and sized the block from the last call
alone. A particle system's call and a vertex-count draw's call write no records, so a view whose
such a call sorted last sized the block to zero while an earlier mesh call still wrote into it, and
the record write ran past the empty buffer. A mesh call that followed a particle call also reused
the previous mesh run's records. Only a mirror view sorts the blended mesh before the particle
system, which is why the fault needs the pass. The fix keeps the offset after the last call as the
calls are made, and the view holds the total that its record block takes. The test builds the
scene below on the WebGL2 frame builder, with and without `WEBGL_multi_draw`, and its second scene
checks that each blended run of a view takes a record block of its own. A change that drops the
running offset fails that check, and one that sizes the block from the last call again traps in the
first scene.

## Look

The workaround leaves the splashes and steam out of the puddles' mirror. They are small, and their
reflection is barely visible at the distances the scenes show them. The engine fix brings their
reflection back. It does not change any other part of the look.

## Decision

The add-on gives its particle systems a layer of their own. `createSplashes` and `createSteam` take
`layers`, the planar pass takes the layers it draws (`createWetSurface`'s `reflection.layers`), and
the camera's layers include the particles' layer. The weather cost page and its picture test put
the particles on layer 1 and the pass on layer 0, and both tiers that draw the whole scene now
draw on WebGL2.

The options rejected:

- **No planar reflection in the weather scenes.** The puddles would lose their mirror, which is the
  feature the task asks for.
- **No particles in the weather scenes.** The task asks for the particles link, and the particles
  draw in every other scene.
- **Leave the pass drawing everything and document a crash.** A scene would fail on a device, and
  the fault would read as the add-on's.
- **Fix the engine fault in this branch.** The trap names no call, and a build that reports it is a
  change of its own. The smallest scene is now in the tree, so the fix has a starting point and a
  test.

## Consequences

- `examples/addons/weather/index.ts` passes `layers` to `createParticles` for both wrappers, and the
  add-on's README states the limit and points here.
- The weather cost page and its picture test use the layer split, and so does any scene that adds a
  planar pass beside the add-on's particles.
- The engine fault is fixed, and its test draws the scene below. A reflection pass now draws
  particle systems beside blended meshes, so the add-on's layer split may go, at its author's
  decision.
