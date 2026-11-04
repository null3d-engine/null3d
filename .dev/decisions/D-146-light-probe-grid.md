# D-146: A grid of irradiance probes gives the scene local, colored indirect light

Status: decided by the coordinator. It follows the owner's ruling [D-142](D-142-more-techniques-before-1-0.md), which moved a light probe grid into M2. Built: the grid is on main (`c309987b2`), and "Figures" holds its measurements. The grid is the base of M3's global illumination ([D-179](D-179-technique-rulings.md), rulings 12 and 13), and M3-F1 adds its validity mask and its sky-occlusion term. Not built yet: the GPU bake.

Summary: A scene bakes a grid of L1 irradiance probes in the browser or loads one, and standard materials read it per pixel in four filtered reads. The probes hold the bounce that the scene's surfaces send back, the share of the sky each probe sees, and whether geometry encloses it. A normal offset and a validity mask control leaks, and the live environment's light multiplies each probe's sky visibility, weighted by how much the surface faces the sky, so time of day needs no new bake. The grid replaces the environment's diffuse light; the environment keeps its reflections. It costs near zero while no scene sets a grid, and M3's global illumination builds on it.

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

1. **L1 SH, one RGBA16F 3D texture.** Each probe holds four RGB coefficients, 12 floats, and two masks: 32 bytes. Four sub-volumes stack along Z, each `nx * ny * (nz + 2)`: one padding slice at each end, so hardware trilinear filtering does not blend across sub-volumes. The first three hold the coefficients and the fourth holds the validity and the sky visibility. L1 needs three filtered reads of coefficients per pixel, half of L2's seven, which is what a phone budget takes (the table above). L1 keeps the light's direction, which a position-varying grid needs, where an ambient cube cannot hold a color above its six axes. Probe detail stays L1 for M3 too: three.js's `LightProbeGrid` stores L2, and a port maps it onto this grid and lists the difference.
2. **Leak control in two parts.** The sample point moves half a probe spacing along the surface normal, is clamped to the grid and remapped to texel centers, as three.js does. That stops a flat wall's leak. For the leaks it cannot stop, each probe holds a validity: the bake tests both faces of every triangle, so a ray that starts inside a wall meets the wall's back, and a probe that most rays enter from behind takes validity 0. Its light is filled from the probes around it so the filter stays smooth, and the shader weights the whole grid light by the interpolated validity, so a wall's probe cannot bleed. The Ramamoorthi L1 constants, the first four terms of the engine's own `sh_irradiance`, evaluate the light.
3. **The grid replaces the environment's diffuse term, and the sky stays live.** An `environmentWeight` uniform (1 by default) takes the environment's diffuse light away where a grid is set. The probes' coefficients hold only the bounce that surfaces send back. Their sky visibility multiplies the environment's live diffuse irradiance at draw time, weighted by how much the surface faces the sky above the horizon, so a time-of-day change, a turn of the environment or a new intensity needs no new bake. The environment keeps its reflections. The setting keeps its meaning: a grid fades out at an intensity of 0, and the environment does not come back.
4. **The bake runs in the browser.** The sketch worker casts Fibonacci-sphere directions from each probe with `scene.raycastBatch`, testing both faces. A ray that reaches the sky counts toward the probe's sky visibility. A ray that meets a surface's back counts toward enclosure. A ray that meets a surface's front takes the surface's color times the light already at the hit, so one bounce is colored. The caller gives an `albedo` function for its own scene, and gets the light back. Probes bake a few per frame, so a load screen can show progress. A scene may also hand the engine a grid baked elsewhere. "The bake" below gives the details.
5. **Shaders load on first use.** The sampling lives in a first-use shader set, so a page that sets no grid downloads and compiles none of it. A `quality.probeGrid` setting (0 on Low) turns the grid off on phones and keeps the field near zero while it is unused.

**Rejected.** L2 SH, because seven trilinear reads per pixel is a phone cost that the showcase scenes do not need. An ambient cube, because it cannot hold the direction of a bright patch and D-142 wants colored bounce. Baking only offline, because the showcase scenes are built in code and must bake in the browser. A GPU bake through six cube captures per probe (three.js's path) is the better long-term bake. It waits for the shared capture that M2-EX32 (reflection probes) adds. The ray-cast bake here is the first cut.

## The bake

- **Spacing.** The bake's `spacing` option is the distance between probes, in meters, 2 by default. The grid starts at the box's least corner and takes as many probes as fit the box, at least two along each axis.
- **Sky visibility.** The Fibonacci directions cover the whole sphere, so each stands for 4 pi / N of solid angle. A probe whose rays all reach the sky takes a sky visibility of 1, and the shader's live sky term gives it exactly the environment's irradiance. A probe in a room keeps the share of the directions that reach past the room's walls. That share counts the whole sphere, where the environment's irradiance covers the hemisphere around the surface normal. So the shader weights it by the surface's tilt toward the sky above the horizon: a surface that faces the sky takes twice the share, a vertical one takes it as it stands, and one that faces away takes none. The weight fades as the share approaches 1, so a probe that sees the whole sphere still gives every normal the environment's own light. Without the weight a floor under an open sky takes half its sky light, and the room darkens by about a third. The bake keeps the sky out of the coefficients, so an environment that turns or dims lights the grid again with no new bake.
- **Bounce.** A matte surface sends back albedo times its irradiance over pi. A probe that matte walls of albedo 0.5 enclose takes half the bounce of the sky's irradiance, which a unit test checks. Without the division by pi, a colored wall would bleed pi times too much.
- **Enclosure and the fill.** The bake tests both faces of every triangle. A ray that meets a surface's back came from inside that surface, so a probe that most rays enter from behind takes validity 0. Other probes take 1. The bake then fills each probe with validity 0 from the probes that it reaches, breadth first, so the filter around a wall stays smooth. Its validity stays 0, so its light never reaches a surface. A unit test puts a probe inside a slab and checks both the mask and the fill.
- **The scene's environment.** The bake reads the environment's nine coefficients, as the shader's `sh_irradiance` does. It turns them by the environment's rotation and scales them by its intensity, from the `environmentOptions` option. The bake cannot read them from the scene, so the sketch passes what `setEnvironment` got: the bounce sees that environment. The live sky term reads the scene's current environment instead, so the two may differ when the hour changes after the bake. A unit test turns a bounce a quarter turn and doubles it.
- **The option's type.** `environment` takes an `Environment`. An object with an `sh` field would not work, since the published types strip that field.
- **The CPU copy of the shader's formula.** The engine keeps a CPU copy of the grid's irradiance formula (`l1Irradiance` and `sampleGrid` in `packages/engine/src/scene/light-probes.ts`). The bake calls it for the light at a ray's hit, so the formula lives once on the CPU. It reads all four coefficients in the shader's order: L0, then L1 along y, z and x, then the validity and the sky visibility. `sampleGrid` weights the light by the interpolated validity and returns the sky's share beside it, weighted by the same validity and by the surface's tilt toward the sky, as the shader does. A unit test compares the CPU result with the shader's formula for normals along each axis, both ways, and a diagonal. Each term and channel has its own value, so a swapped or missing term fails. A test that compares the CPU sampling with the same CPU formula cannot see a fault in the formula, so this test compares with the shader's.
- **Allocation.** The bake makes its ray options object, its view of the hit normal and its ray mask once. The `albedo` callback's normal is one array reused from hit to hit. The flood fill runs once, when the last probe is baked.
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

### M3-F1's cost

`bun run bench:gpu-check` compared this branch with main's merge base at 120 Hz, with three runs of each build and 4 s warm-up and measured each. It judged no page: the benchmark pages differ between the two commits, which includes the milestone branch's own page changes before this work, so its per-page figures do not measure the grid alone. It printed `GPU-Checked: 9369b1380..d264370f3 not judged: s4 medium 4.13 to 5.14 ms (+14.7%, same, noise 11.4%); s6 medium 4.91 to 4.93 ms (+4.3%, same, noise 1.5%); s4 high 4.39 to 4.97 ms (+13.1%, same, noise 6.9%); s6 high 10.60 to 11.99 ms (+13.0%, same, noise 12.8%); the benchmark pages changed between the commits`.

**The phone figure.** M3-F1's clause names the cloud Pixel 9 with WebGL2 forced, so that is the path that answers it. The `probe-cost` plan runs the effect cost page there (Google Pixel 9, Android 17.0, Chrome 152.0.7977.54), at render scale 1 and a pixel ratio of 2, so the drawing buffer is 823 x 1506. The page draws a room of boxes under 2,048 stacked lit slabs, with the grid off and on in turns, three two-second rounds each.

- **WebGL2, the clause's path, reported by the page as `webgl2`: a bound, not a measurement.** This path gives the page no GPU timer, so the finest step it can show is the display's frame of 16.7 ms. The frame interval was 33.4 ms (two display frames) on both sides in every round, 33.415 ms without the grid and 33.405 ms with it across six windows. The grid's added work did not move the interval across that step over 2,048 layers, so its cost is **at most 16.7 / 2,048 = 0.008 ms per lit screen, at a resolution of 16.7 ms**. The busiest thread's CPU time rose from 1.63 to 2.50 ms.
- **WebGPU on the same phone and page, as support and not as the clause's path.** The engine has a GPU timer there, whose step is 0.0655 ms: the GPU time per frame rose from 36.57 to 48.04 ms over the 2,048 layers, so **0.0056 ms per lit screen, within about 0.003 ms**, and the interval rose from 33.4 to 50.0 ms.

Both are inside 0.3 ms by a wide margin. The clause is answered by the WebGL2 bound, because that is the path it names; the WebGPU figure stands beside it for support. A reader must not take the 0.0056 ms as WebGL2's own figure.

The runs are `target/runs/20261103-003818-probe-cost` on WebGL2 and `target/runs/20261103-004034-probe-cost` on WebGPU. The memory holds: 32 bytes of data per probe, so a 24 x 8 x 24 grid takes 157 KB.

## Tests, first-use entry and switches

- **Image tests.** `probe-grid`, `probe-grid-off` and `probe-grid-mirror` draw a room with a red wall at the left and a green wall at the right, with three gray spheres. The sketch bakes the grid in the browser. The first image shows the spheres taking red light at the left and green at the right. The second draws the same room with no grid. The third lays a mirror on the floor, whose reflection pass reads the grid at each reflected sphere's own place. `probe-grid-wall` adds a partition thick enough to hold a row of probes, whose light the validity mask stops, and `probe-grid-wall-night` turns the environment after the bake, which lights the grid again with no new bake. Without them, a grid that lights nothing, or one that leaks, passes every other test.
- **First-use entry.** The manifest's `[first_use.probe_grid]` table names the grid's builds. The generated first-use page lists the feature, and the first-use test covers its download on both paths.
- **Allocation switch.** `bench/allocation.ts` takes `--probes`, which sets a small grid over S1's swarm, so the allocation sample covers the lit draws' grid reads on both GPU paths.
- **Docs.** [Lighting](../../docs/concepts/lighting.md) has a "Light probe grid" section: what takes its light, its limits, its cost and its first-use loading. The scene page links to it.

## M3's global illumination

The owner ruled on the grid's place in M3 ([D-179](D-179-technique-rulings.md), rulings 12 and 13), and M3-F1 builds both items:

- **M3's global illumination is a leak-free probe volume on this grid.** Each probe holds a validity mask for the leaks that the normal offset cannot stop, and a sky-occlusion term for how much sky it sees. The live sky color multiplies that term, so time of day needs no new bake. A grid baked elsewhere loads from a stable, documented format (hook H6 of [D-173](D-173-addon-hooks.md)), which [D-243](D-243-baked-light-format.md) defines.
- **Probe detail stays L1**, as decision 1 says.

## Consequences

- **Storage and memory:** 32 bytes per probe. A 24 x 8 x 24 grid (one probe per meter over a 24 m hall, 4,608 probes) takes 157 KB.
- **Frame group's bindings.** The lit shader's group 0 uses every binding below 16 on WebGL2, and M2-EX32 (reflection probes) takes binding 3 on both paths. A per-pixel grid needs a slot of its own, since Godot's per-object rule costs no texture unit but does not vary per pixel. The cascades' block and the tiles' block are one block at binding 6, which leaves binding 10 free for the grid on both paths and costs one upload ("Figures").
- **WebGL2 texture units:** the grid is one more unit for the lit builds that read it, inside the 16 that D-142 names. The build counts a build's units and fails at 16.
- **Tests and size:** image references of a baked grid on the three GPU paths, and an allocation check of the bake and the frame. A download-size check proves that a page without a grid pays nothing.
- **Docs, mapping and skills:** a docs page, the three.js `LightProbeGrid` mapping entry, and the skill lines, with the showcase scenes able to set a grid.
- **Pending:** the GPU bake over six capture views joins with M2-EX32's capture.
