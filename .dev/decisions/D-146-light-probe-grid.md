# D-146: A grid of irradiance probes gives the scene local, colored indirect light

Status: decided by the coordinator. It follows the owner's ruling [D-142](D-142-more-techniques-before-1-0.md), which moved a light probe grid into M2. Built: the grid is on main (`c309987b2`), and "Figures" holds its measurements. The grid is the base of M3's global illumination ([D-179](D-179-technique-rulings.md), rulings 12 and 13). Not built yet: the GPU bake, the validity mask and the sky-occlusion term.

Summary: A scene bakes a grid of L1 irradiance probes in the browser or loads one, and standard materials read it per pixel in three filtered reads. A normal offset controls leaks, and the grid replaces the environment's diffuse light, since the bake already holds the sky; the environment keeps its reflections. It costs near zero while no scene sets a grid, and M3's global illumination builds on it.

## Question

D-142 moved a light probe grid into M2 for the showcase scenes: colored bounce in Night town and light under Creek's trees. Without a grid, the engine lights every surface from one scene-wide environment. Indirect light that changes with a surface's place, and light bounced from colored walls or ground, need a grid of local samples. What should the grid hold, how is it baked, and how is it read?

## Data

The technique review compared eight engines ([the technique review](../technique-review.md#lighting-materials-and-environment-light)). It checked what each one stores and reads for a grid of local light:

| Engine | Storage | Reads per pixel | Baked |
| --- | --- | --- | --- |
| three.js `LightProbeGrid` | L2 SH in one RGBA16F 3D atlas of seven sub-volumes | 7 trilinear | on the GPU, six cube captures per probe |
| Bevy irradiance volumes | Ambient cube, 6 colors, in one 3D texture | 3 trilinear | offline (Blender) |
| Unity Adaptive Probe Volumes | L1 or L2 SH in 3D texture bricks, L1 normalized by L0 in 8 bits | 3 (L1) or 7 (L2) | offline |
| Godot `LightmapGI` | L2 SH per probe point, tetrahedral blending, read per object | 0 | offline |
| Wicked Engine DDGI | L1 SH per probe, depth moments for visibility | 8 probes by hand | every frame, ray traced |

The engine's constraints decide the shape. WebGL2 gives the lit fragment stage 16 texture units. D-142 keeps every new per-pixel input inside that count ("All probe grids share one 3D texture"). A page's start must not grow for a scene that sets no grid. The format must also filter in hardware on both paths.

## Decision

The coordinator chose the following, under D-142's ruling.

1. **L1 SH, one RGBA16F 3D texture.** Each probe holds four RGB coefficients, 12 floats, 24 bytes. Three sub-volumes stack along Z, each `nx * ny * (nz + 2)`: one padding slice at each end, so hardware trilinear filtering does not blend across sub-volumes. L1 needs three hardware-trilinear reads per pixel, half of L2's seven, which is what a phone budget takes (the table above). L1 keeps the light's direction, which a position-varying grid needs, where an ambient cube cannot hold a color above its six axes. Probe detail stays L1 for M3 too: three.js's `LightProbeGrid` stores L2, and a port maps it onto this grid and lists the difference.
2. **Sampling with a normal offset.** The sample point moves half a probe spacing along the surface normal, is clamped to the grid and remapped to texel centers, as three.js does. The normal offset is the whole of the leak control: a probe inside a wall cannot bleed its light onto the far side. The Ramamoorthi L1 constants, the first four terms of the engine's own `sh_irradiance`, evaluate the light.
3. **The grid replaces the environment's diffuse term.** An `environmentWeight` uniform (1 by default) takes the environment's diffuse light away where a grid is set, because the bake already counts the sky. The environment keeps its reflections. This matches Bevy and Godot, and it is why the bake does not double the sky.
4. **The bake runs in the browser.** The sketch worker casts Fibonacci-sphere directions from each probe with `scene.raycastBatch`. A ray that reaches the sky takes the environment's radiance. A ray that hits a surface takes the surface's color times the light already at the hit, so one bounce is colored. The caller gives an `albedo` function for its own scene, and gets the light back. Probes bake a few per frame, so a load screen can show progress. A scene may also hand the engine a grid baked elsewhere. "The bake" below gives the details.
5. **Shaders load on first use.** The sampling lives in a first-use shader set, so a page that sets no grid downloads and compiles none of it. A `quality.probeGrid` setting (0 on Low) turns the grid off on phones and keeps the field near zero while it is unused.

**Rejected.** L2 SH, because seven trilinear reads per pixel is a phone cost that the showcase scenes do not need. An ambient cube, because it cannot hold the direction of a bright patch and D-142 wants colored bounce. Baking only offline, because the showcase scenes are built in code and must bake in the browser. A GPU bake through six cube captures per probe (three.js's path) is the better long-term bake. It waits for the shared capture that M2-EX32 (reflection probes) adds. The ray-cast bake here is the first cut.

## The bake

- **Spacing.** The bake's `spacing` option is the distance between probes, in meters, 2 by default. The grid starts at the box's least corner and takes as many probes as fit the box, at least two along each axis.
- **Projection weight.** The Fibonacci directions cover the whole sphere, so each stands for 4 pi / N of solid angle. A probe under a uniform sky takes exactly the environment's own irradiance, and a unit test checks it. A weight of 2 pi / N would lose half an open surface's sky light under a grid.
- **Bounce.** A matte surface sends back albedo times its irradiance over pi. A probe that matte walls of albedo 0.5 enclose takes half the sky's irradiance, which a unit test checks. Without the division by pi, a colored wall would bleed pi times too much.
- **The scene's environment.** The bake reads the environment's nine coefficients, as the shader's `sh_irradiance` does. It turns them by the environment's rotation and scales them by its intensity, from the `environmentOptions` option. The bake cannot read them from the scene, so the sketch passes what `setEnvironment` got. The grid replaces the environment's diffuse light, which carries that rotation and intensity, so the bake must carry them too. A unit test turns a sky a quarter turn and doubles it.
- **The option's type.** `environment` takes an `Environment`. An object with an `sh` field would not work, since the published types strip that field.
- **The CPU copy of the shader's formula.** The engine keeps a CPU copy of the grid's irradiance formula (`l1Irradiance` and `sampleGrid` in `packages/engine/src/scene/light-probes.ts`). The bake calls it for the light at a ray's hit, so the formula lives once on the CPU. It reads all four coefficients in the shader's order: L0, then L1 along y, z and x. That is how `probe_grid.wgsl` and `sh_irradiance` read them, and how the bake writes them. A unit test compares the CPU result with the shader's formula for normals along each axis, both ways, and a diagonal. Each term and channel has its own value, so a swapped or missing term fails. A test that compares the CPU sampling with the same CPU formula cannot see a fault in the formula, so this test compares with the shader's.
- **Allocation.** The bake makes its ray options object and its view of the hit normal once. The `albedo` callback's normal is one array reused from hit to hit.
- **When it runs.** The bake runs in the setup, before the first frame. Hold mode runs the sketch's update up to the held time, but it draws one frame, so a bake that finishes in a later frame can miss the held picture. A grid that a later frame sets also waits for its own shader builds.
- **What the bake leaves out.** The bake counts no lamps, and a hit's light sees the whole sky, with no occlusion of its own. The docs say so.

## The grid in the frame

- **Setting a grid.** `setLightProbeGrid` takes `origin`, `spacing` and `counts` as any three finite numbers, in an array or a typed array, since the bake's grid holds typed arrays. A unit test runs the documented bake calls through the setter's check. The docs examples use `LightProbeGridData` and set the grid once.
- **The texture.** The frame groups bind binding 10 as a 3D texture. `LightProbeGridData.toTexture` makes a 3D `rgba16float` texture through `textures.fromVolumeData`. `scene.setLightProbeGrid` refuses a texture that is not a volume, with code E1222, because a frame cannot bind a 2D texture array there. A Rust test builds a frame with a grid, and one with an array in its place, on both frame builders.
- **The sampled place.** The lit shader adds the camera's own world position once. A view that is not the camera, such as a mirror's, then reads probes at its own place. Adding the view's offset twice would read probes at twice the view's distance from the eye: 3.4 m for a mirror 1.7 m below.
- **A spacing of 0.** On an axis with no spacing, the sample point moves by nothing, so the shader never divides by an inverse of 0.
- **A grid at intensity 0.** The shader reads whether a grid is set from the grid values' fourth number, which the frame writes when a scene sets one. A grid at intensity 0 then gives the grid's share of the environment's light, which is none of its own. Reading the presence from the intensity would give the environment's full light instead.
- **The switch's frame.** A live 3D texture turns probe shading on. The frame's values name no grid until its texels are up, so until then a grid build reads the environment's light exactly as the plain build does. A switch that waits for the texels to be on the GPU comes two frames late, because a frame decides it before its own texture work uploads them. A held frame and `engine.captureFrame` never reach those frames, so the grid would draw nothing in its own image test. A Rust test covers a grid that the setup sets before the first frame, on both frame builders.

## Figures

Freeing binding 10 for the grid moves no measured page. `bun run bench:gpu-check` compared the branch with main at 120 Hz, with one dropped run. GPU time per frame changed by +0.3% in S4 at Medium and by -2.2% in S6 at Medium. It changed by +6.6% in S4 at High and by -2.0% in S6 at High. Each change is well inside its rule's limits.

The grid's sampling sits in its own first-use templates, `probe_grid` and `probe_grid_maps`, so a page that sets no grid downloads none of it. The builds pass every download figure: the pipelined start is 159.6 KB after Brotli on WebGL2 and 145.7 KB on WebGPU against 160 KB, and the shaders' combination file is 54.7 KB uncompressed against 64 KB. The templates leave out the area lights, transmission, level of detail fade, weighted transparency and coat and sheen bits, so a mesh with one of those features draws without grid light until those figures allow them. `ProbeShading` keeps such a pair on its plain template (the mask is checked against the templates' lists by a unit test in `probe_shading.rs`).

## Tests, first-use entry and switches

- **Image tests.** `probe-grid`, `probe-grid-off` and `probe-grid-mirror` draw a room with a red wall at the left and a green wall at the right, with three gray spheres. The sketch bakes the grid in the browser. The first image shows the spheres taking red light at the left and green at the right. The second draws the same room with no grid. The third lays a mirror on the floor, whose reflection pass reads the grid at each reflected sphere's own place. Without them, a grid that lights nothing passes every other test.
- **First-use entry.** The manifest's `[first_use.probe_grid]` table names the grid's builds. The generated first-use page lists the feature, and the first-use test covers its download on both paths.
- **Allocation switch.** `bench/allocation.ts` takes `--probes`, which sets a small grid over S1's swarm, so the allocation sample covers the lit draws' grid reads on both GPU paths.
- **Docs.** [Lighting](../../docs/concepts/lighting.md) has a "Light probe grid" section: what takes its light, its limits, its cost and its first-use loading. The scene page links to it.

## M3's global illumination

The owner ruled on the grid's place in M3 ([D-179](D-179-technique-rulings.md), rulings 12 and 13):

- **M3's global illumination is a leak-free probe volume on this grid.** Each probe gains a validity mask for the leaks that the normal offset cannot stop. A separate sky-occlusion term holds how much sky each probe sees. The live sky color multiplies it, so time of day needs no new bake. A grid baked elsewhere loads from a stable, documented format (hook H6 of [D-173](D-173-addon-hooks.md)), which [D-243](D-243-baked-light-format.md) defines.
- **Probe detail stays L1**, as decision 1 says.

## Consequences

- **Storage and memory:** 24 bytes per probe. A 24 x 8 x 24 grid (one probe per meter over a 24 m hall, 4,608 probes) takes 110 KB.
- **Frame group's bindings.** The lit shader's group 0 uses every binding below 16 on WebGL2, and M2-EX32 (reflection probes) takes binding 3 on both paths. A per-pixel grid needs a slot of its own, since Godot's per-object rule costs no texture unit but does not vary per pixel. The cascades' block and the tiles' block are one block at binding 6, which leaves binding 10 free for the grid on both paths and costs one upload ("Figures").
- **WebGL2 texture units:** the grid is one more unit for the lit builds that read it, inside the 16 that D-142 names. The build counts a build's units and fails at 16.
- **Tests and size:** image references of a baked grid on the three GPU paths, and an allocation check of the bake and the frame. A download-size check proves that a page without a grid pays nothing.
- **Docs, mapping and skills:** a docs page, the three.js `LightProbeGrid` mapping entry, and the skill lines, with the showcase scenes able to set a grid.
- **Pending:** the GPU bake over six capture views joins with M2-EX32's capture. The validity mask and the sky-occlusion term come with M3's global illumination.
