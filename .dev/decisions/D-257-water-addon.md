# D-257: The water add-on

Status: decided. Built: the `@null3d/water` add-on, its demo, the reflection's cadence through
the feature host, and one owner for each point where bodies meet. Owed: the cost per preset, and
the Creek's migration to the add-on, which waits until the add-on follows the current as the Creek
does. Tasks: M3-F5, M3-E6.

Summary: `@null3d/water` draws a river and a lake from one shape, with waves, ripples, caustics,
foam, soft shores, a reflection and an underwater view. The surface reads the copy of the scene's
depth, so a shore fades against the real bed. The reflection's cadence is a feature setting of the
preset and the governor. The Creek draws its own water, by the owner's ruling on the look. Its waves
run along the stream's current, so the whole surface moves downstream.

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
which the bed deepens. Both resolve to a body that answers `depthAt`, `contains` and `currentAt`. The
surface mesh comes from the same body. It is a strip along a river, and a grid over a lake's bounds
with the cells outside its shore left out. The current is in the mesh's texture coordinates, so a leaf or
a boat reads it without a texture.

**The surface.** One material draws every body of one `createWater` call. It declares
`sceneInputs: ['sceneDepth']` and two textures, the mirror and the foam map. The gap between the
sheet and the bed behind each pixel gives the water's depth, the tint, the caustics' reach and the
foam. Measured over a band, the same gap gives the soft shore, which fades the alpha instead of
ending on the mesh's edge. The surface draws both faces, and its back face shows the window overhead.

**The reflection cadence.** The pass redraws every other frame on Low and Medium and every frame on
High and Ultra, and a caller may give its own cadence. [The cadence through the feature
host](#the-cadence-through-the-feature-host) says how. The pass costs the same as a reflection pass
of the Creek's own.

**The underwater view.** `createUnderwater` takes the water object. The waterline therefore follows
the same long waves and the same current, and the effect shows only near or under the surface. It keeps the
Creek's per-pixel test, wobble, caustics and absorption.

**The Creek.** It keeps its own `water.ts` and `underwater.ts`. Its bisect switches keep working:
`without=water` leaves the water out, and `reflect=always` and `reflection-scale` set the
reflection's cadence and its size. The add-on's river and the Creek's water differ in three ways,
and the owner rules those differences wrong for the Creek.

- **The current.** The add-on reads it from the river mesh's texture coordinates, so each vertex
  carries a vector. The wave phase, the foam drift and the caustic drift follow that vector. The
  Creek's water takes its current from the stream's middle line, and the wave phase, the foam drift
  and the caustic drift follow it.
- **The thickness.** The add-on takes it from the screen-space copy of the scene's depth. The
  Creek's water computes an analytic bed. The change moves the caustics and the edge foam.
- **The shore.** The add-on fades the water's alpha over a soft ramp. The Creek's water ends
  opaque at the mesh's edge.

The owner rejects the add-on's look in the Creek: the surface shows sideways lines between stretches
of flow. The owner also ruled that all visible motion follows the river, and that the crests stay.
The Creek's own water therefore takes the current from the stream's middle line. The six wave
directions stay as they were, measured in the current's frame, so the crests keep every angle
between them. The current carries the whole set, so the pattern keeps its cross-hatch and every
crest drifts downstream. The caustics and the foam flecks drift along the same current.

A block match on the close view at three moments moves the near band's median -73, -80 and -99
degrees, against the -90 of straight downstream, and its spread falls by more than half. The far
band has only eight blocks, so its angle is coarse: that limits the precision of the figure, not the
direction, and every far block points downstream.

The add-on still lets each wave run along a direction fixed in the world, so its crests cross the
stream. The Creek therefore draws its own water. M3-F5's migration of the Creek to the add-on waits
until the add-on follows the current in the same way. The close picture at 640 by 360 guards the
carried set, because its frame fills with the surface. The three bank views are 320 wide and draw
the stream as a ribbon a few dozen pixels across, so no crest pattern reads there; their reference
changes are incidental. The unit tests keep the wave copies equal, check that no two directions
collapse, and check that the pattern drifts downstream with the current.

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
  shader build was 56.1 KB after Brotli, past the 56 KB budget. Without it, the build is 55.9 KB,
  against 54.9 KB before the junction.
- `surfaceHeight` and `currentAt` follow the same owner, the same mix and the same flat band.

`packages/water/src/junction.test.ts` lays out the demo's river and lake. It proves that each point
draws once with no hole, and that the lake and the river own their sides. The share runs smoothly
from 1 to 0. The surface lies flat at the meeting, and both meshes carry one current there. The Mac's three `demo-water` pictures are drawn again, and the held frame
shows the mouth only from far away. The other three, the software set, still show the previous tour:
a frame of the loop differs from them in most of its pixels, so a software image run of this branch
is red until a CI run draws them and `images:review` takes them from it.

## Consequences

- The add-on's largest material set is 55.9 KB after Brotli, within D-14's first-use shader budget
  of 56 KB, which leaves 0.1 KB.
- A custom effect that draws its own pass keeps no pieces in its module, because they never reach a
  host. The underwater effect's pieces would be 93 KB of the add-on's entry. D-225 gives the rule.
- The Creek's pictures draw its own water, and the add-on's demo draws the add-on. A change to one
  moves only that one's pictures.
- The page and allocation gates ran in the browser against E4a's engine: the water page starts from
  another origin under the strict policy, threaded and single-threaded, and the add-on's own code
  allocates zero bytes a frame on all four presets. That is E4a's first user, end to end.
- The cost per preset is owed until a quiet window, because every attempt came at a machine load of
  90 to 155. Its command is `bun packages/cli/bin/null3d.js check-addon packages/water`, which
  measures the add-on's page on each preset; `--skip-cost` leaves that gate out and runs the page
  and allocation gates.
- The add-on's tests cover the shape, the mesh's coverage and winding, the wave copies, the foam
  map and the size gates. The demo `examples/water` draws both bodies and the view from below. The
  package's own page (`packages/water/page`, which the tarball leaves out) gives the listing check's
  page, cost and allocation gates a scene to measure.
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
