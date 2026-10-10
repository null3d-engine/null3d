# D-127: Colors and values per row of an instance batch

Status: decided by the helper of M2-EX13 on 10 October 2026, for the owner's review. Date: 2026-10-10. Task: M2-EX13.

Summary: `createInstances` takes `colors: true`, which now draws, and `values: true`, which gives each row four numbers of the sketch's own. A row's color multiplies the base color and opacity, as vertex colors do, and a custom material reads the row's numbers as `object.values` in its surface function and its vertex offset. Both reach the vertex shaders through a data texture, two texels per row, on all three GPU paths and in GPU-culled and CPU-culled batches. A custom material with a vertex offset now casts with it, so swaying grass casts swaying shadows. Nothing changes for batches without colors or values, and their shader builds load on first use.

## Question

The showcase scenes need fields of grass that sway out of step and take a tint per blade, and crowds of props in their own colors ([D-117](D-117-showcase-features-before-1-0.md)). The batches stored a color per row but did not draw it, and a custom material had no value of its own per row. How do per-row colors and values reach the shaders, and how do the shadows follow a vertex offset?

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

- WebGPU: the culling shader writes each visible copy's source index into the free third word of its ids, beside the material and the first joint, and the transparent pass's sorted copies hold it too. One texture holds the values of every source, 1,024 sources to a texel row, as the frame group's binding 16, read by the vertex stage alone. The depth template's group binds it as well, with the materials' custom values, for the shadow casters of custom materials. The texture holds one texel row while no batch has values, and grows to the last row of a batch with values. A new texture binds the groups again and uploads every row.
- WebGL2: beside the resident texture of matrix rows and the ring of streamed ones, a resident texture and a ring of streamed textures of row values hold each batch's values at the same rows. The instance group binds them at bindings 8 and 9, so its slots grow from 8 to 10 (`GROUP_BASES` 0, 16, 19, 29). The index list's entry already gives the row and the draw record the texture, so the shader needs nothing new to find them.

Uploads follow the matrices: a static batch uploads the rows that its update changed, and a dynamic batch every active row of every frame. They go straight from the core's world output, which carries the color and the values beside each row's matrix, double-buffered by frame parity.

### The shader builds

A new permutation bit, `ROW_VALUES` (1 << 24), builds the standard, standard-with-maps, unlit and unlit-with-map templates, and every custom material made from the standard template, with the row's color and values. The vertex shader reads the row's two texels once, and passes them to the fragment shader as flat values. The color multiplies the vertex color, so `defaultSurface` and the unlit shaders take it as they take vertex colors. Custom materials read the values as `object.values`, which is zero for scene objects and for rows without values. A full shader reads zeros too.

To keep the builds few, `ROW_VALUES` stays apart from the skin, morph targets, alpha to coverage, the alpha hash, transmission and index-read instances (`permutation::APART`). Batches never skin or morph. A masked material tests its alpha against its cutoff on rows with colors or values. A material that lets light through draws its rows without their colors and values. The builds load on first use (`first_use.row_values`), with the page's first batch that has colors or values.

### Shadows that follow a vertex offset

Until now every caster drew with the depth template, so a vertex offset moved a surface but not its shadow. A second new bit, `CASTER` (1 << 25), builds the shadow casters of a custom material that has a vertex offset: the standard template's vertex shader moves each vertex by the offset, then places it as the depth template places a caster, with the same offset toward the light for back faces (`caster_clip`, now shared). Its WebGPU pipelines have no fragment stage and bind the depth template's group. These builds keep the draw index, skins on WebGL2 and row values, and nothing that shades. `caster_of` picks them for a custom material that has them, and keeps the material, so its uniforms and textures reach the offset.

A swaying caster changes its shadow in every frame without moving. So a caster whose material has a vertex offset counts as a moving caster: far cascades draw again when one touches them, and spot and point light tiles that one touches draw again in every frame (a batch marks every tile). The shadow views' uniform blocks now carry the frame's clock and the camera's position, so the offset reads the same `frame.time` and `object.position` in the shadow passes as on screen.

A hot update that adds or removes a vertex offset now reloads the page, as the material's caster builds are fixed at its creation.

### The API

| Option | Verdict |
| --- | --- |
| A: `colors: true` and `values: true` on `createInstances`, with `batch.colors` and `batch.values` as typed arrays of 4 floats per row | Chosen |
| B: named attributes of any size, as three.js's `InstancedBufferAttribute` | Rejected for now. Four floats cover a phase, an age, a tint and a size. Named attributes need a size per name and a WGSL declaration per name, which the plugin would have to type |

`colors` and `values` share one store in the core: a batch with either keeps both, 32 bytes per row in each frame's world output and in the GPU texture. Writes follow the rules of the other row arrays: a static batch draws them after `markDirty`.

## Data

Measured on the Mac (Apple M-series GPU, Chrome) unless noted. Figures to be filled in by the measurements of the task.

| Measure | Result |
| --- | --- |
| Image tests: coloured rows, swaying grass at two moments | (to come) |
| Allocation check, S1 with `--row-values` | (to come) |
| Start size, pipelined build, after Brotli | (to come) |
| 100,000 swaying blades, frame interval and GPU time, still against swaying | (to come) |

## Decision

Option A for the data path and the API, with the `ROW_VALUES` and `CASTER` builds.

## Consequences

- Code: the core's world output carries row values; `SceneSettings::batch_pipeline_of`, `caster_of` and `sways`; a shared `data_texture` module for both builders; the WebGPU row values texture and the WebGL2 resident and streamed ones.
- Docs: [Instances and batching](../../docs/concepts/instances.md), [Materials](../../docs/api/materials.md), [Built-in shader inputs](../../docs/shaders/builtins.md), [Surface functions](../../docs/shaders/surface-functions.md) and the three.js mapping of `InstancedMesh.setColorAt` and instanced attributes.
- Skills: the develop skill's instances and shaders references; the port skill's mapping.
