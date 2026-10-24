# D-257: The water add-on

Status: built by M3-F5. Date: 2026-10-24. Task: M3-F5.

Summary: `@null3d/water` draws a river and a lake from one shape. It brings the waves, ripples,
caustics, foam, soft shores, reflection and underwater view that the Creek showcase had. The surface
reads the copy of the scene's depth that M3-E4 added, so a shore fades against the real bed. The
reflection redraws as the quality preset affords. The Creek keeps no water code of its own.

## Question

The Creek's water is a custom material, a reflection pass and a post effect. Which parts become the
foundation add-on that owns all water, and how do a river and a lake share one description and one
material?

## Rule

- [D-173](D-173-addon-hooks.md): one place per feature. The water add-on owns all water, and the
  reflection pass and transmission stay in the core as general features.
- Both GPU paths are first-class. The surface and the underwater effect use only public API, and
  both paths compile the same WGSL.
- An add-on reaches the engine only through `@null3d/engine` and `@null3d/engine/stats`.

## Data

The Creek's water is 298 lines of surface code and 201 lines of underwater effect
(`examples/showcase/creek/water.ts` and `underwater.ts`, M3-F5's text). It draws:

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
High and Ultra. The water follows `quality.preset` through `quality.onChange`, and a caller may give
its own cadence. The pass costs what the Creek's did.

**The underwater view.** `createUnderwater` takes the water object. The waterline therefore follows
the same long waves and the same current, and the effect shows only near or under the surface. It keeps the
Creek's per-pixel test, wobble, caustics and absorption.

**The Creek.** It samples its own middle line and half width into the shape. It passes its own
stone foam map. Its bisect switches keep working: `without=water` leaves the water out, and
`reflect=always` and `reflection-scale` feed the add-on's cadence and its reflection size. `water.ts` and `underwater.ts` go, and its route test reads `waveHeight` from the add-on.

### Addendum: the cadence through the feature host, 25 October 2026

M3-E6's water first user. The cadence no longer follows the preset with a handler of the add-on's
own. It is a feature setting, `reflectionEvery`, with the row 2, 2, 1, 1, declared to
`defineFeature` and resolved by `FeatureHost` for the preset in use. The setting declares the
governor `double`, so each step of the frame-budget governor's steps doubles the wait, up to every
16th frame. The caller's `reflectionEvery` merges into the row before the host reads it, so the
bisect switches still name their own cadence and the governor still steps that cadence.

The feature's budget takes the reflection's measured cost from D-120's phone check, 3.4 ms for the
pass on the S25, halved on the presets whose cadence draws every other frame: 1.7 ms on Low and
Medium and 3.4 ms on High and Ultra. These are not new measurements. The budget's `min` is 0.25, so
the governor stops at every 16th frame.

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

The record is D-257 because the milestone's tip gave D-251 to the recording and replay of a session
while this work was in flight.

## Consequences

- The add-on's material sets are 53.3 KB after Brotli, so D-14's first-use shader budget rose to
  56 KB (its addendum of the same date).
- A custom effect that draws its own pass keeps no pieces in its module, because they never reach a
  host. The underwater effect's were 93 KB of the add-on's entry. D-225 records the fix.
- The Creek's image references may move where its analytic bed met the general depth read. They are
  redrawn when the images run, with their reason sent before the change is accepted.
- The branch landed on the milestone's tip with E4a on top; E4a's own record took D-256 there,
  because main had taken D-250 for the timed script while both were in flight.
- The page and allocation gates ran in the browser against E4a's engine: the water page starts from
  another origin under the strict policy, threaded and single-threaded, and the add-on's own code
  allocates zero bytes a frame on all four presets. That is E4a's first user, end to end.
- The cost per preset stays owed until a quiet window, because the first runs came at a machine load
  of 90 to 155. Its command is `bun packages/cli/bin/null3d.js check-addon packages/water`, which
  measures the add-on's page on each preset; `--skip-cost` leaves that gate out and runs the page
  and allocation gates.
- The add-on's tests cover the shape, the mesh's coverage and winding, the wave copies, the foam
  map and the size gates. The demo `examples/water` draws both bodies and the view from below. The
  package's own page (`packages/water/page`, which the tarball leaves out) gives the listing check's
  page, cost and allocation gates a scene to measure.
