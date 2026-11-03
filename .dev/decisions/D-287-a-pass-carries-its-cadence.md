# D-287: A pass carries its cadence, rather than being switched off

Status: decided by the measurement below. `render.setPassEvery` is built, and the water and ocean
add-ons set their reflection's cadence through it instead of switching the pass. This record was
D-270 before the renumbering that moved it here, and the commit that built the setter (`9c13dc105`)
names it by that number. Task: none (no plan task names the runtime cadence; the water add-on,
M3-F5, and the ocean, M3-F9, are its first users).

Summary: A pass that carries its cadence draws in every frame of it and compiles nothing. Switching a
pass off instead changed the plan on each switch of the measurement below. A reflection that drew
every other frame by switching itself off cost 675 ms of a WebGL2 frame. The same page with the pass
carrying a cadence of two runs at 60 frames a second. A pass now takes its cadence at runtime, and
changing it compiles nothing. The switch still starts and stops a feature, and compiles nothing once
a pass has drawn.

## Question

The ocean's WebGL2 fragment form drew a 1920 by 1080 page at 1.21 frames a second, with the
transform's 15 passes across three bands making 45 draws of 128 squared. Is the cost the shader work
of those draws, or the engine's work around each pass?

## Rule

A pass that need not draw every frame must reach its cadence without changing what the graph
compiles: the plan is the same on every frame whatever the cadence. A caller must be able to change
the cadence as often as once a frame, and the change must take effect on the next frame. A pass that
is switched off must stop drawing, and a pass that is switched on again must draw on the next frame.

A material that samples a pass's target in a frame that the pass skips shows the last image that the
pass drew. The target is never culled and never cleared for the cadence, so the picture is the one
from the pass's last turn, not black.

## Data

The rate page draws the sea in three states in turn, at 1920 by 1080 on Low, after 20 seconds of
warmup, in two windows of 4 seconds each. The first column switched the reflection off and on every
other frame. The second held it on every frame, which is the cadence the setter is built for:

| Measure | Switched every other frame | Held on every frame | The setter set to two |
| --- | --- | --- | --- |
| Ocean on | 825.0 ms, 1.21 fps (833.3 and 816.6) | 16.7 ms, 60.01 fps | 16.7 ms, 60.01 fps |
| Transform off | 158.3 ms, 6.32 fps (150.0 and 166.7) | 16.7 ms, 60.01 fps | 16.7 ms, 60.01 fps |
| Simulation only | 833.3 ms, 1.20 fps (833.3, 833.3) | 16.7 ms, 60.01 fps | 16.7 ms, 60.01 fps |

Two things are separate, and the table's two right columns say different things. The held-on column
shows that the compile is gone: the same page and the same 45 draws that took 862 ms hold 60.01
frames a second while the pass draws every frame. The setter column was taken before the recording
skip existed, so it also drew every frame; it says the setter alone removes the compile, not that the
cadence skips.

The skip is checked by `compute-state`: a pass that draws in one frame of two counts four runs in
eight frames and then four more in four frames once its cadence changes, and a pass whose turn is
pushed away keeps the image that a material samples. Both pass on all three GPU paths.

The setter column was taken while the one-minute load was 15 and rising to 21 through another
session's graphics check. The page held vsync, which a chip at 1.2 frames a second cannot do, so the
figure is a ceiling. The column also predates the recording skip, so its page drew the reflection
every frame. The rate of that page with the skip is not measured; `compute-state` proves the skip.

The draw thread is busy 847.7 ms a frame with the simulation and 154.1 ms without. Every WebGL call
it makes totals 2.5 ms a frame, so the cost is engine compute on that thread. The engine made and
checked 28 framebuffers a frame, the fragment form's layer views losing theirs on each recompile.

Commands, all on the WebGL2 path:
- `NULL3D_OCEAN_COST=1 NULL3D_OCEAN_COST_GPU=webgl2 NULL3D_OCEAN_COST_PRESET=low bun run test:browser -- ocean-rate.spec.ts`
- The same with `NULL3D_OCEAN_COST_EVERY=1`, which holds the reflection on every frame.
- `bun run test:browser -- compute-state.spec.ts -g cadence`, which reads a pass that draws in one
  frame of two and then in every frame.

The switched run was measured at a one-minute load of 3.1 before and 3.3 after, with the 15-minute
average at 7.7 while another session's build held the queue. The held run was at a load of 2.5. The
draw thread's figures come from the effect page's `?gltiming` on the same case.

## Look

No picture changes. The pass draws the same frames, one in every cadence, and its texture keeps the
last image in between, as the creation-time `every` option already promised. The pictures of the
ocean's demo and image tests stay as they were.

## Decision

Build the runtime cadence: `render.setPassEvery(pass, every)` sets a view's cadence without touching
the plan, so no frame compiles.

- Rejected: making a compile ignore a disabled pass's writes. A compile made for another reason
  while the pass was off would see a disabled writer, and could cull a target that a material still
  samples. That draws a wrong picture rather than costing milliseconds, so it is not an
  optimization to keep.
- Rejected: fewer passes. The cost followed the pass toggles, not the pass count: the same 45 draws
  ran at 60 frames a second once nothing toggled.

The enabled-state switch keeps its meaning: it starts and stops a feature, and it is not the
frame-rate switch. A pass that has never drawn is out of the plan while it is off, so switching it on
compiles the render graph. Once a pass has drawn, its passes stay in the plan while it is off: the
switch only skips its recording, and compiles nothing.

## Consequences

- `render.setPassEvery(pass, every)` is public. It throws E1101 for a removed pass and E1220 for a
  cadence that is not a whole number from 1.
- A view's pass stays in the graph while the view is switched on, whatever its cadence, and once the
  view has drawn, while it is off; the frame records no passes for a view that is off or not due. A
  material that samples the target on a skipped frame reads the last image, as `compute-state`'s
  `cadence-kept` case checks on every GPU path.
- The water and ocean add-ons set their reflection's cadence through it in the quality callback, and
  their `update()` no longer switches the pass.
- [The render API](../../docs/api/render.md), [custom passes](../../docs/guides/custom-passes.md) and the develop
  skill's quick reference and recipes state the setter, and say why the switch is not the pacing
  control.
- The ocean's own page on WebGL2 at 1920 by 1080 on Low carries its cadence of two through the setter and runs at 60.01 frames a second (16.7 ms) in all three states, against 825 ms (1.21 fps) when the pass was switched.
