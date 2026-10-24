# D-251: The water add-on

Status: built by M3-F5. Date: 2026-10-24. Task: M3-F5.

Summary: `@null3d/water` draws a river and a lake from one shape, with the waves, ripples, caustics,
foam, soft shores, reflection and underwater view lifted from the Creek showcase. The surface reads
the copy of the scene's depth that M3-E4 added, so a shore fades against the real bed. The
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

M3-E4 gives a custom material the scene's depth behind each pixel, so the water reads the gap to its
bed rather than a height map it is told about. M3-E4a lets that material carry its mirror and foam
maps, which the add-on needs.

## Decision

**The shape.** One description has two kinds: a river takes the points along its middle line, its
half width and its depth; a lake takes the points around its shore, its depth and the distance over
which the bed deepens. Both resolve to a body that answers `depthAt`, `contains` and `currentAt`. The
surface mesh comes from the same body: a strip along a river, and a grid over a lake's bounds with
the cells outside its shore left out. The current is in the mesh's texture coordinates, so a leaf or
a boat reads it without a texture.

**The surface.** One material draws every body of one `createWater` call. It declares
`sceneInputs: ['sceneDepth']` and two textures, the mirror and the foam map. The gap between the
sheet and the bed behind each pixel gives the water's depth, the tint, the caustics' reach and the
foam; the gap measured over a band gives the soft shore, which fades the alpha instead of ending on
the mesh's edge. The surface draws both faces, and its back face shows the window overhead.

**The reflection cadence.** The pass redraws every other frame on Low and Medium and every frame on
High and Ultra. The water follows `quality.preset` through `quality.onChange`, and a caller may give
its own cadence. The pass costs what the Creek's did.

**The underwater view.** `createUnderwater` takes the water object, so the waterline follows the same
long waves and the same current, and adds the effect only near or under the surface. It keeps the
Creek's per-pixel test, wobble, caustics and absorption.

**The Creek.** It samples its own middle line and half width into the shape and passes its own stone
foam map. `water.ts` and `underwater.ts` go, and its route test reads `waveHeight` from the add-on.

## Consequences

- The add-on's material sets are 53.3 KB after Brotli, so D-14's first-use shader budget rose to
  56 KB (its addendum of the same date).
- A custom effect that draws its own pass keeps no pieces in its module: they never reach a host,
  and the underwater effect's were 93 KB of the add-on's entry. D-225 records the fix.
- The Creek's image references may move where its analytic bed met the general depth read. They are
  redrawn when the images run.
- The add-on's tests cover the shape, the surface mesh's coverage and winding, the wave copies,
  the foam map and the size gates. The demo `examples/water` draws both bodies and the view from
  below, and the package's own page (`packages/water/page`, which the tarball leaves out) gives the
  listing check's page, cost and allocation gates a scene to measure.
