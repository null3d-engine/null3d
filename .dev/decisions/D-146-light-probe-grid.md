# D-146: A grid of irradiance probes gives the scene local, coloured indirect light

Status: decided by the coordinator on 13 October 2026. It follows the owner's ruling [D-142](D-142-more-techniques-before-1-0.md) of 11 October 2026, which moved a light probe grid into M2. The figures this record needs follow as the task is built.

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

The grid's sampling sits in its own first-use templates, `probe_grid` and `probe_grid_maps`, so a page that sets no grid downloads none of it. The builds pass every download figure: the pipelined start is 159.6 KB after Brotli on WebGL2 and 145.7 KB on WebGPU against 160 KB, and the shaders' combination file is 54.7 KB uncompressed against 64 KB. The templates leave out the area lights, transmission, level of detail and weighted transparency bits, so a mesh with one of those features draws without grid light until those figures allow them.

## Consequences

- **Storage and memory:** 24 bytes per probe. A 24 x 8 x 24 grid (one probe per metre over a 24 m hall, 4,608 probes) takes 110 KB.
- **Frame group's bindings, an open question.** The lit shader's group 0 uses every binding below 16 on WebGL2. The only free one today is binding 3, where WebGPU keeps its split-sum table. WebGPU uses bindings 16 and 17 as well. M2-EX32 (reflection probes) takes binding 3 on both paths, after freeing it on WebGPU by moving the split-sum table into the materials' custom values texture. A probe grid texture therefore needs the coordinator's ruling on the frame group's layout. Options: free a slot for it, share M2-EX32's slot through one pump, or read the grid per object on the CPU. Godot's per-object rule costs no texture unit, but it no longer varies per pixel. The task asks for per pixel, so a slot must be freed. The cheapest slot to free is one of the two shadow uniforms. The cascades' block (binding 6) and the tiles' (binding 10) could become one block. That frees a binding on both paths and costs one upload.
- **WebGL2 texture units:** the grid is one more unit for the lit builds that read it, inside the 16 that D-142 names. The build counts a build's units and fails at 16.
- **Tests and size:** image references of a baked grid on the three GPU paths, and an allocation check of the bake and the frame. A download-size check proves that a page without a grid pays nothing.
- **Docs, mapping and skills:** a docs page, the three.js `LightProbeGrid` mapping entry, and the skill lines, with the showcase scenes able to set a grid.
- **Later:** the GPU bake over six capture views joins with M2-EX32's capture, and a validity mask for the strong leaks the normal offset cannot fix.

## Addendum, 15 October 2026: the CPU copy of the shader's formula

The engine keeps a CPU copy of the grid's irradiance formula (`l1Irradiance` and `sampleGrid` in `packages/engine/src/scene/light-probes.ts`), and the bake uses it for the light at a ray's hit. Its first version read only the first L1 coefficient and paired it with the normal's x. It never read the L1 coefficients along z and x. The unit test of that time set the first L1 coefficient and checked it against a normal along x, so it pinned the fault. The other tests compared the CPU grid sampling with the same CPU formula, so they could not see it.

The fix reads all four coefficients in the shader's order: L0, then L1 along y, z and x, as `probe_grid.wgsl` and `sh_irradiance` read them, and as the bake writes them. A unit test now compares the CPU result with the shader's formula for normals along each axis, both ways, and a diagonal. Each term and channel has its own value, so a swapped or missing term fails. The bake's light at a hit now calls the same function, so the formula lives once on the CPU. No shader or image changed: the GPU path was always right.
