# D-127: Colors and values per row of an instance batch

Status: decided by the helper of M2-EX13 on 10 October 2026, for the owner's review. Date: 2026-10-10. Task: M2-EX13.

Summary: `createInstances` takes `colors: true`, which now draws, and `values: true`, which gives each row four numbers of the sketch's own. A row's color multiplies the base color and opacity, as vertex colors do. A custom material reads the row's numbers as `object.values` in its surface function and its vertex offset. Both reach the vertex shaders through a data texture, two texels per row. They draw on all three GPU paths, in GPU-culled and in CPU-culled batches. A custom material with a vertex offset now casts with it, so swaying grass casts swaying shadows. Nothing changes for batches without colors or values, and their shader builds load on first use.

## Question

The showcase scenes need fields of grass that sway out of step and take a tint per blade ([D-117](D-117-showcase-features-before-1-0.md)). They also need crowds of props in their own colors. The batches stored a color per row but did not draw it, and a custom material had no value of its own per row. How do per-row colors and values reach the shaders, and how do the shadows follow a vertex offset?

## Rule

- Hard rule 7 ([AGENTS.md](../../AGENTS.md#hard-rules)): per-instance data reaches vertex shaders through vertex buffers or textures, never through storage buffers, so compatibility mode draws it.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- No cost for batches without colors or values: no upload, no bind group change and no shader download.
- No allocation per frame (hard rule 1).
- The engine's start grows as little as it can. New shader builds load on first use.
- A field of 100,000 swaying blades draws at its preset's frame rate on the Mac, the S24+ and the iPad (the task's exit rule).

## Options

### How the values reach the vertex shader

| Option | Verdict |
| --- | --- |
| A: a data texture of row values, two RGBA32F texels per row (the color, then the four values), read with `textureLoad` by the row's source | Chosen |
| B: more instance-rate vertex attributes in the compacted instance that the culling shader writes | Rejected. Each copy grows from 64 to 96 bytes for every bucket, with or without values, and the WebGPU cull pass must read and write them. WebGL2 has no compacted instance to grow: it reads its rows from data textures already |
| C: a storage buffer of values read by index | Rejected by hard rule 7 |

Option A follows the way each path already finds a row's matrix:

- WebGPU: the culling shader writes each visible copy's source index into the free third word of its ids, beside the material and the first joint. The transparent pass's sorted copies hold it too. One texture holds the values of every source, 1,024 sources to a texel row. It is the frame group's binding 16, which only the vertex stage reads. The depth template's group binds it as well, with the materials' custom values, for the shadow casters of custom materials. The texture holds one texel row while no batch has values, and grows to the last row of a batch with values. A new texture binds the groups again and uploads every row.
- WebGL2: a resident texture of row values sits beside the resident texture of matrix rows, and a ring of them beside the ring of streamed ones. Each holds a batch's values at the batch's rows. The instance group binds them at bindings 8 and 9, so its slots grow from 8 to 10 (`GROUP_BASES` 0, 16, 19, 29). The index list's entry gives the row and the draw record gives the texture, so the shader finds them with what it reads already.

Uploads follow the matrices: a static batch uploads the rows that its update changed, and a dynamic batch every active row of every frame. They go straight from the core's world output, which carries the color and the values beside each row's matrix, double-buffered by frame parity.

### The shader builds

A new permutation bit, `ROW_VALUES` (1 << 24), reads the row's color and values. The standard and unlit templates, with and without maps, have such builds. So does every custom material made from the standard template. The vertex shader reads the row's two texels once, and passes them to the fragment shader as flat values. The color multiplies the vertex color, so `defaultSurface` and the unlit shaders take it as they take vertex colors. Custom materials read the values as `object.values`, which is zero for scene objects and for rows without values. A full shader reads zeros too.

To keep the builds few, `ROW_VALUES` stays apart from the skin, morph targets, alpha to coverage, the alpha hash, transmission and index-read instances (`permutation::APART`). Batches never skin or morph. A masked material tests its alpha against its cutoff on rows with colors or values. A material that lets light through draws its rows without their colors and values. The builds load on first use (`first_use.row_values`), with the page's first batch that has colors or values.

### Shadows that follow a vertex offset

Until now every caster drew with the depth template, so a vertex offset moved a surface but not its shadow. A second new bit, `CASTER` (1 << 25), builds the shadow casters of a custom material that has a vertex offset. The standard template's vertex shader moves each vertex by the offset. It then places the vertex as the depth template places a caster, with the same offset toward the light for back faces (`caster_clip`, now shared). Its WebGPU pipelines have no fragment stage and bind the depth template's group. These builds keep the draw index, skins on WebGL2 and row values, and nothing that shades. `caster_of` picks them for a custom material that has them, and keeps the material, so its uniforms and textures reach the offset.

A swaying caster changes its shadow in every frame without moving. So a caster whose material has a vertex offset counts as a moving caster. Far cascades draw again when one touches them. Spot and point light tiles that one touches draw again in every frame, and a batch marks every tile. The shadow views' uniform blocks now carry the frame's clock and the camera's position. So the offset reads the same `frame.time` and `object.position` in the shadow passes as on screen.

A hot update that adds or removes a vertex offset now reloads the page, as the material's caster builds are fixed at its creation.

### The API

| Option | Verdict |
| --- | --- |
| A: `colors: true` and `values: true` on `createInstances`, with `batch.colors` and `batch.values` as typed arrays of 4 floats per row | Chosen |
| B: named attributes of any size, as three.js's `InstancedBufferAttribute` | Rejected for now. Four floats cover a phase, an age, a tint and a size. Named attributes need a size per name and a WGSL declaration per name, which the plugin would have to type |

`colors` and `values` share one store in the core: a batch with either keeps both. That takes 32 bytes per row in each frame's world output, and 32 in the GPU texture. Writes follow the rules of the other row arrays: a static batch draws them after `markDirty`.

## Data

Measured on 10 October 2026 on the Mac (Apple M-series GPU, Chrome), and on SwiftShader as CI draws.

| Measure | Result |
| --- | --- |
| Image tests `row-colors`, `row-values` and `row-values-later` | References in both sets on all three GPU paths. WebGPU, compatibility mode and WebGL2 draw the same look |
| The image tests near the change: rows, custom materials, instances, shadows, blending, skins and morph targets | 127 of 127 and then 100 of 100 pass, on the Mac's GPU and on SwiftShader |
| Allocation check, S1 with `--row-values`, SwiftShader | Pass on both paths. Render worker: 470 bytes per frame on WebGPU, 83 on WebGL2 |
| The same with `--batch-shadows` | Pass. Render worker: 659 bytes per frame on WebGPU, 79 on WebGL2 |
| Start, pipelined WebGPU, after Brotli | 130.7 KB on main, 131.2 KB with the branch, of 140 KB |
| Core WebAssembly, after Brotli | 359.8 KB on main, 362.1 KB with the branch (+0.6%) |
| First-use row values builds | 12 files, one per GPU path and device bits, 16.6 to 20.0 KB each after Brotli, of 32 KB |
| 100,000 grass blades under the sun's shadows, still against swaying, on the Mac's GPU at 120 Hz | Every side kept 8.33 ms per frame. GPU time 4.16 to 4.49 ms on WebGPU, 4.06 to 4.42 ms in compatibility mode, 4.56 to 4.26 ms on WebGL2 (within noise). CPU time below 0.25 ms per frame on every thread |
| GPU time against main, `bun run bench:gpu-check` | No page slower. S4 medium 1.29 to 1.24 ms, S6 medium 6.64 to 6.45 ms, S4 high 3.91 to 3.90 ms, S6 high 4.76 to 4.80 ms |

How the data was produced: `bun run test:images -g 'row-|custom-|instances|shadow|transparent|alpha-mask|blending|batch'`, with and without `CI=1`; `CI=1 bun run bench:allocation --gpu webgpu --row-values`, and the same on WebGL2 and with `--batch-shadows`; `bun run build:check-size`; `tests/pages/grass-cost.html` on each GPU path in a parked Chrome window, with the load below 4; `bun run bench:gpu-check`.

The S24+ and the iPad still need the `grass` plan ([Device sessions](../devices.md#the-grass-plan)), for the task's exit rule on those devices.

## Decision

Option A for the data path and the API, with the `ROW_VALUES` and `CASTER` builds.

## Consequences

- Code: the core's world output carries row values. The render crate gains `SceneSettings::batch_pipeline_of` and `sways`, a new `caster_of` branch and a shared `data_texture` module. Each builder has its row values textures.
- Docs: [Instances and batching](../../docs/concepts/instances.md), [Materials](../../docs/api/materials.md), [Built-in shader inputs](../../docs/shaders/builtins.md), [Surface functions](../../docs/shaders/surface-functions.md) and the three.js mapping of `InstancedMesh.setColorAt` and instanced attributes.
- Skills: the develop skill's instances and shaders references; the port skill's mapping.
