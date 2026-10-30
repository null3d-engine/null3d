# D-278: A particle system and a blended mesh stop a reflection pass on WebGL2

Status: decided. The weather add-on keeps its particle systems on a layer its planar reflection
pass leaves out, and that workaround is built. The engine fault is open: on WebGL2 a reflection
pass whose view draws a particle buffer beside a blended mesh stops the frame with a core
`unreachable` trap. The smallest scene is named below. Task: M3-B4.

Summary: On WebGL2, a reflection pass that draws a particle system and a blended mesh in the same
view stops the frame with an `unreachable` trap in the step after culling. Either draw alone draws,
and the same scene without the pass draws. The add-on gives its particles a layer that the pass
leaves out until the engine fault is fixed.

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
| a reflection pass, a blended mesh and one particle system | stops, `E1408` with `unreachable (past its cull phase)` |
| the pass and the particle system | draws |
| the pass and the blended mesh | draws |
| the pass alone | draws |
| the blended mesh and the particle system without the pass | draws |

The weather add-on's own scene repeated the result with more parts: a wet ground and its pass
alone drew, and so did the pass with the five posts and the point light, with the windshield
overlay alone, and with the splashes and steam alone. The pass with the overlay and the particle
systems together stopped. The WebGPU and compatibility tiers drew the same scenes.

The engine reports the fault at the frame after the last timed phase, which is the cull, so the
trap is in the record step. The render worker does not report the panic's message or stack.

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
- **Fix the engine fault in this branch.** The fix needs the render worker's trap message, which it
  does not report. The smallest scene is now in the tree, so the fix has a starting point and a
  test.

## Consequences

- `examples/addons/weather/index.ts` passes `layers` to `createParticles` for both wrappers, and the
  add-on's README states the limit and points here.
- The weather cost page and its picture test use the layer split, and so does any scene that adds a
  planar pass beside the add-on's particles.
- The engine fault is a task of its own. A fix would let a reflection pass draw soft particle
  systems with blended meshes, and the add-on's layer split could then go.
