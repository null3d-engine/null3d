# D-138: Custom shader inputs: second texture coordinates, pixel position, instance index, matrices and ids

Status: decided by the helper of M2-EX23 on 11 October 2026, for the owner's review. Built: the custom material inputs are on main (`9093bad7f`). The owner's review is pending. Date: 2026-10-11. Task: M2-EX23.

Summary: Custom materials read every input that three.js's `ShaderMaterial` gives its shaders. The surface input gains `uv1`, `fragCoord` and `instance`, and the vertex input gains `uv1` and `instance`. `camera` gains `view`, `projection`, `near` and `far`, and `object` gains `worldMatrix`, `normalMatrix` and `id`. They work on all three GPU paths. An input that costs something reaches only WGSL that reads it. The shader compiler turns on its code by a shader def per material, so other materials get no build, binding or upload. The camera's two matrices join the frame's uniform block. The instance index and the object id come from a uniform table of object ranges, which the vertex shader searches. No input takes a texture slot.

## Question

The docs listed seven inputs of custom shaders as not built, and the showcase scenes and three.js ports need them ([D-117](D-117-showcase-features-before-1-0.md)). Each three.js `ShaderMaterial` built-in needs a place: `uv1`, `gl_FragCoord`, `instanceIndex`, `viewMatrix`, `projectionMatrix`, `cameraNear`, `cameraFar`, `modelMatrix` and `normalMatrix`. Where does each value come from on each GPU path, and how does a material that reads none of them pay nothing?

## Rule

- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- Design principle 8: a material that reads none of the new inputs gets no new build, binding, upload or shader code.
- The WebGPU main pass uses all 16 texture slots of a stage for the parallax materials that displacement maps bring. The inputs come from uniforms or vertex data, never from new textures.
- Hard rule 6: compatibility mode passes at most 15 values between the vertex and the fragment stage, and 14 into a fragment shader that reads `front_facing`.
- Hard rule 7: per-instance data reaches vertex shaders through vertex buffers or textures, never through storage buffers.

## Options

### How a material asks for an input

| Option | Verdict |
| --- | --- |
| A: the shader compiler scans the WGSL for the fields that it reads, as it scans for `.transmission`, and adds a shader def for each input that costs something | Chosen |
| B: permutation bits, built for every custom material | Rejected. Each bit doubles a material's builds and its compile time, for inputs that few materials read |
| C: always on | Rejected by principle 8: the second texture coordinates cost a vertex attribute, the matrices three values between the stages, and the ids a search |

Defs are per material, so they make no new builds. Three defs cover the inputs that cost something:

| Def | Turned on by | What it costs the material |
| --- | --- | --- |
| `CUSTOM_UV1` | `.uv1` | The second texture coordinates at vertex location 3, and two more floats in the value that carries the first set |
| `OBJECT_IDS` | `.instance`, `object.id` | A search of the table of object ranges per vertex, and one flat `vec2u` to the fragment stage |
| `OBJECT_MATRICES` | `object.worldMatrix`, `object.normalMatrix` | Three flat `vec4f` rows of the world matrix to the fragment stage, from which each stage builds both matrices |

`fragCoord` comes from the fragment's `@builtin(position)`, which every build has, and the camera's values from the frame's block, which every build binds. Both cost nothing, so they need no def.

### The second texture coordinates

A mesh without a second set offers its first set at location 3 ([vertex formats](../../packages/engine/src/gpu/vertex-format.ts)), as the standard material's maps rely on. So the second set is no attribute that a mesh needs, and the compiler drops it from the material's needs. A mesh with one set draws, and reads its first set as `uv1`.

### The pixel position

`fragCoord` holds the pixel's x and y from the target's top left corner, and its depth in z. Pixel rows count upward on WebGL2, so its builds turn y around with the target's height, as ambient occlusion does. Three components, not four: the fourth of `@builtin(position)` is not the same on every path, and three.js ports read `gl_FragCoord.xy` and `.z`.

### The camera's matrices

| Option | Verdict |
| --- | --- |
| A: `view` and `projection` as two `mat4x4f` at the end of the frame's uniform block, filled for the views of cameras and of reflection passes | Chosen |
| B: only the view's rotation, with the projection worked out in the shader | Rejected. It saves 64 bytes per view, and costs a matrix product in every stage that reads it |
| C: a block of their own | Rejected. Another binding in every frame group for 128 bytes |

Both work relative to the camera, as every engine position does: `camera.view` is the camera's rotation alone, and `camera.projection * camera.view == camera.viewProjection`. The projection keeps the engine's reversed depth. The block grows from 560 to 688 bytes per view. The views of lights leave both matrices at zero, as they leave the fog and the lights. Since M3-V2 they hold the scene camera's instead, which a masked custom material's surface reads where its caster runs ([D-241](D-241-vegetation-foundation.md#addendum-how-custom-materials-cut-their-shape-24-october-2026-m3-v2)).

### The object's matrices

Every vertex shader has the instance's world matrix. The vertex stage builds `object.worldMatrix` and `object.normalMatrix` from its rows. The fragment stage gets the rows as three flat values at locations 5, 6 and 7. Only the builds with maps (the tangent frame) and with the alpha hash use those locations. Custom materials have neither. The world matrix keeps its translation relative to the camera, so `camera.viewProjection * object.worldMatrix` places a vertex. `object.position` still gives the origin in the world. `normalMatrix` is the inverse transpose of the world matrix's 3 x 3 part, in world space. three.js's `normalMatrix` works in view space, so a port multiplies the result by `camera.view`.

A custom material with every input passes 13 values to its fragment stage, below compatibility mode's 14.

### The instance index and the object id

On both GPU paths, one bucket holds the rows of batches and the scene objects that share its mesh and material. So a value per bucket or per draw cannot carry them.

| Option | Verdict |
| --- | --- |
| A: a uniform table of object ranges, which the vertex shader searches by the instance's source | Chosen |
| B: a texture of ids per source | Rejected: no texture slots are free on WebGPU, and WebGL2's vertex stage is near 16 |
| C: the culling shader writes ids into the free fourth word of each copy | Rejected. The culling group has all eight storage buffers that a device allows, and WebGL2 has no copies |
| D: grow each instance copy | Rejected for the reason [D-127](D-127-row-values.md) gives: every bucket would pay |

The table works the same on both paths. Sources below the scene's rows are the scene's slots, so an object's id is its slot and its index is 0, with no search. Each batch's rows follow in one range. The table lists each range by its first source, with the batch's id, which has bit 20 set above every slot. On WebGL2, the moving batches' rows live in the streamed data texture, so their keys have the top bit set. The vertex shader halves the table at most 11 times. The table is 16 KB, the largest uniform block that WebGL2 and compatibility mode allow: a header and 2,046 ranges. A scene with more batches ends the table early, and the rows past it read 0 for both.

It binds at binding 17 of WebGPU's frame and depth groups, and at binding 8 of WebGL2's frame group, which was free there. The builders create the buffer once. They fill it only when the layout changes while a live material reads ids, from the shading bit `CUSTOM_OBJECT_IDS` (1 << 31). A page whose materials read no ids uploads nothing. The sketch reads the same number from `mesh.shaderId` and `batch.shaderId`.

### Full shaders

`fill_builtins` fills the camera's new values for full shaders too. The object's matrices, index and id stay zero there, as its row values do. A full shader has the instance itself: `find_instance` and `world_normal` in `null3d::mesh`.

## Data

All figures compare this change with main at `540d38cff`, on the Mac's GPU unless a line says otherwise.

### Download size

| File, after Brotli | Before | After | Change |
| --- | --- | --- | --- |
| Core WebAssembly, threaded | 363,356 bytes | 368,124 bytes | +1.3% |
| Core WebAssembly, single-threaded | 362,216 bytes | 366,796 bytes | +1.3% |
| First-use shader files | | | +0.3% to +1.1% |

No file grew by more than 2% and by 64 bytes or more, so the size check needs no reason. The core keeps 40% of its 600 KB budget.

### GPU time

`bun run bench:gpu-check`, median GPU time per frame:

| Page | Before | After | Change |
| --- | --- | --- | --- |
| S4, Medium | 3.94 ms | 3.93 ms | -0.4% |
| S6, Medium | 4.63 ms | 4.78 ms | +2.8% |
| S4, High | 3.93 ms | 3.94 ms | +0.5% |
| S6, High | 5.03 ms | 4.97 ms | +0.1% |

All four are within the check's noise. A material that reads none of the new inputs gets no new code in its shaders. The frame block grows by 128 bytes per view, which the check cannot see.

### Allocation

`bun run bench:allocation` on SwiftShader (`CI=1`), bytes allocated per frame:

| Worker | WebGPU | WebGL2 |
| --- | --- | --- |
| Render worker | 498.6 | 92.0 |
| Sketch worker | 165.9 | 200.2 |

Both paths pass their budgets. The table of object ids is built when the layout changes, not each frame.

### Tests

- Rust: 637 of 637 pass in the render, GPU and WebAssembly crates. The shader compiler's material tests: 26 of 26.
- Unit tests pass, with two new cases for the GPU library's affine matrices. The library test passes on all three GPU paths.
- The custom inputs image test draws the same picture on WebGPU, WebGPU compatibility mode and WebGL2.
- Image regression on the Mac's GPU: 185 of 191 pass before new references. The other 6 were the new tests, which now have references on the Mac and on SwiftShader.

## Decision

Option A for each part. Defs come from a scan of the WGSL, and the camera's matrices from the frame's block. The world matrix's rows pass as flat values, and the ids come from the table of object ranges.

## Consequences

- The custom shading word is full. `CUSTOM_OBJECT_IDS` takes bit 31, its last free bit. The template takes the low 16 bits and the vertex attributes 8. The base color, textures, transmission, row values, caster and object ids take the rest. The next flag of a custom shading needs a second word, which `createMaterial` passes beside the first, or a packing plan. One plan is to pack the vertex attributes, which use 6 of their 8 bits, and the texture count into fewer bits. The coordinator asked for this note on 11 October 2026.

- Code: the shader compiler's scan of inputs; `lit.wgsl`, `null3d::builtins`, `null3d::mesh` and `null3d::vertex`; the frame's block; the render crate's `object_ranges` module and both builders' table; WebGPU's frame and depth layouts.
- Docs: [Built-in shader inputs](../../docs/shaders/builtins.md), [Surface functions](../../docs/shaders/surface-functions.md), the three.js mapping of `ShaderMaterial`.
- Skills: the develop skill's shaders reference, and the port skill's shaders reference.
