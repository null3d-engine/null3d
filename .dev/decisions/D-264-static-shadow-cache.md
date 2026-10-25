# D-264: A cache of still casters in the directional light's cascades

Status: decided on 2026-10-26. Task: M3-R11. Not built. The keep rate is counted by a test that is
kept in the repository. Creek's cascades and frame are measured on a frozen page, and the saving is
bounded without a measurement of the movers' share.

Summary: Do not build a cache of the still casters. A cache could keep its layers in 75% of Creek's
frames, and in 96% to 100% of the other scenes' frames. The keep rate passes. The saving does
not. At Creek's opening pose its two cascades cost 0.074 and 0.287 ms on the one run whose load met
the timing rule. Three quarters of both is 0.27 ms, and the restore takes its share. The saving is
0.20 to 0.25 ms, or 2.3% to 2.8% of that run's 8.9 ms frame. The rule asks for 3%.

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

The memory rule holds on both clauses.
[Quality presets](../../docs/concepts/quality-presets.md#the-settings-of-each-preset) gives what
shadows take at each preset. They are 9 MiB at Low, 33 at Medium, 92 at High and 228 at Ultra.
A whole second array is under each of those. The far cascades' share is far under. A fifth of the
texture budget is 51 MiB at Low and 102 MiB at Medium, so the second array is under that too
([Quality presets](../../docs/concepts/quality-presets.md#texture-memory)). Memory alone does not
refuse the cache.

What one restore step cost here on 6 October 2026: a pass that loads and stores one layer of 2,048
texels took 0.045 ms. A pass that clears and stores it took 0.012 ms
([D-16](D-16-moving-casters-and-bias.md)). A copy of a layer is a cheaper form that was not
measured. The arithmetic below therefore charges two values. The first is the 0.045 ms that the
cache of D-16 was built with. The second is 0.012 ms, the cheapest pass that D-16 measured which writes a
whole layer. That is a floor for any restore that rewrites the layer, since a copy reads it too.

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
moves. In each frame the count asks two questions. Does the cascade's fresh slice still lie inside
the box that its layer holds? Has the sun turned more than the step from the direction the layer
drew with? Both must hold for a cache to keep the layer. A cascade's own turn in
`CascadeSchedule` does not enter it: on that turn the cascade draws its movers, and the still
casters come from the cache as in any other kept frame.

The count is kept as the test `the_keep_rate_of_a_still_caster_cache_is_counted` in
`crates/null3d-render/src/shadows.rs`. It calls the engine's own `fit_cascades`. It also calls the
engine's own box test, `Cascade::held_by`. That is the test that `CascadeSchedule::plan` makes. The
sun test is the count's own, because the engine has none. Its inputs are the cases below. Each
runs at Medium's map and filter, with its own cascade count and shadow distance, a 60-degree lens
over 16:9 at 60 frames a second, and 2,400 frames. Its output prints with
`cargo test -p null3d-render the_keep_rate_of_a_still_caster_cache_is_counted -- --nocapture`.

| Scene | Camera | Sun | Kept, each cascade | Drawn today |
| --- | --- | --- | --- | --- |
| Forest | flies at 3.6 m a second | still | 99.8%, 99.9%, 100% | 100%, 33%, 33% |
| Security camera | fixed pole, sweeps at 18 degrees a second | still | 96.9% in each | 100%, 33%, 33% |
| Creek, its slowest glide | 1.7 m a second | 4.5 degrees a second, a day of 80 s | 75.0% in each | 100%, 33% |
| Time-of-day demo | at rest | steps of 0.75 degree, a day of 40 s | 80.0% in each | 100%, 33%, 33% |
| A camera at rest | at rest | 0.6 degrees a second, a day of 10 minutes | 96.1% in each | 100%, 33%, 33% |

Creek draws two cascades, because its light names two, over its own 60 m shadow distance. The
time-of-day demo computes its sun from an hour rounded to three minutes, so the sun holds between
steps and then jumps. A smooth turn of the same speed would give 50%; the steps give 80%. The
`Drawn today` column is the schedule with no moving caster in the scene, at Medium's three-frame
turn: a baseline, not what these scenes draw. Creek's swaying grass and its floating leaves each
make every cascade draw in every frame, so its true `Drawn today` is 100% in each cascade.

Two things follow. The camera matters little, as forest's flight keeps 99.8% of its frames. The sun
decides, because its step sets a ceiling that nothing else can lift. A quarter-degree step falls
every 3.3 frames in an 80-second day. So no scene with that day can keep more than about 75%. The
test counts each case again at an eighth of a degree, a step that a scene needing finer shadows
would ask for. Creek then falls to 50.0%, and a camera at rest to 92.3%. The scenes whose sun holds
keep their shares, and the demo keeps its 80%, because its own steps are larger than either.

The counts are a model of each scene's motion, not a reading of the scene. Creek's is a straight
glide at the route's slowest speed with its sun turning. The pose where its cascades were timed
holds the sun, so a held hour would keep more. The record does not use that share. The cache exists
for a scene whose sun turns, and at a held hour a rest rule takes the frames for nothing.

The rule's condition that a cache keep at least half the frames holds everywhere. The lowest share
counted is Creek's 75.0%.

### A second way to take the same frames

Where nothing in a cascade moves, a plain rest rule keeps the same frames with no second array. The
rule skips a cascade's pass while its box holds, the sun holds and no caster in it moved. That takes
the whole of forest's 99.8% and most of the time-of-day demo's 80%.

A cache earns its own cost only in the frames that a rest rule cannot take: the ones where a caster
moved. The cache keeps the still casters and draws the movers over them. Creek may be that case,
because its grass sways and D-241 says a swaying plant cannot go in the cache. Its movers are the
tufts near the water, and its still casters are the rocks, the pebbles, the trees and the
buildings. So the saving is not the whole cascade pass. It is the still casters' share of that pass,
less the restore. The record does not measure that share, so the arithmetic below takes the whole
cascade as still, which is the most the cache could ever save.

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

The demos ran on the Mac in Chrome on WebGPU at Medium, from the development pages. The
[run file](../tested-devices/macbook-pro-chrome/20261025-235300-shadow-cascade-cost.md) holds the
plan, the loads and the results. The page was `?demo=creek&preset=medium&bench`, whose `?bench`
switch publishes the running engine so that a script can read `engine.measure().gpuPassMs`.

The first attempt measured the live page, whose camera follows a route on the clock. Those figures
are not comparable with each other and none of them is used below. Two runs of one configuration
opened on different poses. One pass read 60% higher in one run than the other, and the draw calls
moved from 137 to 164. Any figure from that page before the route was frozen carries the same doubt.

That run also tried to compare the movers' share, by turning the grass's casting off. The
comparison cannot be used. Turning the grass off also stopped the far cascades drawing. The grass no
longer marked them as holding a moving caster, and the per-pass report leaves out a pass that a
cascade skips. The comparison also looks for a difference smaller than the page's drift: the same
pass read 0.287 to 0.437 ms across the three runs of one sitting. The movers' share is therefore not
measured, and the arithmetic below takes the whole cascade as still.

The second attempt replaced the route with a fixed pose at Creek's opening shot and fixed the hour.
It also drew every cascade in every frame, which the run files name. The switch for that is the far
cascades' interval at 1. Hold mode draws every cascade too, but it never publishes the engine.
Creek's light names two cascades, so its two cascade passes are all of its shadow cost. The page ran
in two sittings, logged in the
[first](../tested-devices/macbook-pro-chrome/20261026-010100-shadow-frame.md) and
[second](../tested-devices/macbook-pro-chrome/20261026-010626-shadow-frame.md) run files.

| Sitting's load at its start | Frame GPU, three runs | First cascade | Second cascade |
| --- | --- | --- | --- |
| 13.90 | 9.720, 9.867, 9.809 ms | 0.076, 0.077, 0.076 ms | 0.296, 0.308, 0.307 ms |
| 7.57 | 8.937, 11.767, 12.466 ms | 0.074, 0.098, 0.107 ms | 0.287, 0.402, 0.437 ms |

The frame did not follow the load. The sitting that began at 13.90 read lower than the one that began
at 7.57. Within the second, the frame rose from 8.9 to 12.5 ms while the load's readings rose to
9.90, and the third run's after-reading fell. Nothing in this probe isolates the cause. The draw
calls drifting to 225 on a later run is the one change visible in the same frames.

So Creek's frame at this pose lies between 8.9 and 12.5 ms. A third sitting, which the second run
file names, read 12.539, 12.098 and 11.488 ms. A timing figure needs a start under 8, and one run
met that: the 8.937 ms frame, whose start read 7.57. The other five began at 8.88 and above, so the
record reads them as the loaded machine's comparison and not as timing figures. It reports every
one of them, paired with the cascades of its own run, rather than one figure alone.

### What the figures say

A cache cannot save more than the cascades it caches. Taking both of Creek's cascade passes as
entirely still is therefore the most generous reading, and no measured movers' share can beat it.
The saving is the kept share of that draw, less the restore that each kept frame pays for its
layers:

    saving = keep x (first cascade + second cascade - 2 x restore)

Creek keeps 75.0% of its frames and draws two cascades. Each layer's restore takes one value. The
two values below come from D-16. The 0.045 ms is the measured pass that D-16's own cache of still
casters was built with. The 0.012 ms is the floor above, and it is the value the record gives the
cheaper forms that were never measured.

| Run's frame | Cascades that run | Saving, restore at 0.045 | Saving, restore at 0.012 |
| --- | --- | --- | --- |
| 8.937 ms | 0.074 and 0.287 ms | 0.20 ms, 2.3% | 0.25 ms, 2.8% |
| 9.720 ms | 0.076 and 0.296 ms | 0.21 ms, 2.2% | 0.26 ms, 2.7% |
| 9.867 ms | 0.077 and 0.308 ms | 0.22 ms, 2.2% | 0.27 ms, 2.7% |
| 9.809 ms | 0.076 and 0.307 ms | 0.22 ms, 2.2% | 0.27 ms, 2.7% |
| 11.767 ms | 0.098 and 0.402 ms | 0.31 ms, 2.6% | 0.36 ms, 3.0% |
| 12.466 ms | 0.107 and 0.437 ms | 0.34 ms, 2.7% | 0.39 ms, 3.1% |

The rule asks for 3%. With the restore at the cost that D-16 measured for this design, every run
reads 2.2% to 2.7%, whatever the movers cost. The bar needs two things at once. Every caster in both
cascades must stand still, so nothing draws in the kept frames, and the restore must cost its floor.
Even then the bar is reached only in the two runs that began above the load a timing figure needs.
The one run that met that rule reads 2.8%.

At 8.9 ms the bar needs 0.27 ms, and the most the cache can give is 0.25 ms. A pose that halved
Creek's frame would change that, and none is measured.

The time-of-day demo cannot pay for a cache on what was measured. Its light names none, so it draws
Medium's three cascades. The run recorded the first two only: 0.048 and 0.042 ms, then 0.094 and
0.125 ms. Together they are 0.142 and 0.167 ms, of a frame of 2.74 and 2.96 ms. At the 80% keep rate
they save 0.11 and 0.13 ms. Three layers' restore at 0.045 ms takes 0.135 ms a frame, of which the
kept frames pay 0.108 ms. So those two cascades leave 0.006 and 0.026 ms, under 1% of the frame. The
third cascade's pass went unrecorded. At the cost D-16 measured, the three must total 0.238 ms
before the cache reaches 3% of the 2.74 ms frame. The two that were measured give 0.142 ms. Whether
the third makes up the difference is not known. So the demo neither pays for a cache nor rules one
out, and its third pass is owed.

The rest rule takes a different set of frames. It fires only where nothing in a cascade moved. In
Creek the grass and the leaves move in every frame, so there it never fires. In forest, whose
casters all stand still, it fired in 99.8 to 100% of frames. Its prize is forest's whole cascade
cost, which this record does not measure.

### How the figures were produced

The keep rate comes from the test named above. It runs without a GPU, calls the engine's own
`fit_cascades` and `Cascade::held_by`, and adds the sun test that the engine lacks. Its cases and its
output are in the table above, and the test prints them again on each run.

The per-pass figures come from a demo page opened with `?bench`, which publishes the running engine
on the page. A script then read `engine.measure().gpuPassMs` while the route and the hour were held
and every cascade drew. The cascades are the first render passes of a frame. The frame graph
declares every shadow pass before any view's passes. The demos are examples, so the benchmark
harness does not reach them. These figures come from the development server rather than a production
build. The script is not kept: it answers one question, and a page built for a measurement is the
sure answer, as the examples guide says.

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

Two things would decide it, and neither is measured.
- A copy's or a dirty rectangle's restore cost on this page. At the 0.012 ms floor the bar is reached
  in the two slower sittings, and only when every caster stands still as well. A restore that
  measured under about 0.01 ms a layer would put a cache at the bar.
- The movers' share of Creek's cascades. The comparison that was meant to measure it cannot, because
  its difference is smaller than the page's drift. A page built for the measurement, with a camera
  and a clock that do not drift, would settle it.

A Creek frame at this pose would also put the cache at the bar. That takes a frame under 8.4 ms with
the restore at its floor, or under 6.8 ms at the cost D-16 measured. The quietest run measured
8.9 ms.

Night town is the shipped scene with still casters that this record never measured. It may suit a
cache better than Creek does, and it is the one place left where the figures could go the other way.
Skyway casts no shadows at all, so it cannot be a candidate.

A phone figure is still owed, because the rule asks for this computer and a phone. It cannot change
this ruling alone: the cache needs a frame under 8.4 ms here, and the phones measured draw Creek far
slower. The cloud iPad's run of Creek at Medium on WebGL2 took 90.8 ms a
frame ([Tested devices](../tested-devices.md#vegetation-on-four-cloud-devices-24-october-2026)),
where the cascades are a far smaller share.

## Decision

Do not build a cache of the still casters. The keep rate passes. It counts 75.0% of Creek's frames,
80.0% of the time-of-day demo's, and 96% to 100% elsewhere. The saving does not. At Creek's opening
pose its cascades cost 0.074 and 0.287 ms on the one run that met the timing rule. Even with every
caster standing still, the saving is 0.25 ms at the restore's floor. It is 0.20 ms at the restore
that D-16 measured for this design. Against the run's 8.9 ms frame those are 2.8% and 2.3%, and the
rule asks for 3%. That run is also the rule's median frame, because its load alone met the rule.

The bar is reached only where two of the cache's own assumptions are most favorable at once. One is
a restore at its floor, and the other is no mover in either cascade. The runs that reach it began
above the load a timing figure needs. So no improvement to the movers' share can better this bound.
Only a restore cheaper than the floor could lift it, and the record names that as what would settle
the question.

The rest rule is a different question and stays open. It costs nothing to try, it needs no
bookkeeping, and it keeps every frame where nothing in a cascade moved. The same data says it will
rarely fire where movers dominate, which is Creek. It is worth building only if a shipped scene
turns out to be mostly still casters, and forest is the nearest candidate.

The obstacle this record met stands apart from its ruling, and it is a finding about Creek. Its draw
calls swing between runs with its camera, hour and cascade interval pinned, so the page cannot
support a comparison without care. That matters to anyone measuring Creek, not only here, and it is
recorded in the examples guide.

## Consequences

- No engine code changes. The keep-rate count is a new unit test,
  `the_keep_rate_of_a_still_caster_cache_is_counted` in `crates/null3d-render/src/shadows.rs`.
- If the cache is built, it starts in `CascadeSchedule::plan`, which already holds the box test and
  the moving-caster test. It adds a second shadow map, a restore pass, and a view for each cached
  layer.
- If the rest rule is built, it needs no new GPU object. A later task may measure forest's cascade
  cost and take it from there.
- The measurement script is not kept. The record gives its page, its switches and the figure it
  read, so it can be written again.
