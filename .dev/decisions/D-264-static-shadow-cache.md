# D-264: A cache of still casters in the directional light's cascades

Status: proposed. Date: 2026-10-25, revised 2026-10-26. Task: M3-R11. The keep rate is counted and
the cascades' costs are measured. The decision waits on one figure, the still casters' share of
Creek's second cascade. An earlier draft ruled against the cache on a split that the measurement
cannot support, and the checker refused it. Not built yet.

Summary: Weighs two ways to stop a cascade redrawing depth that has not changed. The first is a
rest rule, which skips a cascade's pass while nothing in it moved. The second is a second shadow map
that holds the still casters. A cache could keep its layers in 50% to 98% of the scenes' frames, and
the sun's step sets that share, not the camera. Whether that pays turns on how much of Creek's
second cascade stands still, which the measurement so far cannot say.

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

The `Drawn today` column is the schedule with no moving caster in the scene. It is a baseline, not
what these scenes draw. Creek has two kinds of mover, its swaying grass and its floating leaves, and
either one makes every cascade draw in every frame. Its true `Drawn today` is 100% in each cascade.

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

### The estimate before the measurement

A cache pays when the frames it keeps multiply a cascade's draw by more than the restore costs. The
cascade's draw is not the same as its pass. The still casters' share of the pass is what a cache
removes, and the movers draw either way.

D-16's figures put one far cascade of S4 at 0.163 to 0.200 ms, and a full layer's restore at
0.045 ms. At Low, on the cloud iPad, the same far cascade in every frame cost about 0.1 ms
([D-16](D-16-moving-casters-and-bias.md)). A 1,024-texel layer's restore is about a quarter of the
0.045 ms above.

Those figures are an estimate built from D-16's measurements of another scene. They are not the
ruling number. The measurement below replaces them.

### The measured cost

The demos ran on the Mac in Chrome on WebGPU at Medium, from the development pages. Each figure is
from two runs.

| Scene | Frame GPU time | First cascade | Second cascade | The other passes |
| --- | --- | --- | --- | --- |
| The time-of-day demo | 2.74 and 2.96 ms | 0.048 and 0.042 ms | 0.094 and 0.125 ms | 1.15 to 1.79 ms |
| Creek | 11.96 and 10.56 ms | 0.288 and 0.340 ms | 0.531 and 0.490 ms | 4.35 to 6.10 ms |

Two cautions belong with that table:

- Creek's frame was inflated by the machine's load, which read 69. Its frame time on a quiet machine
  is smaller, so one saving is a larger share of a quiet frame than of this one. Trust the absolute
  pass times.
- The third cascade never reaches the report. A far cascade draws once in three frames, and a pass
  that appears in only some timed frames is left out. So 0.29 and 0.53 ms are a floor for Creek's
  shadow cost, not the whole of it.

### How much of that the movers take

Creek again, with its swaying grass set not to cast shadows. The grass is not Creek's only mover: the
floating leaves cast shadows and move too.

| Measure | Grass casting | Grass not casting |
| --- | --- | --- |
| Frame GPU time | 11.96 and 10.56 ms | 8.04 and 6.39 ms |
| Draw calls | 135 and 137 | 101 and 101 |
| First cascade | 0.288 and 0.340 ms | 0.302 and 0.351 ms |
| Second cascade | 0.531 and 0.490 ms | gone, and every later pass moves up one place |

The first cascade kept its cost to within a hundredth of a millisecond, so the grass is not in it.
The second cascade's pass vanished, and the runs cannot say why. Two things change at once: the
grass stops casting, and every cascade stops drawing in every frame. A far cascade that keeps its
turns appears in only some timed frames, and a pass reported by position then drops out.

So this pair of runs does not measure the still casters' share of the second cascade. It does not
measure the grass's cost either. The 3.5 to 4 ms and the 34 draw calls are everything that changed
between the two runs. Two things changed with them: the grass's shadows, and the far cascades' draws
that the movers had forced in every frame. An earlier draft read the movers as the bulk of Creek's
shadow work from this difference, and that does not follow.

### What the figures say so far

A cache saves, in each frame it keeps, the still casters' draw less the restore. Over a frame of
Creek at a 75% keep rate, with `S2` for the still casters' share of the second cascade:

    saving = 0.75 x (0.29 + S2) - 3 x 0.045 ms

The first cascade's 0.29 ms stands still, so it counts in full. The restore is D-16's 0.045 ms a
layer, for three layers.

The saving reaches 3% of Creek's inflated 11 ms frame at an `S2` of about 0.33 ms. That 3% is
0.33 ms. On a quiet frame the same saving is a larger share, so the bar there is lower. `S2` is the
figure the record lacks.

The time-of-day demo cannot pay for a cache whatever `S2` is. Its two measured cascades total 0.142
and 0.167 ms, and one layer's restore is 0.045 ms, so three restores take 0.135 ms of that. What is
left is a few hundredths of a millisecond.

The rest rule takes a different set of frames. It fires only where nothing in a cascade moved. In
Creek the grass and the leaves move in every frame, so there it never fires. In forest, whose
casters all stand still, it fired in 98 to 100% of frames. Its prize is forest's whole cascade cost,
which this record does not measure.

### How the figures were produced

The keep rate came from a count that runs without a GPU. It drives the engine's own `fit_cascades`
and `CascadeSchedule` with a camera path and a sun turn taken from each scene's code. It compares
the box test with the engine's own schedule. The count is not kept in the repository: it answers one
question and asserts nothing about the engine that a test should hold.

The per-pass figures come from a demo page opened with `?bench`, which publishes the running engine
on the page. A script then reads `engine.measure().gpuPassMs`. The cascades are the first render
passes of a frame. The frame graph declares every shadow pass before any view's passes. The demos
are examples, so the benchmark harness does not reach them. These figures come from the development
server rather than a production build.

The movers' share came from one edit to Creek: `castShadows` set false on the batch of grass tufts
near the water, at `examples/showcase/creek/grass.ts`. The edit was reverted after the run and no
part of it is committed.

A fresh copy of the repository needs three things before a demo page will draw. Each one fails in a
way that reads as a fault in the demo:

- `bun run shaders` writes the generated shader modules. Without them no page builds.
- The development server compiles each sketch's shader when the page asks for it. That compiler is
  `packages/vite-plugin/dist/shader-compiler.wasm`, and only `bun run build` writes it. Without it
  every demo page answers 500 and names the missing file.
- The engine's own WebAssembly in `packages/engine/dist/wasm` comes from `bun run build` too.

This measurement took the last two from another checkout of the repository. That is sound only
because no file under `crates/` differs between the two commits. The bytes were built from the same
sources. Copy a build artifact only after that check.

## Look

The two options draw the same shadows while the light turns smoothly. A cache would need the light
held in steps. A quarter of a degree is the largest step that the October 2026 review of another
engine's day-night cycle reports. The record does not measure whether a step that size shows in a
shadow's edge, because the figures above refuse the cache before look decides. The rest rule changes
no pixel.

## What would change the answer

For the cache, a scene would have to hold many more still casters than moving ones. They would also
need to reach 3% of the frame after the restore's cost. That means a still casters' pass of several
milliseconds, with movers confined to a small part of each cascade. No scene that the engine ships
is close. Creek, its heaviest shadow scene, puts its movers first.

For the rest rule, the change is a shipped scene whose shadowed casters are mostly still. Forest is
the nearest case today, and its cascade cost is not measured. One measurement there would decide
whether the rule is worth building.

## Decision

Pending the split of Creek's second cascade. The keep rate passes at 75% in Creek, and reaches 98%
in the scenes whose sun stands still. The rule then turns on one figure. Do the still casters of
Creek's second cascade cost about a third of a millisecond or more? That is where the saving reaches
3% of Creek's frame.

The measurement that settles it draws every cascade in every frame, so no pass drops out of the
report. It runs with the grass casting and then with it not casting. Then each cascade's still share
reads off directly.

The rest rule is a different question and stays open. It costs nothing to try, it needs no
bookkeeping, and it keeps every frame where nothing in a cascade moved. The same data says it will
rarely fire where movers dominate, which is Creek. It is worth building only if a shipped scene
turns out to be mostly still casters, and forest is the nearest candidate.

## Consequences

- Nothing is built yet, and no code or published page changes with this record.
- If the cache is built, it starts in `CascadeSchedule::plan`, which already holds the box test and
  the moving-caster test. It adds a second shadow map, a restore pass, and a view for each cached
  layer.
- If the rest rule is built, it needs no new GPU object. A later task may measure forest's cascade
  cost and take it from there.
- The count and the measurement tools are not kept in the repository.
