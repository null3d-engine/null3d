# D-41: Software occlusion culling on WebGL2

Status: decided for the method, 2026-10-04; the preset rows wait for T-36 on the S24+ and the iPad (M2-I3, D-22). Task: M2-I2.

## Question

WebGL2 has no compute shaders, so the GPU cannot test objects against a depth pyramid as WebGPU's two-phase culling does. The job workers already cull every object against the frustum. How should they also skip the objects that other objects hide, and at what cost?

The question has five parts:

1. The method: what the job workers draw, and how they test objects against it.
2. How the test stays safe: it must never hide an object that shows on the screen.
3. Which objects block the view, and which frame's positions they use.
4. The buffer's size, and how the work spreads over the job workers.
5. Which presets turn it on.

## Rule

- The buffer never hides an object that a full-resolution depth buffer shows. A randomized Rust test checks this against a plain depth buffer at four times the resolution.
- It adds no GPU delay: no readback, and no object that shows a frame late.
- Frames allocate nothing once the blockers stop growing, on the calling thread and the job workers.
- A preset turns it on only where it saves more frame time than it costs, with the popping check of M2-I3. T-36 measures that on the S24+ and the iPad, and D-22 holds the result.

## The method

The engine follows Intel's masked software occlusion culling (Hasselgren, Andersson and Akenine-Möller, 2016). Each frame, for the camera's view:

1. The calling thread picks the blockers: objects with the occluder flag that are shown, on the view's layers and inside its frustum. A blocker must be at least 2 buffer pixels in radius. The thread sorts them nearest first, and stops at 16,384 triangles.
2. The job workers move each blocker's corners into clip space, four at a time with SIMD. They clip its triangles at the near plane, set each one up in 64-bit floats, and list the blocker's outline edges.
3. The buffer is about 256 x 144 pixels, in subtiles of 8 x 4 pixels. Each band of 16 pixel rows is one job, so no two threads write one subtile. A band draws every blocker that reaches it, nearest first.
4. Each subtile keeps two layers: a depth that covers it whole, and a working layer of a 32-bit coverage mask and its farthest depth. A blocker's coverage joins the working layer, and a full mask makes that layer's depth the whole subtile's. Coverage far behind the working layer starts a new one, as Intel's merge does. Four subtiles merge at a time, with SIMD.
5. After the frustum test, culling tests each object's bounding sphere, four at a time with SIMD. It projects the sphere to a box on the screen and to its nearest depth. The object is hidden when every subtile under the box is covered nearer than that depth. Blocks of 4 x 4 subtiles keep their farthest depth, so a large box is tested a block at a time.

Depth is clip-space z over w. It is 1 at the near plane and smaller farther away, and it is affine across the screen for both kinds of lens. So one plane per triangle gives its depth anywhere, and one test serves perspective and orthographic cameras.

### Never hiding what shows

Intel's method tests each pixel at its center. Say a blocker covers a pixel's center but not its whole square. It would then hide an object that shows in a sliver beside the blocker, or through a gap narrower than a pixel. The engine's rule forbids that, so each blocker draws on its own into a band's scratch mask first:

- Its triangles cover the pixels whose centers they hold. Neighbouring triangles share edges, so the blocker's surface has no cracks.
- Then the band clears every pixel whose square an outline edge touches. The outline runs where a drawn triangle meets an undrawn one, and where two triangles fold onto one side of their edge. Open edges belong to it, and so do the lines where the near plane cuts the blocker. A pixel whose center lies inside and whose square no outline crosses lies wholly inside the blocker.
- Each subtile's depth is the farthest depth, over the subtile, of each triangle that touches it, but no farther than the triangle's own farthest corner.
- A closed mesh draws only the triangles that face the camera. Their union is the whole shape's outline, and the far side never sets a depth. An open mesh draws the faces that its material draws: front faces, or both for a double-sided material. Faces follow the GPU's rule, the sign of the triangle's homogeneous determinant, so a mirrored object blocks with the faces that the GPU draws.
- Rounding moves every depth away from the camera, and every object's depth toward it.

Two cheaper rules were tried on paper and rejected:

- Pixel centers alone, as Intel's method does. It hides objects that show in slivers.
- Shrinking each triangle by half a pixel on every side. It leaves a line of uncovered pixels along every shared edge, such as a box face's diagonal. A subtile that the line crosses never fills, so it hides nothing.

### Same frame, no readback

The blockers use the frame's own camera and world matrices. So an object shows in the same frame that it comes into view, and nothing pops. WebGL2's occlusion queries were rejected: their answers arrive frames later, which makes objects pop in late. Reusing the previous frame's depth would pop too.

### Which objects block

- `setOccluder(true)`, or the `occluder` option of `createMesh` and `instantiate`, sets the object flag `OCCLUDER` (1 << 7). It is not structural, so a change needs no rebuild of the draw tables. The asset tool will set it for meshes that get blocker meshes (M2-B4), and `setOccluder` overrides that.
- A blocker draws its own mesh, welded where corners share a position, up to 4,096 triangles. The mesh is built once, the first time an object with that mesh blocks. The asset tool's simplified blocker meshes will replace it for large models (M2-B4).
- Objects that blend, cut holes with an alpha mask, skip the depth buffer, use a custom material or are skinned never block. Their drawn shape can have gaps that their mesh does not show.
- Only the active camera's view uses blockers. Shadow cascades, shadow tiles and other views cull as before, so a hidden object still casts its shadow. Blended objects of the transparent pass are tested too.

### Spreading the work

A band whose subtiles already hold depths nearer than all of a blocker skips that blocker. The merge would discard all its coverage anyway, so the skip changes nothing. Blockers draw nearest first, so in a street the far buildings mostly skip. In the benchmark below, the pairs of band and blocker that drew fell from about 139 to 60 per frame.

Triangle setup runs in 64-bit floats. A wall beside the camera reaches far past the screen's edges once the near plane cuts it. 64-bit setup keeps its edges exact there, with no clipping at the screen's sides.

## Data

### Never hiding what shows

`crates/null3d-core/tests/occlusion.rs` builds 12 random scenes of 10 to 41 blockers each. They are closed boxes, closed L-shaped prisms and open folded sheets on one face or both. Some are mirrored, and some walls pass beside the camera through the near plane. It tests 400 spheres per scene against the masked buffer and against a plain depth buffer at four times its resolution in each direction. Of 4,800 spheres, the plain buffer hides 3,451. The masked buffer hides 2,283 of those, 66%, and no other sphere. The job workers draw the same buffer, to the bit, as one thread.

### Cost natively

`bench_software_occlusion` in `crates/null3d-core/tests/bench.rs`: a city of buildings 20 m wide on a 30 m grid, 12 to 60 m high, and 20,000 spheres along the streets. A camera 2 m up flies down the middle street and turns its head. MacBook Pro, release build, 1280 x 720, at load averages of 7 to 20 while other helpers built:

| Buildings | Threads | Drawing, median | 20,000 sphere tests, one thread | Spheres hidden |
| --- | --- | --- | --- | --- |
| 64 | 1 | 49 µs | 153 µs | 39% |
| 64 | 4 | 34 µs | 151 µs | 39% |
| 256 | 1 | 104 µs | 154 µs | 49% |
| 256 | 4 | 61 µs | 153 µs | 49% |

The hidden share counts every sphere, also those outside the view. Testing a sphere costs about 7.6 ns, four at a time; one at a time it cost 13.5 ns.

Three changes made the drawing about 2.6 times faster than the first version, which took 127 µs for 64 buildings on one thread:

- Bands skip blockers that lie wholly behind what they hold, which halved the band work.
- Each row of subtiles finds the run of subtiles that a triangle touches from the triangle's corners, instead of testing every subtile in its box.
- The depth of four subtiles at a time, with SIMD.

### Cost and saving in the browser

The occlusion cost page (`tests/pages/occlusion-cost.html`) draws a city of 64 buildings, 3,000 spheres and 20,000 boxes in a static batch, at 1280 x 720 on WebGL2. Chrome 154 on the Mac's GPU, headless, four rounds of 2 s per side in turns. The figures are medians per frame:

| Measure | Culling off | Culling on |
| --- | --- | --- |
| Index list entries drawn | 1,176 | 344 |
| Entries hidden | 0 | 627 |
| Busiest thread, the sketch worker | 0.22 ms | 0.33 ms |
| Its culling step | 0.03 ms | 0.17 ms |
| Job workers, together | 0 ms | 0.07 ms |
| Render worker | 0.07 ms | 0.07 ms |
| Every thread, together | 0.31 ms | 0.65 ms |

The culling hides about two thirds of what the frustum test keeps, for about 0.35 ms more CPU time per frame on the Mac. WebGL2 has no GPU timer in this browser, so the GPU time that the hidden objects save is not measured here. The Mac's GPU draws the city in far less than a frame either way. The saving matters on phones, where T-36 measures it.

Where nothing blocks, the culling costs one pass over the scene's flags per frame. The command below ran main (a8bf5ed) and this branch in turns, at the Medium preset, where the culling is on. It was `bun run bench:run --compare <main>,. --scenes s1,s1-cells,s3 --pages null3d-webgl2 --runs 3 --seconds 10`:

| Scene | Busiest thread, main | This branch | Change |
| --- | --- | --- | --- |
| S1 | 4.340 ms | 4.355 ms | -0.9%, same |
| S1-cells | 0.100 ms | 0.095 ms | -5.0%, same |
| S3 | 0.250 ms | 0.255 ms | +2.0%, same |

### Size

The core's WebAssembly grows by about 15 KB after Brotli, from 221 KB to 236 KB of its 600 KB budget (+6.9%). Most of it is the band drawing, the blockers' setup and the sphere test. Two changes kept it from growing 30 KB:

- The blockers' sort and the edges' sort reuse the 32-bit radix sort of the cluster code, instead of two sorts of their own. Building a blocker mesh welds its corners with a small hash table of its own, instead of the standard library's.
- The 64-bit `clamp` of the standard library carries a panic message that prints floats, which linked about 20 KB of float printing. The band code bounds its values with `max` and `min` instead.

How the data was produced: `cargo test -p null3d-core --release --test occlusion -- --nocapture`, `cargo test -p null3d-core --release --test bench -- --ignored --nocapture --test-threads=1 bench_software_occlusion`, and `NULL3D_PORT=10273 bun run test occlusion.spec.ts` in `tests/`, on 4 October 2026, with `bun run build:check-size` for the sizes.

### Images

The image tests `occlusion-off` and `occlusion-on` draw a lighter city in hold mode. With the culling on, WebGL2 draws the same image to the bit as with it off, on the Mac's GPU and on SwiftShader.

## Decision

Build masked software occlusion culling on the job workers, with the conservative coverage above, for the camera's view on WebGL2. The `softwareOcclusion` setting turns it on and off during play, and the `?occlusion=on|off` switch and the `softwareOcclusion` option of `createEngine` set it for a page. It starts on from Medium up, the value proposed before any measurement, until T-36 measures it on the S24+ and the iPad. A scene without blockers pays only one pass over the scene's flags per frame.

three.js has no occlusion culling in its core; it culls each object against the frustum alone. Babylon.js offers occlusion queries per mesh, whose answers arrive frames later.

## Consequences

- `crates/null3d-core/src/occlusion.rs` holds the buffer, the blocker meshes and the test. `culling::cull_into_buckets` and the transparent pass's sort take the buffer through `CullView`. The WebGL2 frame builder picks the blockers (`crates/null3d-render/src/occlusion.rs`).
- `engine.measure` reports `occludedEntries`, a new counter of the frame record, which grows from 20 to 21 words.
- The docs: `concepts/culling` (the method and its limits), `api/objects` (`setOccluder`), `guides/performance` (blockers and the new figure), and the preset table. The develop skill's quick reference lists `setOccluder`.
- The device runner's `occlusion` plan runs the cost page, for T-36 (M2-I3). M2-B4 adds blocker meshes from the asset tool, and S6 (M2-L3) uses them.
