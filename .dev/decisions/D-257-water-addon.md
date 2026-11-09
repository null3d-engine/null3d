# D-257: The water add-on

Status: decided. Built: the `@null3d/water` add-on, its demo, the reflection's cadence through the
feature host, one owner for each point where bodies meet, the Creek's migration to the add-on, and
the ocean, which draws on every GPU path. Owed: a quiet run of the add-on's cost per preset, whose
gate has run under load. Tasks: M3-F5, M3-E6, M3-F9.

Summary: `@null3d/water` draws a river and a lake from one shape and an open sea of wave spectra,
with waves, ripples, caustics, foam, soft shores, a reflection and an underwater view. The surface
reads the copy of the scene's depth, or the bed that the shape describes, so a shore fades against
the bed. The reflection's cadence is a feature setting of the preset and the governor. The current
carries the whole wave set downstream, so every crest moves with the river. A page sets the surface's
height, so a slow stream draws nearly flat and keeps its fine ripples. The Creek draws its water and
its underwater view through the add-on, and keeps no water code of its own.

## Question

The Creek's water needs a custom material, a reflection pass and a post effect. Which parts belong
to the foundation add-on that owns all water, and how do a river and a lake share one description
and one material?

## Rule

- [D-173](D-173-addon-hooks.md): one place per feature. The water add-on owns all water, and the
  reflection pass and transmission stay in the core as general features.
- Both GPU paths are first-class. The surface and the underwater effect use only public API, and
  both paths compile the same WGSL.
- An add-on reaches the engine only through `@null3d/engine` and `@null3d/engine/stats`.

## Data

M3-F5's text sizes the Creek's water at 298 lines of surface code and 201 lines of underwater
effect. It draws:

- long waves that move the surface's vertices and finer ripples in its normal, carried downstream by
  a current;
- caustics on the bed, faded by the water's depth;
- foam at the shore and around the stones, from a map that the scene makes;
- a mirror of the banks and the sky, drawn every other frame on Low and Medium and every frame on
  High and Ultra;
- the surface seen from below, through a window overhead and a faint mirror past its edge;
- an underwater effect with the current's wobble, caustics on the bed and absorption by distance.

Two copies of the wave and caustic formulas exist because each WGSL string compiles alone, and a
test keeps them equal.

M3-E4 gives a custom material the scene's depth behind each pixel. The water therefore reads the
gap to its bed, not a height map that it is told about. M3-E4a lets that material carry its mirror
and foam maps, which the add-on needs.

## Decision

**The shape.** One description has two kinds. A river takes the points along its middle line, its
half width and its depth. A lake takes the points around its shore, its depth and the distance over
which the bed deepens. Both resolve to a body that answers `depthAt`, `contains` and `currentAt`. A
shape may give its bed and, for a river, its current as functions of any point, and its own mesh
detail, for water that a middle line and a width do not describe. The surface mesh comes from the
same body. It is a strip along a river, and a grid over a lake's bounds with the cells outside its
shore left out. The current is in the mesh's texture coordinates, so a leaf or a boat reads it
without a texture.

**The surface.** One material draws every body of one `createWater` call. It declares
`sceneInputs: ['sceneDepth']` and its textures, among them the mirror and the foam map. The gap
between the sheet and the bed behind each pixel gives the water's depth, the tint, the caustics'
reach and the foam. Measured over a band, the same gap gives the soft shore, which fades the alpha
instead of ending on the mesh's edge. A call told `bed: 'shape'` instead carries each vertex's bed
depth in its color, and the surface reads that. The surface draws both faces, and its back face
shows the window overhead.

**The surface's height.** A page asks for a gentle surface with `waveAmplitude`. It scales the long
waves and the wind's lift. The fine ripples keep the strength that `ripple` gives them. So the
surface can lie nearly flat and still ripple. The view from under the water reads the same
waterline. The Creek's water takes a tenth of the base height. At its default wind of 4 m/s the
lift reaches 0.14 m at a crest, against 0.044 m for the three long waves together. The wind's lift
therefore dominates the height, and the long waves set the crossing crests at 1 m to 3 m. The four
Creek pictures draw the calmer surface, and the Mac's references are redrawn. Those references were
already stale for the valley's new plants, so the redrawn set holds both changes. The software set
is owed to a CI run.

**The reflection cadence.** The pass redraws every other frame on Low and Medium and every frame on
High and Ultra, and a caller may give its own cadence. [The cadence through the feature
host](#the-cadence-through-the-feature-host) says how. The pass costs the same as a reflection pass
of the Creek's own.

**The underwater view.** `createUnderwater` takes the water object. The waterline therefore follows
the same long waves and the same current, and the effect shows only near or under the surface. It keeps the
Creek's per-pixel test, wobble, caustics and absorption.

**The Creek.** It draws its water through the add-on, and `water.ts` and `underwater.ts` are gone.
Its bisect switches keep working: `without=water` leaves the water out, and `reflect=always` and
`reflection-scale` set the reflection's cadence and its size. The three differences that once kept
the Creek on its own water are closed:

- **The current.** The add-on turns each wave's direction into the current's frame and carries the
  whole set at the current's speed, so the crests keep every angle between them and every one drifts
  downstream. A river may also give its current as a function of any point, so the Creek's straight
  sheets follow the stream's winding middle line. The caustics and the foam flecks drift the same
  way.
- **The thickness.** A shape may give its bed as a function of any point, and the water may read it
  in place of the copy of the scene's depth (`bed: 'shape'`). The mesh carries each vertex's bed
  depth in its vertex colors. The Creek gives the analytic bed that its land uses.
- **The shore.** The Creek's material draws opaque, and its bed ends the surface where the bed meets
  it. The add-on's soft shore remains for a scene that gives no bed.

The owner ruled that all visible motion follows the river, and that the crests stay. A block match
on the close view at three moments moves the near band's median -73, -80 and -99 degrees, against
the -90 of straight downstream, and its spread falls by more than half. The far band has only eight
blocks, so its angle is coarse: that limits the precision of the figure, not the direction, and
every far block points downstream.

The Creek's three sheets keep the columns and rows of the water that it drew itself, so their
surfaces have the same vertices and triangles. The close picture at 640 by 360 guards the carried
set, because its frame fills with the surface. The three bank views are 320 wide and draw the stream
as a ribbon a few dozen pixels across, so no crest pattern reads there. The add-on's unit tests
carry the wave copies in step, check that the whole set travels with the current, and check a shape's
own bed, current and mesh.

### The cadence through the feature host

The water is M3-E6's first user. The cadence is a feature setting, `reflectionEvery`, with the row
2, 2, 1, 1, declared to `defineFeature` and resolved by `FeatureHost` for the preset in use. The
add-on needs no handler of its own on the preset. The setting declares the governor `double`, so
each of the frame-budget governor's steps doubles the wait, up to every 16th frame. The caller's
`reflectionEvery` merges into the row before the host reads it, so the bisect switches name their
own cadence and the governor steps that cadence.

The feature's budget takes the reflection's measured cost from D-120's phone check, 3.4 ms for the
pass on the S25, halved on the presets whose cadence draws every other frame: 1.7 ms on Low and
Medium and 3.4 ms on High and Ultra. These figures come from D-120, not from a run of the add-on.
The budget's `min` is 0.25, so the governor stops at every 16th frame.

The owner accepted that last step as the cap, on these figures. With the cadence forced to every 16th
frame on every preset, the water changed on a beat of about 135 to 140 ms. That page drew at 115 to
120 frames a second, so on a 60 Hz screen the beat is about 0.27 s. The reflections visibly jerked.
The step stays because four doublings separate it from the preset's cadence. It therefore appears
under sustained pressure rather than in passing, and a scene that never reaches it never pays for
it. The alternative was to stop the ladder at 8 and let the render scale take the remaining steps.
The owner was offered it and did not take it: it trades a softer image for steadier reflections.

The stats overlay gives the feature a row named `water`, which shows its cadence and its budget:
`water  gpu not measured  reflectionEvery 2  budget 1.7 of 1.7 ms`. The engine measures no GPU scope
for the feature, because the water records through the reflection pass kind, and the add-on owns no
buffer or texture of its own to report, so `gpuMs` and `bytes` stay empty. The pass's own time stays
in the frame's parts.

The add-on declares one feature per page, as the splats add-on does, so a page makes its water with
one call and gives that call every body. A page that never imports the add-on downloads none of this
code, and the water row goes when the water is destroyed. `packages/water/src/cadence.test.ts` proves
the preset moves the cadence and the overlay figure, the governor's steps double it, a caller's row
is stepped too, and a page with no water has no row.

### Where bodies meet

Each body draws its own mesh at the water's level, and the meshes overlap where a river runs into a
lake. In the Water demo, the river's strip runs 2 m past the lake's shore and reaches 1.36 half
widths to each side. The lake's grid reaches past its shore too. Without a rule, the overlap
holds two coplanar surfaces. The water writes depth, so the mesh that drew first took each pixel.
The patch showed hard edges, straight from the river's strip and stepped from the lake's grid. The
river's flowing waves also met the lake's still ones on a line.

A lake's grid reaches two cells past its shore, 4 m at the default cell. A scene's own ground seldom
meets the water on the outline: in the Water demo, the waterline lies 0.6 to 1.2 m past it. A grid
of only the cells with a corner inside the shore stopped short of the waterline in places. The
water then ended there on the grid's stepped edge. Past the band, the scene's ground meets the
water, which fades against it by the soft shore. The cells over dry ground lie under the ground and
draw nothing.

The fix gives each point to one body, through a junction map that `junction.ts` builds with the
meshes. Its texels are 0.25 m, and it covers each overlap with a margin of about 9 m.

- A lake owns the water inside its shore, and a river the water outside every lake. Elsewhere in an
  overlap, the body whose mesh covers the whole texel draws. Where no mesh covers a texel whole,
  each mesh draws its part, which a unit test holds under 1% of the points.
- The other mesh discards the pixel. A pixel left at alpha 0 still writes depth, and the drawing
  body's pixel then fails the depth test: that left holes in the surface.
- The river's waves give way to still water's over 3 m on each side of the meeting. The surface
  mixes the two sets of waves and their caustics. Each wave's phase moves by the current times the
  time. So a current that slows across the band would carry the phases apart more every second.
- Near the meeting, both meshes carry the river's current there, one value for every vertex, so
  their waves match on each pixel. The surface also lies flat within 3.5 m of the overlap and rises
  back over 2 m. The two meshes then lie in one plane, so they agree on the texel of each pixel.
- The vertices take the flatness in their first texture coordinate, beside the body's number, so
  the vertex stage reads no texture. With the map read in the vertex stage too, the largest WebGL2
  shader build was 56.1 KB after Brotli, past the figure that the budget then held. Without it, the
  build is 55.9 KB, against 54.9 KB before the junction.
- `surfaceHeight` and `currentAt` follow the same owner, the same mix and the same flat band.

`packages/water/src/junction.test.ts` lays out the demo's river and lake. It proves that each point
draws once with no hole, and that the lake and the river own their sides. The share runs smoothly
from 1 to 0. The surface lies flat at the meeting, and both meshes carry one current there. The Mac's three `demo-water` pictures are drawn again, and the held frame
shows the mouth only from far away. The other three, the software set, still show the previous tour:
a frame of the loop differs from them in most of its pixels, so a software image run of this branch
is red until a CI run draws them and `images:review` takes them from it.

## The ocean

`createOcean` draws an open sea. Its waves come from two or three bands of wave spectra. Compute
passes transform each band into the height of the sea every frame. The fragment forms of the same
passes draw the chain on WebGL2. It is the compute hook's first user (D-173's H1, M3-E8).

### Question

How does an open sea turn a wind's spectrum into waves that one material moves and lights, on both
GPU paths, without work on the page's thread?

### Rule

- The compute hook fills the heights in the frame that the material reads them, and the same chain
  has a fragment form for WebGL2. Both forms write the same field: the fragment form keeps the
  row index that its shader names, and the read that compares them keeps that index
  ([D-271](D-271-a-fallback-pass-writes-the-image.md)).
- The add-on owns the ocean as it owns the river (D-173).
- A pass may not read its own texture. WebGL2 draws a fragment form one texel for each pixel. So a
  stage that each pixel computes alone is the form that both paths share.

### Data

A band of 128 by 128 texels takes seven radix-2 stages for each axis. A sea of three bands runs 14
passes on that grid, then one more that puts the heights in meters and adds the slopes. The plan's
estimate is about 0.5 ms for three bands.

The browser test reads each band's heights back and compares them with the transform on the page's
thread. On WebGPU the worst texel of the read square differs by 0.004 m, and in compatibility mode
by 0.004 m, and on WebGL2 by 0.004 m too, of a field of 0.73 m. The former 0.60 m gap on WebGL2
came from the read: it fetched rows from the other end of the target
([D-271](D-271-a-fallback-pass-writes-the-image.md)). With the read fixed, the three paths draw the
same field, so `ocean-waves` judges WebGL2 like the other tiers.

The reflection keeps its image in the frames that its cadence waits, on every path. The CPU-culled
builder moves a view's turn on before it culls the view, so the turn's pass records its objects.
The sampled texture then keeps the last image between turns. The demo draws on every path, and its
six pictures hold in both reference sets.

The rule the fault broke is worth keeping. A view's turn moves on before anything culls against it.
The cull reads the turn to choose the objects the view draws. The recording reads it again to
choose whether the view draws at all. A frame that reads the turn at two points in time draws an
empty pass on the turn.

**The frame rate, in a quiet window.** At 1920 by 1080 on Low on WebGL2, `ocean-rate` read 60.01
frames a second and a 16.7 ms frame in all three states. The reflection carried its cadence through
the setter, and the one-minute load was 7.7. The test's browser reports a 60 Hz display, so the page
held its display's rate in every state. The page that switched the pass off and on every other
frame read 1.21 frames a second at the same preset.

**The transform's cost, as trials.** Two pairs of trials at Low, with the reflection at its
longest cadence, read the WebGL2 fragment chain as a positive difference in every round: 1.08 to
2.10 ms in one pair and 0.61 to 3.37 ms in the other, a median near 1.5 ms. The WebGPU compute chain
stayed inside the frame's own noise in the same trials: the rounds' differences fell between -0.36
and 0.37 ms, so no figure above zero resolves, and the chain sits under about 0.4 ms. The
transform's grid and bands do not change with the preset, so one figure answers each preset. These
are notes from a busy machine, at a load of 9 to 16, not verdicts. Other sessions built and drew
pictures during the trials, so a round may fall in a picture draw; the two pairs agree on the
direction and the size, which the picture draw cannot give a round, but the figures stay notes.

**The simulation's cost, per path.** `ocean-ablation.spec.ts` draws the cost page with the
simulation on in one page load and off in the next. The camera, the preset and the scale are the
same, and the frame's own GPU time is the difference. The run held the quiet window for ten minutes. The
shared queue held its own jobs back, and the marker in `tools/lib/quiet-window.ts` stopped builds
in other checkouts. The one-minute load was 6.9 before the first batch and 2.0 to 2.4 for the rest. A neighbour's
package build started just before the marker went up and ran about forty seconds into it. The least
of the three batches is the figure that stands, so the batch that shared the machine is excluded by
construction. The least difference of three batches was 2.850 ms on WebGL2, whose batches read
2.850, 3.063 and 3.009 ms.
On WebGPU the batches differ by -0.484, -1.415 and +0.062 ms, and in compatibility mode by -0.319,
+1.462 and -0.540 ms. The chain sits inside the frame's own variation on those paths, so the method
states no cost there. The smallest resolved bound is about 1.4 ms.

**The budget at each preset.** The plan's estimate is 0.5 ms for three bands at 128 squared. The
preset does not change the bands or the grid. Its bands, the mesh's segments and reach, and the
reflection's cadence are `createOcean`'s options. The transform's grid is the module's fixed 128.
The add-on's only preset row is `reflectionEvery`, which paces the reflection. So the figure above
is the figure at every preset. The Mac's 2.850 ms on WebGL2 is 5.7 times the estimate. That is a
finding about the estimate, and the cause is the fragment form. The Mac's ocean sits well inside a
16.7 ms frame at 60 frames a second. The only per-preset reflection figure is the Galaxy S25's,
1.7 ms at Low and Medium and 3.4 ms at High and Ultra ([D-120](D-120-planar-reflections.md)). No
reflection figure exists for the Mac, so the two are not one frame. The phone's reflection beside
the Mac's ocean is a ceiling across two devices. The phone has no ocean figure. This clause does
not ask for one, and a later row that names the class's stand-in device will need it. The Mac's
WebGPU and compatibility chain adds at most about 1.4 ms, so its ocean stays inside the frame there
too.

**The cause of the WebGL2 figure.** The fragment form runs the fifteen 128-squared passes through
the fragment pipeline, fifteen raster passes of 16,384 pixels each. The compute path runs the same
work in one compute pass.

`ocean-cost.spec.ts` keeps the earlier instrument, gated by `NULL3D_OCEAN_COST`: it sends the
reflection to its longest cadence and takes more rounds and longer sides from the environment. The
pass timer names all fifteen transform passes `compute`, so their times do not separate by name.
The design figure for three bands at 128 squared is 0.5 ms
([D-179](D-179-technique-rulings.md) ruling 19).

The first rate runs measured the page while the reflection switched itself off every other frame.
At 1920 by 1080 on Low the ocean drew 1.21 frames a second, and a 64 squared grid gave 1.45.
[D-287](D-287-a-pass-carries-its-cadence.md) then showed that the switch recompiled the render graph
every frame: with the pass carrying its cadence, the same page and the same draws held 60 frames a
second in all three states. So the figures below measure the recompile, not the transform, and a
quarter of the pixels taking away 18 per cent of the cost fits a fixed per-frame cost.

The switched page read these, with the first column as its on-and-off difference.
**Every figure below measures the recompile, not the transform.**

| Option | Difference | Frame | Rate |
| --- | --- | --- | --- |
| Three bands at 128 squared, as it stands | 675 ms | 833 ms | 1.2 fps |
| Two bands | 450 ms | 608 ms | 1.6 fps |
| One band | 225 ms | 383 ms | 2.6 fps |
| A 64 squared grid | 169 ms | 327 ms | 3.1 fps |
| A 32 squared grid | 42 ms | 200 ms | 5.0 fps |
| A 16 squared grid | 11 ms | 169 ms | 5.9 fps |
| No simulation, the analytic waves | 0 | 158 ms | 6.3 fps |

The rows assume that the difference follows the pixels, which the 64 squared run already
contradicted. Neither that run nor these figures measures the transform, so the bands and the grid
are unmeasured as levers. The cost per preset is owed before either is chosen.

### Decision

**A band.** A band is a square tile of the sea whose waves are a sum of plane waves. The Phillips
spectrum gives each wave an amplitude from its length and the wind, and a seeded random number in
the page gives its phase. The page generates about two hundred thousand numbers once, at startup,
and uploads them as a texture of a layer for each band. The spectrum is normalized so that the raw
sum of its waves has a spread of one. The transform then adds the spectrum with no scaling of its
own. Every intermediate value stays inside the range that a 16-bit float keeps.

**The chain.** Each stage is a compute pass on a 128 by 128 grid, with a band to a layer. A pass
carries its stage and the three tiles in its values, so one compiled shader runs every stage, and it
reads the pass before it as a texture of the maps' group. The first horizontal stage adds the waves
at the sketch time, in the bit-reversed order that the butterfly takes. No pass then turns the input
over. The first vertical stage turns its own axis the same way. A fifteenth pass scales each band to
its significant height and writes the slopes along x and z from the heights beside it, with the
tile's other edge standing in for the one past it.

**The surface.** One material reads the three bands of the last pass at each band's own scale. It
sums their heights for the vertices, sums their slopes for the normal, mirrors the sky with the
slopes, breaks foam on the crests, and fades where the bed behind it rises to meet the surface. The
bands' tiles differ, so the material samples each layer at its own share of the world.

**The mesh.** A square grid follows the camera, and its cells grow with distance, so the eye sees
fine waves without a mesh of millions of vertices. The camera's place is the mesh's origin, and a
vertex's world place is the origin with its place in the mesh.

### Consequences

- The ocean takes 15 of the 31 passes that a sketch may add, beside its reflection. A sketch that
  draws a sea leaves room for its own passes.
- The read buffers of the GPU-driven path took ids that a view of the tenth pass also took, so a
  frame of many passes mapped a view's frame buffer as a read's buffer. The per-view ids now start
  after the read buffers, and a unit test in each builder refuses their meeting.
- The add-on's own page draws the sea on the three GPU paths, and a browser test reads each band's
  heights back and compares them with the transform on the page's thread.
- The WebGL2 page's first rates measured the frame's recompile, not the transform
  ([D-287](D-287-a-pass-carries-its-cadence.md)). With the pass carrying its cadence, the same page
  holds 60 frames a second, so the transform's cost per path and preset is owed rather than known.
  The data's table keeps the switched page's figures as the reading that the cadence replaces.
- The three GPU paths draw one sea. `ocean-waves` reads each band's heights back and compares them
  with the page's transform: the worst texel differs by 0.004 m of a 0.73 m field on WebGPU, in
  compatibility mode and on WebGL2, after [D-271](D-271-a-fallback-pass-writes-the-image.md) made
  the read keep the rows that the shader names. The demo draws on every path: its WebGL2 tier runs
  at Medium, whose cadence is two, and the reflection keeps its last image there.

## Consequences

- The add-on's largest material sets were over D-14's first-use shader figure of 58 KB when this was written, and the figure has since risen to 128 KB. The water's
  is 79.9 KB after Brotli; the landing head without this branch measures 79.5 KB, so the branch
  adds at most 0.6 KB. The ocean's was 74.8 KB as this branch measured it, before the landing's
  shader keying changed the build. The growth past the 55.9 KB recorded here earlier is the builds
  that a material naming its surface alpha compiles for alpha to coverage, the alpha hash and a
  masked shadow and motion, which the water's soft shore names (`681d70cea`). The add-on check
  warns and does not fail, by the owner's ruling that an add-on's size is a warning
  ([D-225](D-225-addon-listing-check.md)). The ocean's figure after the keying change is owed, and
  the check measures it with `--skip-browser` once the WebAssembly core is built.
- A custom effect that draws its own pass keeps no pieces in its module, because they never reach a
  host. The underwater effect's pieces would be 93 KB of the add-on's entry. D-225 gives the rule.
- The Creek's pictures draw the add-on, as the add-on's demo does. The Creek keeps the columns and
  rows of the water that it drew itself, so each sheet has the same vertices and triangles as the
  water it replaced. Its four held pictures pass against the references already in the tree on
  WebGPU, compatibility mode and WebGL2, on the Mac and on SwiftShader, so no Creek reference moved.
- The page and allocation gates ran in the browser against E4a's engine: the water page starts from
  another origin under the strict policy, threaded and single-threaded, and the add-on's own code
  allocates zero bytes a frame on all four presets. That is E4a's first user, end to end.
- The add-on's cost gate has run at this head. `bun packages/cli/bin/null3d.js check-addon
  packages/water` passed the page, cost, allocation and size gates. Its cost per preset read 2.03,
  2.85, 2.56 and 2.85 ms of GPU time a frame. Its allocation read zero bytes a frame in the add-on's
  own code at every preset. The machine stood at a load of about 30 to 44 through the run, so the
  cost figures are notes until a quiet run. The transform's own cost is treated above, with the
  WebGPU quiet window and the older path's closed one.
- The ocean's simulation costs 2.850 ms a frame on WebGL2. That is the least of three batches of an
  on/off ablation in separate page loads, against the plan's 0.5 ms estimate. On WebGPU and in
  compatibility mode the same method resolves no cost. The batches straddle zero inside the frame's
  own variation, and the bound is about 1.4 ms. The preset does not change the bands or the grid, so
  the figure is the figure at every preset. The Mac's ocean sits inside a 16.7 ms frame on its own.
  The only per-preset reflection figure is the S25's, and the two devices are not added.
- The add-on's tests cover the shape, the mesh's coverage and winding, a shape's own current, bed
  and mesh, the carried wave set, the wave copies, the foam map and the size gates. The demo
  `examples/water` draws both bodies and the view from below. The package's own page
  (`packages/water/page`, which the tarball leaves out) gives the listing check's page, cost and
  allocation gates a scene to measure.
- The demo's tour is one loop of shots through the route of `examples/lib/cinematic.ts`, as a
  function of the time. It drifts down the river along the bank and dives under the lake for about
  24 s. It then rises, turns to face back over the scene, and circles the valley back to its first
  shot. A tour that dipped beside the river went into the bank for 26% of its flight. One that ran
  past the lake jumped back to the river's source. `examples/water/route.test.ts` keeps the loop at
  least 0.5 m above the ground and 3 m from every boulder, whose foam map shows its texels as blocks
  from closer. It also keeps the dive in the lake and the turn under 30 degrees a second.
- The demo's channel runs the whole valley. So the river starts near the ground's west edge, and a
  second stream leaves the lake's east shore for the east edge. The channel holds water from end to
  end. The lake meets a stream at both ends, which the junction map handles as two meetings.
- The held frame shows the tour at 1 s, so the six `demo-water` pictures change. The Mac's set is
  drawn again at 3.003, 1.021 and 1.149 per cent of their pixels moved. The software set is owed.
  Those three pictures show the previous tour until a CI run of this range draws them, so a software
  image run is red until then.
