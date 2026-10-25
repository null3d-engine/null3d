# D-264: A cache of still casters in the directional light's cascades

Status: proposed. Date: 2026-10-25. Task: M3-R11. The keep rate is counted. The cost of a cascade's
pass and of a restore is not measured yet, so the table of data is empty and the decision waits.
Not built yet: the record weighs the option and rules nothing until the figures are in.

Summary: Weighs two ways to stop a cascade redrawing depth that has not changed. The first is a
rest rule, which skips a cascade's pass while nothing in it moved. The second is a second shadow map
that holds the still casters. A copy or dirty rectangles restore them before the moving casters draw
over them. A cache could keep its layers in 50% to 98% of the frames of the
engine's own scenes. The sun's step sets that share, not the camera. The record rules between the
two after 1.0, and says what would change that answer.

## Question

The far cascades already rest between their turns ([D-16](D-16-moving-casters-and-bias.md)). The
nearest cascade draws in every frame, and a far cascade draws in every frame while a moving caster
touches it. In a scene whose casters stand still and whose sun turns in small steps, each cascade
redraws the same depth many times for nothing.

Two options could take those frames. A rest rule skips a cascade's pass while its box holds and no
caster in it moved. It adds no memory and no pass. A cache of the still casters goes further. It also
takes the frames where a caster moved, by keeping the still casters and drawing the movers over
them. It costs one more shadow map, a restore pass in every frame that uses it, and the
bookkeeping that tells when it is stale.

Which of the two earns what it costs, and does either clear the rule below?

## Rule

- Both options must draw the same image. Where they do not, hard rule 40 decides between them.
- Take the cheapest option that clears the rest of this rule. A cache is justified only by the
  frames that a rest rule cannot take.
- Build it only when its measured saving is at least 3% of the frame's GPU time. The saving must
  hold in the median frame, on this computer and on a phone, in a scene that the engine ships.
  Hard rule 17 gives the engine that scale.
- The cache must keep its layers in at least half of the frames that a scene draws it in.
- The added memory must stay under the preset's own shadow memory. On the presets that a phone
  starts on, it must also stay under a fifth of the texture budget.
- Both GPU paths must carry it, or the fallback must cost nothing.

## Data

### What the current path draws

- The shadow map is one depth texture array of 2 bytes a texel. It holds one layer for each
  cascade (`crates/null3d-render/src/shadows.rs`, `CascadeDepth::Unorm16`).
- The nearest cascade draws in every frame. Each far cascade draws once in `farCascadeInterval`
  frames, and in every frame while a moving caster touches the box its layer holds
  (`CascadeSchedule::plan`).
- A cascade that does not draw still holds its layer. The render graph then leaves its pass out
  (`Role::Shadow(view) => !drawn(view)` in `crates/null3d-render/src/gpu_driven/mod.rs`).
- A caster's own movement marks nothing. Only the list of moving casters is tested against each
  box. A still object moved by a setter keeps its old shadow until its cascade's next turn.
- Nothing compares the sun's direction with the one a cascade drew with. A cascade that can rest
  tests its fresh slice's corners against the box that it holds. A large enough turn then makes it
  draw out of turn. Under that turn it keeps the matrix and the depth that it drew with, so the
  shadow follows the old sun.
- A hero shadow and each spot or point light tile already rest. Their key holds the light, the box
  and the casters that touched it ([D-219](D-219-hero-shadow.md),
  [D-61](D-61-shadow-tile-redraws.md)).

### What the cache adds

Memory, at 2 bytes a texel, for a whole second array and for the far cascades alone:

| Preset | Cascades | Map | Shadow map now | Second array | Far cascades only |
| --- | --- | --- | --- | --- | --- |
| Low | 2 | 1,024 | 4 MiB | 4 MiB | 2 MiB |
| Medium | 3 | 2,048 | 24 MiB | 24 MiB | 16 MiB |
| High | 3 | 2,048 | 24 MiB | 24 MiB | 16 MiB |
| Ultra | 4 | 4,096 | 128 MiB | 128 MiB | 96 MiB |

A copy of the whole array moves twice the array's bytes in a frame. That is 4 MiB at Low and
256 MiB at Ultra, on a frame that restores every cascade. Dirty rectangles move less.

The memory rule holds. A fifth of the texture budget is 51 MiB at Low and 102 MiB at Medium
([Quality presets](../../docs/concepts/quality-presets.md#texture-memory)). So the second array fits
every preset that a phone starts on. Memory alone does not refuse the cache.

What one restore step cost here on 6 October 2026: a pass that loads and stores one layer of 2,048
texels took 0.045 ms. A pass that clears and stores it took 0.012 ms
([D-16](D-16-moving-casters-and-bias.md)). A copy of a layer is a cheaper form that was not
measured.

### The rules that would make a cache stale

A cached cascade must draw still casters again in the frame after any of these, and the record must
say how each one is caught:

1. The light turns by more than a step, or its color, intensity or biases change.
2. The cascade's box moves by a whole texel, which the camera's own move does.
3. A still caster moves, turns, scales, shows, hides, or changes its layers, material or mesh.
4. A moving caster enters or leaves the box, and its old depth must go.
5. The cascade count, map size or depth format changes.
6. A caster's material moves its vertices, as wind does
   ([D-241](D-241-vegetation-foundation.md)).

The moving caster list holds the casters of rules 4 and 6 only. Rule 2 is a comparison of the
cascade's box with the one its layer holds, which `CascadeSchedule` makes for far cascades already.

### The step rate that a scene allows

A cache is stale as soon as the sun turns by more than one step. So the share of frames it can keep
follows the length of the day cycle, not the scene.

| Day cycle | Sun's turn | A quarter-degree step falls every | On a 60 Hz frame |
| --- | --- | --- | --- |
| 40 s, the time-of-day demo | about 9 degrees a second | 0.03 s | every 1.7 frames |
| 80 s, the showcases on Auto | about 4.5 degrees a second | 0.06 s | every 3.3 frames |
| 10 minutes | about 0.6 degrees a second | 0.4 s | every 25 frames |

The step has to stay small enough that a shadow's edge does not jump. So the day cycle decides
whether a cache can keep anything at all.

### The keep rate, counted

An earlier reading of this record said the opposite. It reasoned that the box follows the camera in
whole texels, so a cache could keep nothing while the camera moves. The count showed that is wrong.
The box fits a sphere around its slice, which leaves it far more slack than a texel of camera travel.

The box snaps to whole texels of a world grid. So it holds the view for many frames as the camera
moves. The count drove the engine's own `fit_cascades` and
`CascadeSchedule` with each scene's camera path and sun turn. In each frame it asked two questions.
Does the cascade's fresh slice still lie inside the box that its layer holds? Has the sun turned a
quarter of a degree from the direction the layer drew with? Both must hold for a cache to keep the
layer.

The count's box test was checked against the engine's own schedule in every cascade-frame of every
case, and the two agreed in all of them.

The count first reported three shares for the security camera. They were 84%, 80% and 81%. A bug
fix moved them to 84%, 82% and 82%. The bug ran the schedule on the same cascades that the count
then tested. The schedule re-places the boxes of the cascades that it keeps.
A redraw could then store a box that the schedule had already moved. The count now runs the schedule
on a copy. A method that moves by two points under a bug fix is one to check. This is why the box
test is compared with the engine's own.

| Scene | Camera | Sun | Kept, each cascade | Drawn today |
| --- | --- | --- | --- | --- |
| Forest | flies at 3.6 m a second | still | 98%, 99%, 100% | 100%, 33%, 34% |
| Security camera | fixed pole, sweeps at 18 degrees a second | still | 84%, 82%, 82% | 100%, 40%, 40% |
| Creek, its slowest glide | 1.7 m a second | 4.5 degrees a second, a day of 80 s | 75% | 100%, 33%, 34% |
| Time-of-day demo | at rest | 9 degrees a second, a day of 40 s | 50% | 100%, 33%, 34% |
| A camera at rest | at rest | 0.6 degrees a second, a day of 10 minutes | 96% | 100%, 33%, 34% |

Two things follow. The camera matters little: forest's flight keeps 98% of its frames. The sun
decides: a quarter-degree step comes every four frames in an 80-second day and every two in a
40-second day.

The rule's condition that a cache keep at least half the frames therefore holds, but only just. The
fastest day that the engine ships gave 50%.

### A second way to take the same frames

Where nothing in a cascade moves, a plain rest rule keeps the same frames with no second array. The
rule skips a cascade's pass while its box holds, the sun holds and no caster in it moved. That takes
the whole of forest's 98% and most of the time-of-day demo's 50%.

A cache earns its own cost only in the frames that a rest rule cannot take: the ones where a caster
moved. The cache keeps the still casters and draws the movers over them. Creek may be that case,
because its grass sways and D-241 says a swaying plant cannot go in the cache. Its movers are the
tufts near the water, and its still casters are the rocks, the pebbles, the trees and the
buildings. So the decisive figure is not the whole cascade pass. It is the share of that pass that
the still casters take.

### A first estimate of the crossover

A cache pays when the frames it keeps multiply a cascade's draw by more than the restore costs. The
cascade's draw is not the same as its pass. The still casters' share of the pass is what a cache
removes, and the movers draw either way.

D-16's figures put one far cascade of S4 at 0.163 to 0.200 ms, and a full layer's restore at
0.045 ms. Suppose the still casters take two thirds of the draw. A frame that keeps its layer then
saves 0.11 ms less the restore.

At Low, on the cloud iPad, the same far cascade in every frame cost about 0.1 ms
([D-16](D-16-moving-casters-and-bias.md)). A 1,024-texel layer's restore is about a quarter of the
0.045 ms above. A kept frame there saves near 0.06 ms of a 6.4 ms frame, about 1%.

Those figures are an estimate built from D-16's measurements of another scene. They are not the
ruling number, and the measurement of the engine's own scenes replaces them. What they suggest is
that the answer turns on the mover mix rather than on the keep rate.

### What the figures must answer

1. What does one cascade's pass cost in the scenes that a cache would serve, at Low and Medium, on
   this computer and on a phone?
2. What share of that pass do the still casters take, and what share the movers?
3. What does each restore form cost? They are a whole-array copy, a pass that writes depth from
   the cache, and dirty rectangles over the area that the moving casters covered.
4. Where is the crossover: at which share of still casters does the restore cost less than the draw
   it replaces?
5. What does the bookkeeping cost the busiest thread, per cascade and per frame?
6. Does the image change, on both GPU paths, with the sun held in steps of a quarter of a degree?
7. What would a plain rest rule take, and is a cache worth building for the frames it leaves?

| Measure | Today | With the cache | Device and browser |
| --- | --- | --- | --- |
| Share of frames a cascade could keep | 50% to 98%, counted | | |
| GPU time of each cascade pass | | | |
| Share of that pass that still casters take | | | |
| Restore cost, per cascade and frame | | | |
| GPU time per frame, Medium | | | |
| Busiest thread, per frame | | | |

How the data will be produced: the benchmark harness for the scenes it holds, and a page that reads
`engine.measure().gpuPassMs` for a day-night demo. The keep rate above came from a count that runs
without a GPU timer. The restore costs come from a probe page that draws only the restore.

## Look

Both options draw the same shadows while the light turns smoothly. A cache needs the light held in
steps. A quarter of a degree is the largest step that the October 2026 review of another engine's
day-night cycle reports. The measurement must show whether a step that size shows in a shadow's
edge. If it shows, the held light looks worse, and hard rule 40 refuses the cache.

## What would change the answer

The keep rate is no longer the gate. The sun's step in a shipped day cycle passes the half-frames
test, and a longer day raises it.

The answer turns on two things instead:

- A cascade's pass must cost enough that the share the option removes is at least 3% of the frame.
  That needs many casters in a cascade.
- For the cache, the still casters must be a large share of that pass, so that the restore costs
  less than drawing them again. A scene where nearly every caster moves has nothing to cache.

In what we ship, two things would settle it. The first is a journey that holds its camera still, so
that a cascade's box holds for seconds at a time. The second is a sun that moves in steps measured
in seconds rather than in frames, which a slower day cycle gives. A quarter-degree step that does
not show in a shadow's edge would allow both.

## Decision

Pending the figures above.

## Consequences

Pending.
