# D-146: A grid of irradiance probes gives the scene local, coloured indirect light

Status: decided by the coordinator on 13 October 2026. It follows the owner's ruling [D-142](D-142-more-techniques-before-1-0.md) of 11 October 2026, which moved a light probe grid into M2. Built: the grid is on main (`c309987b2`), and "Figures" holds its measurements.

Summary: A scene can bake a grid of irradiance probes in the browser, or give the engine a baked grid of its own. Each probe holds L1 spherical harmonics of the light that arrives at its point. Standard materials read the grid per pixel, three hardware-filtered reads each, with a normal offset for leak control. The grid replaces the environment's diffuse light, because the bake already holds the sky; the environment keeps its reflections. It runs at near zero cost while no scene sets a grid. This is the cheap step toward global illumination: it gives coloured bounce indoors and sky occlusion under a canopy.

## Question

D-142 moved a light probe grid into M2 for the showcase scenes: coloured bounce in Night town and light under Creek's trees. The engine lights every surface from one scene-wide environment at the moment. Indirect light that changes with a surface's place, and light bounced from coloured walls or ground, need a grid of local samples. What should the grid hold, how is it baked, and how is it read?

## Data

The technique review of 4 October 2026 compared eight engines ([Technique review, October 2026](../technique-review-2026-10.md#gaps-ranked), gap 21). It checked what each one stores and reads for a grid of local light:

| Engine | Storage | Reads per pixel | Baked |
| --- | --- | --- | --- |
| three.js `LightProbeGrid` | L2 SH in one RGBA16F 3D atlas of seven sub-volumes | 7 trilinear | on the GPU, six cube captures per probe |
| Bevy irradiance volumes | Ambient cube, 6 colours, in one 3D texture | 3 trilinear | offline (Blender) |
| Unity Adaptive Probe Volumes | L1 or L2 SH in 3D texture bricks, L1 normalised by L0 in 8 bits | 3 (L1) or 7 (L2) | offline |
| Godot `LightmapGI` | L2 SH per probe point, tetrahedral blending, read per object | 0 | offline |
| Wicked Engine DDGI | L1 SH per probe, depth moments for visibility | 8 probes by hand | every frame, ray traced |

The engine's constraints decide the shape. WebGL2 gives the lit fragment stage 16 texture units. D-142 keeps every new per-pixel input inside that count ("All probe grids share one 3D texture"). A page's start must not grow for a scene that sets no grid. The format must also filter in hardware on both paths.

## Decision

The coordinator chose the following on 13 October 2026, under D-142's ruling.

1. **L1 SH, one RGBA16F 3D texture.** Each probe holds four RGB coefficients, 12 floats, 24 bytes. Three sub-volumes stack along Z, each `nx * ny * (nz + 2)`: one padding slice at each end, so hardware trilinear filtering does not blend across sub-volumes. L1 needs three hardware-trilinear reads per pixel, half of L2's seven, which is what a phone budget takes (the table above). L1 keeps the light's direction, which a position-varying grid needs, where an ambient cube cannot hold a colour above its six axes.
2. **Sampling with a normal offset.** The sample point moves half a probe spacing along the surface normal, is clamped to the grid and remapped to texel centres, as three.js does. The normal offset is the whole of the leak control: a probe inside a wall cannot bleed its light onto the far side. The Ramamoorthi L1 constants, the first four terms of the engine's own `sh_irradiance`, evaluate the light.
3. **The grid replaces the environment's diffuse term.** An `environmentWeight` uniform (1 by default) takes the environment's diffuse light away where a grid is set, because the bake already counts the sky. The environment keeps its reflections. This matches Bevy and Godot, and it is why the bake does not double the sky.
4. **The bake runs in the browser.** The sketch worker casts Fibonacci-sphere directions from each probe with `scene.raycastBatch`. A ray that reaches the sky takes the environment's radiance. A ray that hits a surface takes the surface's colour times the light already at the hit, so one bounce is coloured. The caller gives an `albedo` function for its own scene, and gets the light back. Probes bake a few per frame, so a load screen can show progress. A scene may also hand the engine a grid baked elsewhere.
5. **Shaders load on first use.** The sampling lives in a first-use shader set, so a page that sets no grid downloads and compiles none of it. A `quality.probeGrid` setting (0 on Low) turns the grid off on phones and keeps the field near zero while it is unused.

**Rejected.** L2 SH, because seven trilinear reads per pixel is a phone cost that the showcase scenes do not need. An ambient cube, because it cannot hold the direction of a bright patch and D-142 wants coloured bounce. Baking only offline, because the showcase scenes are built in code and must bake in the browser. A GPU bake through six cube captures per probe (three.js's path) is the better long-term bake. It waits for the shared capture that M2-EX32 (reflection probes) adds. The ray-cast bake here is the first cut.

## Figures

The frame group's binding layout change frees binding 10 for the grid. It moved no measured page. `bun run bench:gpu-check` compared the branch with main at 120 Hz, with one dropped run. GPU time per frame changed by +0.3% in S4 at Medium and by -2.2% in S6 at Medium. It changed by +6.6% in S4 at High and by -2.0% in S6 at High. Each change is well inside its rule's limits.

The grid's sampling sits in its own first-use templates, `probe_grid` and `probe_grid_maps`, so a page that sets no grid downloads none of it. The builds pass every download figure: the pipelined start is 159.6 KB after Brotli on WebGL2 and 145.7 KB on WebGPU against 160 KB, and the shaders' combination file is 54.7 KB uncompressed against 64 KB. The templates leave out the area lights, transmission, level of detail fade, weighted transparency and coat and sheen bits, so a mesh with one of those features draws without grid light until those figures allow them. `ProbeShading` keeps such a pair on its plain template (the mask is checked against the templates' lists by a unit test in `probe_shading.rs`).

## Consequences

- **Storage and memory:** 24 bytes per probe. A 24 x 8 x 24 grid (one probe per metre over a 24 m hall, 4,608 probes) takes 110 KB.
- **Frame group's bindings, settled.** The lit shader's group 0 used every binding below 16 on WebGL2, and M2-EX32 (reflection probes) took binding 3 on both paths. A per-pixel grid needed a freed slot, since Godot's per-object rule costs no texture unit but does not vary per pixel. The cascades' block (binding 6) and the tiles' (binding 10) became one block, which freed binding 10 on both paths for the grid and costs one upload ("Figures").
- **WebGL2 texture units:** the grid is one more unit for the lit builds that read it, inside the 16 that D-142 names. The build counts a build's units and fails at 16.
- **Tests and size:** image references of a baked grid on the three GPU paths, and an allocation check of the bake and the frame. A download-size check proves that a page without a grid pays nothing.
- **Docs, mapping and skills:** a docs page, the three.js `LightProbeGrid` mapping entry, and the skill lines, with the showcase scenes able to set a grid.
- **Later:** the GPU bake over six capture views joins with M2-EX32's capture, and a validity mask for the strong leaks the normal offset cannot fix.

## Addendum, 2026-10-14: the frame group's binding 3, shared with the area lights

The "Frame group's bindings, an open question" under Consequences met its answer when the area
lights (D-145, M2-EX28) landed.

**The problem.** WebGL2's frame group, group 0, has exactly sixteen slots (`GROUP_BASES[0]` in
`gpu/webgl2/programs.ts`). Main used fourteen of them, with the area lights' tables texture at
binding 3. M2-EX32 (reflection probes) needs binding 3 for the probes' maps, and this record reserves
the freed binding 10 (the shadow blocks' merge) for the light probe grid. That left no free slot on
WebGL2 for the area lights' tables: the grid, the probes and the tables could not all have one.

**Options.** (A) Give binding 10 to the area lights' tables and find the grid another WebGL2 slot,
which does not exist. (B) Hold the probes' maps and the light tables' layers in one texture array at
binding 3. (C) Extend the WebGL2 group-0 slot budget by one, which changes `GROUP_BASES` and the
uniform-block slot plan.

**Chosen: B, by the owner on 14 October 2026.** Both textures are `rgba16float` `texture_2d_array`
read with the frame's filtering sampler, so one array serves both. Its layers are, in order: layer 0
spare, layers 1 and 2 the area lights' tables (D-145), the probes' maps next, and a rectangle light's
image in each layer after them. Every layer is `max(probeSize, 128)` texels, the shape grows on
demand, and a regrow copies the existing layers into the new texture (`Op::CopyTextureToTexture`, the
engine's own op) rather than asking the probes to capture again: a probe's map is preserved and the
light tables and images re-upload from engine memory, which costs nothing. So the array keeps binding
3, binding 10 stays for the grid, and no texture is reserved at a fixed 32 layers.

**Rejected.** A permanent reservation of the 32 image layers, which would add about 17 MB and pad each
128-texel image inside a `probeSize` layer. Re-capturing or re-filtering the probes on a regrow, which
the copy removes.

## Addendum, 15 October 2026: the CPU copy of the shader's formula

The engine keeps a CPU copy of the grid's irradiance formula (`l1Irradiance` and `sampleGrid` in `packages/engine/src/scene/light-probes.ts`), and the bake uses it for the light at a ray's hit. Its first version read only the first L1 coefficient and paired it with the normal's x. It never read the L1 coefficients along z and x. The unit test of that time set the first L1 coefficient and checked it against a normal along x, so it pinned the fault. The other tests compared the CPU grid sampling with the same CPU formula, so they could not see it.

The fix reads all four coefficients in the shader's order: L0, then L1 along y, z and x, as `probe_grid.wgsl` and `sh_irradiance` read them, and as the bake writes them. A unit test now compares the CPU result with the shader's formula for normals along each axis, both ways, and a diagonal. Each term and channel has its own value, so a swapped or missing term fails. The bake's light at a hit now calls the same function, so the formula lives once on the CPU. No shader or image changed: the GPU path was always right.

## Addendum, 15 October 2026: the bake's spacing, and the grid setter takes the bake's arrays

The coordinator ruled on three faults in the grid's public API and docs, found while the CPU formula was fixed. Nothing is released yet, so the API changed without a shim.

- The bake's `resolution` option was described as the probes along each axis, but the bake used it as the distance between probes. A docs example that asked for 24 probes along an axis got two. The option is now `spacing`, in meters, 2 by default, which is what the code always did. The grid starts at the box's least corner and takes as many probes as fit the box, at least two along each axis.
- `setLightProbeGrid`'s development check took only plain arrays for `origin`, `spacing` and `counts`, while the bake's grid holds typed arrays. The documented bake example therefore threw E1203. The setter now takes any three finite numbers, in an array or a typed array. A unit test runs the documented bake calls through the setter's check.
- The docs examples used a class that does not exist and an internal packing function, and set a new texture in every frame after the bake ended. They now use `LightProbeGridData` and set the grid once.

## Addendum, 15 October 2026: the bake's light scale, from the code review

The code review of 15 October 2026 (H-3, M-17, FEAT-15) found the bake's light on the wrong scale. The coordinator assigned the fixes to the same task.

- **Projection weight.** The Fibonacci directions cover the whole sphere, so each stands for 4 pi / N of solid angle. The bake used 2 pi / N, so an open surface lost half its sky light under a grid. A probe under a uniform sky now takes exactly the environment's own irradiance, and a unit test checks it.
- **Bounce.** A matte surface sends back albedo times its irradiance over pi. The bake took albedo times the irradiance, so a coloured wall bled pi times too much. A probe that matte walls of albedo 0.5 enclose now takes half the sky's irradiance, which a unit test checks.
- **The scene's environment.** The bake now reads the environment's nine coefficients, as the shader's `sh_irradiance` does, where it read four. It turns them by the environment's rotation and scales them by its intensity, from a new `environmentOptions` option. The bake cannot read them from the scene, so the sketch passes what `setEnvironment` got. The grid replaces the environment's diffuse light, which carries that rotation and intensity, so the bake must carry them too. A unit test turns a sky a quarter turn and doubles it.
- **The option's type.** `environment` took an object with an `sh` field, which the published types strip. It now takes an `Environment`.
- **Allocation.** The bake made a ray options object per probe and a view of the hit normal per hit. Both are now made once. The `albedo` callback's normal is one array reused from hit to hit.
- **What the bake leaves out.** The bake counts no lamps, and a hit's light sees the whole sky, with no occlusion of its own. The docs say so.

## Addendum, 15 October 2026: the grid becomes M3's global illumination

The owner ruled on 15 October 2026 ([D-179](D-179-technique-rulings-2026-10-15.md), rulings 12 and 13):

- **M3's global illumination is a leak-free probe volume on this grid.** Each probe gains a validity mask for the leaks that the normal offset cannot stop. A separate sky-occlusion term holds how much sky each probe sees. The live sky colour multiplies it, so time of day needs no new bake. Both were this record's "later" items. The grid's format for a grid baked elsewhere becomes a stable, documented format (hook H6 of [D-173](D-173-addon-hooks.md)).
- **Probe detail stays L1.** three.js's `LightProbeGrid` stores L2, and a port maps it onto this grid and lists the difference.
