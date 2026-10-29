# D-257: The water add-on

Status: decided. Built: the `@null3d/water` add-on, its demo, and the reflection's cadence through
the feature host. Owed: the cost per preset, and the Creek's migration to the add-on, which waits
until the add-on follows the current as the Creek does. Tasks: M3-F5, M3-E6.

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
of flow. The owner also ruled that all visible motion follows the river. The Creek's own water
therefore takes the current from the stream's middle line. Each wave is a tilt of at most a fifth of
a right angle from that current, so every crest travels downstream. A wave travels along its own
direction, so a world-fixed direction crosses the stream however the phase is carried. The caustics
and the foam flecks drift along the same current.

The add-on still draws each wave along a direction fixed in the world, so its surface keeps the
crossing motion. The Creek therefore draws its own water. M3-F5's migration of the Creek to the
add-on waits until the add-on follows the current in the same way. A close picture of the stream's
surface guards the look, as the bank views draw the stream only a few dozen pixels wide. The unit
test that keeps the wave copies equal also refuses a tilt beyond a fifth of a right angle.

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

## Consequences

- The add-on's material sets are 53.3 KB after Brotli, so D-14's first-use shader budget is 56 KB.
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
