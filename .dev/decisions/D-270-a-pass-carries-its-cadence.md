# D-270: A pass carries its cadence, rather than being switched off

Status: decided by the measurement below. `render.setPassEvery` is built, and the water and ocean
add-ons set their reflection's cadence through it instead of switching the pass. Task: M3-E8.

Summary: Switching a pass off recompiles the render graph on that frame. A reflection that drew every
other frame by switching itself off cost 675 ms of a WebGL2 frame, and the same page with the pass
carrying a cadence of two runs at 60 frames a second. A pass now takes its cadence at runtime, and
changing it compiles nothing.

## Question

The ocean's WebGL2 fragment form drew a 1920 by 1080 page at 1.21 frames a second, with the
transform's 15 passes across three bands making 45 draws of 128 squared. Is the cost the shader work
of those draws, or the engine's work around each pass?

## Rule

A pass that need not draw every frame must reach its cadence without changing what the graph
compiles: the plan is the same on every frame whatever the cadence, and the pass's texture keeps its
last image while it waits. A caller must be able to change the cadence as often as once a frame, and
the change must take effect on the next frame. A pass that is switched off must stop drawing, and a
pass that is switched on again must draw on the next frame.

## Data

The rate page draws the sea in three states in turn, at 1920 by 1080 on Low, after 20 seconds of
warmup, in two windows of 4 seconds each. The first column switched the reflection off and on every
other frame. The second held it on every frame, which is the cadence the setter is built for:

| Measure | Switched every other frame | Held on every frame |
| --- | --- | --- |
| Ocean on | 825.0 ms, 1.21 fps (833.3 and 816.6) | 16.7 ms, 60.01 fps |
| Transform off | 158.3 ms, 6.32 fps (150.0 and 166.7) | 16.7 ms, 60.01 fps |
| Simulation only | 833.3 ms, 1.20 fps (833.3, 833.3) | 16.7 ms, 60.01 fps |

The page with the pass carrying a cadence of two through the setter is measured next, and its
figures join this table when they land.

The draw thread is busy 847.7 ms a frame with the simulation and 154.1 ms without. Every WebGL call
it makes totals 2.5 ms a frame, so the cost is engine compute on that thread. The engine made and
checked 28 framebuffers a frame, the fragment form's layer views losing theirs on each recompile.

Commands, all on the WebGL2 path:
- `NULL3D_OCEAN_RATE=1 NULL3D_OCEAN_RATE_GPU=webgl2 NULL3D_OCEAN_RATE_PRESET=low bun run test:browser -- ocean-rate.spec.ts`
- The same with `NULL3D_OCEAN_RATE_EVERY=1`, which holds the reflection on every frame.
- `bun run test:browser -- compute-state.spec.ts -g cadence`, which reads a pass that draws in one
  frame of two and then in every frame.

The switched run was measured at a one-minute load of 3.1 before and 3.3 after, with the 15-minute
average at 7.7 while another session's build held the queue. The held and cadence runs were measured
at a load of 2.5. The draw thread's figures come from the effect page's `?gltiming` on the same
case.

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

The enabled-state switch keeps its meaning: it starts and stops a feature, and it compiles when it
changes. It is not the frame-rate switch.

## Consequences

- `render.setPassEvery(pass, every)` is public. It throws E1101 for a removed pass and E1220 for a
  cadence that is not a whole number from 1.
- The water and ocean add-ons set their reflection's cadence through it in the quality callback, and
  their `update()` no longer switches the pass.
- [The render API](../../docs/api/render.md), [custom passes](../../docs/guides/custom-passes.md) and the develop
  skill's quick reference and recipes state the setter, and say why the switch is not the pacing
  control.
- The ocean's own page on WebGL2 at 1920 by 1080 on Low carries its cadence of two through the setter; its frame time is measured in the run that follows this commit.
