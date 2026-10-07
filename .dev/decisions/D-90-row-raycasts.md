# D-90: Raycasts against sprite, point and line rows

Status: decided. Date: 2026-10-07. Task: M2-D7.

Summary: A ray hits what each row draws: a sprite's quad as three.js's `Sprite`, a point's square, and a line within half its width as `Line2`. The `pointThreshold` and `lineThreshold` options give three.js's `Points` and `Line` tests, with no default. Rows sized in pixels use the active camera, or the camera of the event's frame. A raycast grows the trees' boxes by its reach only when its layers hold such rows.

## Question

What should a raycast hit of a sprite, a point and a line, and how do three.js's `Raycaster.params.Points.threshold` and `Raycaster.params.Line.threshold` map onto that? Rows sized in pixels of the screen have no size in the world, so how do the scene's trees find them?

## Rule

- Queries are strict under [D-52](D-52-intent-parity.md): where null3D and three.js draw the same thing, a ray hits what three.js's `Raycaster` hits, at the same distance.
- A pointer event lands on what the user sees.
- A raycast against meshes alone costs no more than before.
- The rows use the same tree walks as meshes, so the mask of empty child slots covers them.

## Data

three.js tests each kind in its own way:

| three.js object | What its raycast hits | Needs `raycaster.camera` |
| --- | --- | --- |
| `Sprite` | The quad in the camera's image plane, at the sprite's depth, with its center and rotation | Yes |
| `Points` | A point that the ray passes within `params.Points.threshold` of, 1 m by default, whatever its size | No |
| `Line`, `LineSegments`, `LineLoop` | A segment that the ray passes within `params.Line.threshold` of, 1 m by default, whatever its width | No |
| `Line2`, `LineSegments2` with `worldUnits` | A segment that the ray passes within half the width of | No |
| `Line2`, `LineSegments2` in pixels | A segment whose projection lies within half the width of the ray's point on the screen | Yes |

null3D draws a sprite as three.js draws a `Sprite`, a point as a square of its size, and every line as `Line2` draws it ([D-46](D-46-wide-lines.md)).

The engine's tests check the choice:

- `crates/null3d-core/src/bvh/rows.rs`: each test against hand-made answers, and the pixel test against the projection on the screen for 4,000 rays from the camera.
- `crates/null3d-core/tests/row_queries.rs`: raycasts through the trees against testing every row in turn. The scene lies near the origin and at the Earth's radius. The cameras are perspective and orthographic, and the rays run with and without thresholds and a camera. Every raycast, raycastAny, raycastAll and batch of rays gave brute force's hits.
- `tests/image/raycast-rows.spec.ts`, on WebGPU, compatibility mode and WebGL2 in Chrome. 800 rays from the camera run against three.js 0.186's `Sprite`, `Line2` and `LineSegments2`. 800 rays from anywhere, with both thresholds, run against its `Points`, `Line`, `LineSegments` and `LineLoop`. Then a ray through each pixel of a frame, read back through the engine, must hit the row that the pixel shows.

What the tests found, and what changed for it:

- Rays that start far from a line. three.js's `Ray.distanceSqToSegment` adds up terms as large as the squared distance from the ray's start to the segment. For a ray that starts 6,378 km from a line, those terms are about 4 × 10^13 m². Their sum then loses about 0.01 m² in 64-bit floats. That is more than a thin line's squared half width, so rays hit lines they pass a meter from. The engine finds the closest points as three.js does, then measures the squared distance between those two points. `row_queries.rs` caught the false hits.
- Pixels where two rows overlap. The pixel check found two pixels, one on compatibility mode and one on WebGL2. Each showed a line where the ray hit a point sized in pixels. Both rows lay at almost the same depth there. The GPU gives a line the depth of its end point. A ray's hit near a line is the ray's closest point. So either row can win. The test allows up to 3 such pixels. It allows no pixel where the frame shows a row and the ray hits none. Nor does it allow one where the ray hits a row that the frame does not show.
- Size. The first build grew each engine WebAssembly file by 4.6% after Brotli, 13.7 KB. A `twiggy diff` of builds with function names showed the cause. About 17 KB of the growth before Brotli was the code that formats floats. It came from `f64::clamp` with bounds that are not constants: its check that the bounds are in order panics with a message that prints them. `max` and `min` give the same result with no message. The reach code also stays out of line, so each tree walk calls one copy. The files then grew 1.4% to 1.5%.

How the data was produced: `cargo test -p null3d-core --lib bvh::rows`, `cargo test -p null3d-core --test row_queries`, and `bunx playwright test raycast-rows.spec.ts` on each GPU set, on 7 October 2026.

## Decision

A ray hits what each row draws:

- A sprite: its quad, as three.js's `Sprite`.
- A point: its square, which is the quad of a sprite of the point's size. three.js has no test for what a point draws, so null3D uses the sprite's.
- A line: within half its width, as `Line2`, in world units or in pixels.

Two options give three.js's thresholds: `pointThreshold` and `lineThreshold`, in meters. With one, a ray hits a point or a segment within that distance, whatever its size, as `Points` and `Line` do. They have no default. three.js's default is 1 m, whatever the sizes. In a cloud of small points or a dense graph of lines, rays would then hit far from what draws. A click would land on a row that the user did not point at. A port that relies on three.js's default passes 1.

Hits near a point or a line are the ray's closest point, at its distance along the ray, as three.js gives them. three.js's `Line2` and `LineSegments2` ignore `raycaster.far`, so they report hits past it. null3D's `maxDistance` limits every hit, lines too, as three.js's other objects keep `far`. The row test in the browser drops three.js's line hits past `far` before it compares. The normal points back along the ray, and a quad's faces the camera. The triangle is -1.

Sprites face the camera, and sizes in pixels depend on it. Raycasts take the active camera as it stands. A pointer event's ray takes the camera of the frame on screen at the event. Without a camera, rays miss the rows that need one. A width in pixels tests the ray at the depth of each point of the segment. There the ray must pass within half the width, in pixels at that depth. For a ray from the camera, this is `Line2`'s test on the screen. For any other ray it still has a meaning. The test is a quadratic along the segment, which the core solves exactly. Rows sized in pixels are hit only between the camera's near and far planes.

The trees hold every row in use. A sprite sized in world units keeps the sphere that culling gives it. A segment keeps its box, grown by half a width in world units. A row sized in pixels, or reached by a threshold, has a box that holds only its anchor or its center line. A raycast then grows every box of the trees by its reach. The reach is the threshold, plus a size in pixels at the box's farthest depth. That size is the largest of the batches on the raycast's layers. The trees keep each batch's largest size in pixels as they take its rows. A raycast on layers without such rows grows nothing, so it walks as before.

Overlap queries do not find sprites, points or lines. three.js has no overlap queries to match, and a quad turns to face each camera, so a volume test would depend on the camera.

## Consequences

- `RaycastOptions` gains `pointThreshold` and `lineThreshold`. A hit's `object` can be a `SpriteBatch`, `PointBatch` or `LineBatch`, named by the `QueryTarget` type, and these batches take `on` and `off` for pointer events.
- The core's query input holds the thresholds and the camera. A sprite batch knows whether it holds points.
- The rows of a dynamic sprite, point or line batch join the dynamic tree. A frame that runs a query builds that tree again, as for a dynamic instance batch. A large batch of particles then adds to each such frame, on any layer. `bench_row_queries` in `crates/null3d-core/tests/bench.rs` measures raycasts with such rows.
- `docs/api/raycast.md`, `docs/api/sprites.md`, `docs/api/points.md`, `docs/api/lines.md` and `docs/api/input.md` describe the hits; the mapping's `Raycaster`, `Sprite`, `Points` and `Line` entries give the thresholds.
