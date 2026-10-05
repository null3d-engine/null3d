# D-23: Index-only instance data on core WebGPU

Status: proposed; the build and its image checks done, the Mac and iPad timings pending. Date: 2026-10-05. Task: M2-K1 (T-23).

## Question

On WebGPU, each view's culling pass copies every visible instance into a compacted buffer. A copy holds three rows of the world matrix and a vector of ids: 64 bytes. The vertex shaders read the copy as instance-rate vertex attributes, as hard rule 7 asks. On core WebGPU, vertex shaders can also read storage buffers. Should the culling pass write only each visible source's index, 4 bytes, and the vertex shader read the rest by that index?

## Rule

Adopt the index path behind a capability flag if it saves at least 5% of the GPU time in S1-static or S6. The Mac or the iPad must show the saving. Its images must be identical, and it must cost time in no scene on either device. The owner allowed the measurement as an exception to hard rule 7 (question 2 of the milestone's plan, 3 October 2026). The owner also allowed a capability flag if the path wins.

## The two ways

| | Copies (the default) | Indices (`?instances=index`) |
| --- | --- | --- |
| The culling pass writes, per visible instance and view | 64 bytes: three matrix rows, then the material and the first joint | 4 bytes: the source's index |
| The vertex shader reads, per instance | 64 bytes of instance-rate attributes | 4 bytes of instance-rate attribute. Then from storage buffers: 48 bytes of matrix, a 4-byte bucket table entry and the bucket's record of 40 bytes, which the bucket's instances share. The cell's offset comes from a uniform block |
| Each view's compacted buffer | 64 bytes per drawn source | 4 bytes per drawn source |
| Compatibility mode | Yes | No: about 45% of those devices have no storage buffers in vertex shaders |

How the engine builds the index path:

- The `?instances=index` switch turns it on, on core WebGPU only. Compatibility mode and WebGL2 ignore the switch.
- The permutation bit `INSTANCE_INDEX` gives the WebGPU builds of six templates. They are the standard material with and without maps, both unlit ones, the shadow depth and the outline mask. The culling pass draws with these, and with others that only sprites, lines, tests and development builds use.
- The builds load on demand, in four shader files of their own, one for each value of the bits that a device fixes. They take 17.9 to 19.5 KB after Brotli each, under the 32 KB of a shader file that loads on demand. A page without the switch downloads none of them.
- A bucket reads indices when the switch is on and its template has the builds. Custom materials, sprites, lines, the debug views and the texture coordinates template keep the copies. So do the transparent pass's instances, which the CPU writes after it sorts them. Custom materials have no `INSTANCE_INDEX` builds, which would double what a project's bundle holds for each material.
- Each bucket record has a word more, which tells the culling shader the bucket's form. A bucket that reads indices has its slice in the view's compacted index buffer, numbered apart from the copies' slices. The culling group binds that buffer at binding 8.
- Each view has an index group of bind group layout `INSTANCE_INDEX`. It binds the view's culling parameters as a uniform block, for each cell's offset from the camera. Then it binds the matrices, and the bucket table and records of the layout that the view draws. The group is made again whenever the view's culling group is, since both bind the same buffers. It sits after the template's own groups: the frame's, the maps' and the joint texture's, where the template has them.
- The vertex shader adds the cell's offset to each matrix row with the same 32-bit addition that the culling shader makes for a copy. So both ways give each vertex shader the same matrix, bit for bit.

The default path changes too: each bucket record has a word more, each view a 4-byte buffer, and the culling group a ninth binding. The shader build makes 236 more WGSL builds.

## Data

### Images

| Measure | Result | Where |
| --- | --- | --- |
| Twelve scenes drawn both ways in one run, compared pixel for pixel: objects and an instance batch, cells 1,000 km out, the standard material's maps, cascaded shadows, point light shadows, skinned characters from the skinning pass and skinned in the vertex shader, hidden outlines, see-through objects, custom materials with textures, S1-cells and S4 | 0 pixels differ in each scene | Chrome on the Mac's GPU, and SwiftShader, 2026-10-05 |
| The twelve copies in the image test manifest (`-index`), against their tests' references | All pass on both reference sets | `bun run test:images -g "-index"` |
| A fault that moved each instance read by index 1 m along x | Four of five scenes failed, with 6.1% to 15.5% of their pixels changed. The custom material scene kept its image, as custom materials keep the copies | The Mac's GPU, 2026-10-05 |

The fault check shows that the copies of the image tests draw through the index path.

### Download size

These figures compare with main on 2026-10-05, after Brotli. The WebGPU start shader files grew by 0.0% to 0.5%, and the core WebAssembly files by 0.1% to 0.2%. The renderer's JavaScript grew by up to 0.8%. The four new shader files are 19,558, 19,792, 18,289 and 19,972 bytes.

### Timing

Pending. The benchmark page kind `null3d-webgpu-index` starts null3D with `?instances=index`, so a run takes turns between it and `null3d-webgpu`. The GPU time is the median of each run's frames, from timestamp queries.

- The Mac: `bun run bench:run --scenes s1,s1-static,s4 --pages null3d-webgpu,null3d-webgpu-index`
- The iPad: `bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s1,s1-static,s4 --pages null3d-webgpu,null3d-webgpu-index`
- S6, when it exists: the same commands with `--scenes s6`.

S1 and S1-static are each one instance batch, and instance batches cast no shadows yet. So their runs time the culling and the camera's pass. S4's sun casts shadows in the preset's cascades, so S4 times the shadow passes too.

What to expect: per visible instance and pass, the index path writes 60 bytes less. It reads about as many bytes, but through storage buffers instead of the vertex fetch. S1-static uploads no matrices, so the copies are a larger share of its frame's work than in S1.

## Decision

Pending the timings. Until then the copies stay the only default, and `?instances=index` stays a test switch. If a device meets the rule, the index path ships behind a capability flag for core WebGPU, and the transparent pass's instances follow it. If none does, the switch, its builds and its page kind leave the engine, and hard rule 7 stands with no exception.

## Consequences

- `AGENTS.md` hard rule 7 names the switch as its one exception while this record is open.
- The image test manifest draws the twelve scenes again with the switch, on core WebGPU, against their own references.
- The public docs do not list the switch, since the path does not ship.
