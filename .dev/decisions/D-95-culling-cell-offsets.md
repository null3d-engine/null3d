# D-95: The culling pass reads each grid cell's offset from a float texture

Status: decided. Date: 7 October 2026. Task: M2-R23.

Summary: The culling pass reads each grid cell's offset from the view's camera in a float texture, with one row per view. A table in its uniform parameters gave every thread of a group one thread's entry on the Galaxy S25. Objects more than 512 m away then drew in the wrong place. The texture fixes that, and the culling stage keeps 8 storage buffers, the portable budget's limit.

## Question

How should the culling shader read the offset of each source's grid cell on WebGPU and in compatibility mode? Every GPU must read each thread's own cell, within every device's limits.

## Rule

- Every tested GPU culls the depth precision scene and the `cells` scenes right, and the Galaxy S25 (Adreno 830) among them.
- The culling stage stays within the portable budget. That allows 8 storage buffers and 16 sampled textures in one stage, and uniform bindings of 16 KiB.
- A choice that adds no per-frame allocation and no extra pass wins over one that does.

## Data

The Galaxy S25 (Adreno 830, Chrome 149), BrowserStack's device cloud, 7 October 2026. Each case ran main's culling shader, with one change, on 512 synthetic sources in 4 cells. Each source's cell differed from its neighbour's.

| Option | Rows with another cell's offset | Storage buffers in the culling stage | Other cost |
| --- | --- | --- | --- |
| Table in the uniform parameters, as before | 384 of 512 | 8 (with occlusion culling) | None |
| Index clamped to the table | 384 of 512 | 8 | None |
| Offset read before the first early return | 384 of 512 | 8 | None |
| Plane loop with no early return | 384 of 512 | 8 | None |
| Whole table copied into a local variable, then read | 0 of 512 | 8 | 8 KiB of private memory in every thread |
| Parameters in a read-only storage buffer | 0 of 512 | 9 with occlusion culling: over the limit | None |
| Offsets in a float texture, one row per view (chosen) | 0 in the engine's own scenes (below) | 8 | One texel load per source; a 512 x 61 texture of 32-bit floats, 488 KiB |

With the chosen texture, the S25 passed 12 of 12 image tests (run 20261007-043805-checks). They include depth precision on both paths, `cells`, `cells-100km` and `cells-1000km`, and `debug-1000km` and `ortho-camera-1000km`. The storage-buffer option passed the same scenes on the S25 before (run 20261007-032645-checks).

How the data was produced: probe pages on local branches that never merge, `probe/m2-r23-j` to `probe/m2-r23-r`. `bun tests/real-browsers.ts --cloud bsgalaxys25-chrome` ran them on the cloud S25. Probe J dumped the GPU's buffers after a capture, which showed the right offsets in the table and wrong ones in the culled rows. Probe O ran the culling shader alone with plain WebGPU. [Browser faults](../implementation-notes.md#browser-faults) holds the evidence, and [Driver bug reports](../driver-bugs.md) the report for Qualcomm.

## Options weighed

- A uniform index per draw or per workgroup. The culling pass already runs over runs of the cell order, one per visible cell. So a workgroup could take one cell's offset for all its threads. But the runs join where they meet, and moving sources share one run whatever their cells. A workgroup that never spans two cells would need every run padded to whole workgroups, and the moving sources sorted by cell each frame. That costs threads and CPU work. And nobody understands the S25's fault well enough to trust a workgroup-uniform index: the clamped index and the reordered read did not help.
- The offsets in a storage buffer that the stage already binds. The buffers that every view binds (matrices, bucket tables, layer table, cell order) belong to the scene, and the offsets belong to each view. Each view's own storage buffers are its compacted instances, which the shader writes, and its indirect draws. The indirect draws are atomic words that already hold occlusion culling's history. Offsets there would be read as atomic loads and bit casts, in a buffer whose layout changes with the layout of draws. A texture row per view keeps them apart.
- Parameters in a storage buffer. It fixed the S25, but occlusion culling's depth pyramid takes the stage's eighth storage buffer, so the stage would need 9.
- The whole table copied into a local variable. It fixed the S25 in the probe, but costs every thread 8 KiB of private memory, and nobody knows why the copy helps.

## Decision

The offsets sit in a float texture with one row per view and one texel per cell. Each view writes its row with one texel write per frame, of the cells in use. The parameters stay a uniform buffer and name the view's row in their spare word. Every thread reads the texel of its own cell with `textureLoad`. Texture loads fetch per thread, as the joint texture of skinning shows on the S25.

## Consequences

- `crates/null3d-shaders/wgsl/cull.wgsl` binds the texture at binding 9. `crates/null3d-render/src/gpu_driven/cull.rs` makes it once and writes each view's row. The parameters shrink by 8 KiB. `packages/engine/src/gpu/webgpu/pipelines.ts` adds the binding to the culling layout.
- The culling stage binds 8 storage buffers, 1 uniform buffer and 1 sampled texture.
- The WebGL2 path keeps its uniform table of offsets in the vertex shader. It is right on the S25, as on every other tested device.
- Test any new uniform table that shaders index per thread on the S25 before it ships. Or read it from a texture or a storage buffer.
