# D-217: Draws from a vertex count alone

Status: decided on 22 October 2026, in the branch that builds M3-A5, from the Neon Harbour follow-ups that D-172 lists. Task: M3-A5.

Summary: A draw that has a custom material and two whole numbers, its vertices per shape and its copies, draws in the transparent pass with one `Draw` call, no vertex buffer and no index buffer: the shader makes every vertex from `@builtin(vertex_index)` and `@builtin(instance_index)`. The counts live in engine memory, so a frame of 50,000 rain streaks uploads nothing and costs one call. The draw culls by one sphere that the sketch gives, and `null3d::wrap` wraps positions into a box that moves with the camera. A draw blends, takes no texture and casts no shadow.

## Question

Rain, snow, streaks, sparks and card effects need tens of thousands of copies of a shape that a formula makes. How does a sketch draw them with no mesh data, no per-instance data and no buffer upload in a frame, on WebGPU and WebGL2, with the instance and vertex index in its shader and culling that the sketch controls?

## Rule

- Data first: a frame may upload nothing for the draw. A change of look travels through the material's values, never through a buffer.
- Pay only for what you use: the feature adds no bytes to a page's start unless the sketch calls it.
- One clear way to do each task: the draw is a scene object, so placement, layers, visibility and culling work as they do for every other object.
- Both backends are first-class: the draw works on WebGPU, WebGPU's compatibility mode and WebGL2.
- Hard rule 7: per-instance data reaches vertex shaders through vertex buffers. This draw therefore has no per-instance data at all: its shader computes each copy from the instance index.

## Data

The engine already had every piece except the object and the pipeline:

| Piece | Where it was |
| --- | --- |
| A draw of a vertex count with no vertex buffers | `Op::Draw` in `crates/null3d-gpu/src/drawlist.rs`, used by the background, fullscreen, bloom and debug-line passes |
| A pipeline with no vertex buffer layout on WebGPU | `RenderTemplate.vertexBuffers: []`, used by the final, bloom, pick-resolve and custom effect templates |
| WebGL2's draw with no attributes | `drawVertexArray` binds the empty vertex array for a template without a `vertices` layout |
| A shader that makes its vertices from the two indices | the shader compiler built a full shader of a custom material from any WGSL with one `@vertex` and one `@fragment`, and `mesh_inputs` already returned an empty location list for it |
| Culling by one sphere, with layers and sort order | the transparent pass, through `null3d-core`'s culling and `sorted.rs` |
| A scene object's draw of its own with no mesh parts | the particle system's bucket group and its splice into the transparent pass |

The particle system was the template. It draws `Op::Draw` of six vertices for each record, from a bucket of its own, culled by its object's sphere. A vertex draw needs no records at all: it needs only the two counts.

The alternatives rejected:

- **A mesh with a vertex buffer of zeros and an instance batch of 50,000 rows.** The instance data is per copy, so wrapping rain around the camera needs an upload every frame, and the row data holds nothing the shader reads. 3.2 MB of engine memory for nothing.
- **A compute pass that writes a vertex buffer.** WebGL2 has no compute, so the feature would ship on one path.
- **An indirect draw whose count the GPU writes.** The draw list has no non-indexed indirect op, and the count is a constant of the sketch, not a result of culling.
- **An opaque draw.** The opaque layouts carry a page and an index count per part, and WebGPU's recorded bundles and indirect counts assume both. The transparent pass already records each frame, culls by sphere and sorts.
- **A second public API per GPU path.** The draw is one scene object with one call on every path.

## Decision

1. `scene.createVertexDraw(options)` makes a scene object, a custom material and a table entry that holds the two counts. It returns a `VertexDraw` whose `object` takes every object call, and whose `setCounts` and `setBounds` change the numbers.
2. The plugin compiles a `@vertex` entry point that reads `@builtin(vertex_index)` and `@builtin(instance_index)` and no mesh attribute or `InstanceIn` as a **draw shader**: a custom material whose pipelines declare no vertex buffer. A pass's own shader reads the vertex index alone and stays a pass shader.
3. The renderer gives the draw's bucket its own group bit and records `Op::Draw [vertices, instances, 0, 0]` in the transparent pass, on both builders, with the material's pipeline and the frame's bind group. It sets no vertex buffer and no index buffer, and the next mesh draw binds its own.
4. The counts live in a table in engine memory beside the particle systems. A frame reads them, so a change costs no upload.
5. The object's sphere culls the whole draw. A field that follows the camera either wraps inside a box that a large static sphere holds, or moves its sphere when the camera travels.
6. A draw blends and takes no texture. The first version refuses an alpha mode other than `blend` and any texture that the WGSL declares, so the pipeline needs the frame's bind group alone.
7. `null3d::wrap` in the shader library gains `wrap_relative` and `wrap_around`. A camera-relative position wraps into a box around the camera or around another point.

## Consequences

- A new engine module `crates/null3d-render/src/vertex_draws.rs` holds the table and its tests; `sorted.rs` and both transparent builders gained the branch; the wasm exports `createVertexDraw`, `destroyVertexDraw` and `setVertexDrawCounts` carry it.
- The plugin's classification gained `isDrawShader`, and the compiled material carries `meshless`, which removes the vertex buffer layout from its pipelines.
- The page API gained `scene.createVertexDraw` and the `VertexDraw` class, with docs at `docs/api/vertex-draws.md`, a quick-reference row, and the limits that the first version sets: no textures, no shadow, no pick, one sort place for the whole draw.
- The demo `examples/rain/` draws 50,000 streaks on every GPU path, and its image test holds a frame of it. The browser test `tests/image/vertex-draw.spec.ts` measures the frame's uploads with 1,000 copies and with 50,000, on WebGPU and WebGL2: the two figures match. On 22 October 2026 they were 1,200 bytes per frame on WebGPU and 1,008 bytes on WebGL2, the frame's own records, at either count, in two draw calls.
- The custom materials' vertex buffer layout is now decided per shader, not per material: a draw shader's pipelines read none.
