# D-23: Index-only instance data on core WebGPU

Status: decided for now: the index path stays a test switch, off by default. The owner's iPad timing is still to come and can reopen it. Date: 2026-10-05. Task: M2-K1 (T-23).

Summary: Behind `?instances=index` on core WebGPU only, the culling pass writes a 16-byte entry with the source's index in place of a 64-byte copy. The vertex shaders then read the matrix, material and cell offset from storage buffers. Twelve scenes draw the same images both ways, to the pixel, on the Mac's GPU and SwiftShader. The builds load on first use, 15.1 to 16.7 KB after Brotli each. On the device cloud, S1 is 13% faster on a Galaxy S25 and 1.4% slower on an iPad. S1-static changes by less than 2% on both, and the Mac shows no change. No device saves the 5% of GPU time in S1-static that a capability flag needs, so it stays off by default.

## Question

On WebGPU, each view's culling pass copies every visible instance into a compacted buffer. A copy holds three rows of the world matrix and a vector of ids: 64 bytes. The vertex shaders read the copy as instance-rate vertex attributes, as hard rule 7 asks. On core WebGPU, vertex shaders can also read storage buffers. Should the culling pass write only each visible source's index, 4 bytes, and the vertex shader read the rest by that index?

## Rule

Adopt the index path behind a capability flag if it saves at least 5% of the GPU time in S1-static or S6. The Mac or the iPad must show the saving. Its images must be identical, and it must cost time in no scene on either device. The owner allowed the measurement as an exception to hard rule 7 (question 2 of the milestone's plan, 3 October 2026). The owner also allowed a capability flag if the path wins.

## The two ways

| | Copies (the default) | Indices (`?instances=index`) |
| --- | --- | --- |
| The culling pass writes, per visible instance and view | 64 bytes: three matrix rows, then the material and the first joint | 16 bytes: the source's index in a whole entry |
| The vertex shader reads, per instance | 64 bytes of instance-rate attributes | 4 bytes of instance-rate attribute, at a stride of 16. Then from storage buffers: 48 bytes of matrix, a 4-byte bucket table entry and the bucket's record of 40 bytes, which the bucket's instances share. The cell's offset comes from a uniform block |
| Each view's compacted buffer | 64 bytes per drawn source | 16 bytes per drawn source |
| Compatibility mode | Yes | No: about 45% of those devices have no storage buffers in vertex shaders |

How the engine builds the index path:

- The `?instances=index` switch turns it on, on core WebGPU only. Compatibility mode and WebGL2 ignore the switch.
- The permutation bit `INSTANCE_INDEX` gives the WebGPU builds of six templates. They are the standard material with and without maps, both unlit ones, the shadow depth and the outline mask. The culling pass draws with these, and with others that only sprites, lines, tests and development builds use.
- The builds load on first use, as the feature `instance_index` of the shader manifest ([D-56](D-56-first-use-shader-files.md)). They sit in four shader files of their own, one for each value of the bits that a device fixes. They take 15.1 to 16.7 KB after Brotli each, about half the limit of a first-use file, and at most 85% of its gzip limit. A page without the switch downloads none of them.
- Meshes that the vertex skinning switch skins in the vertex shader keep the copies, and no build has both the `SKIN` and the `INSTANCE_INDEX` bits. A build with both would load with the skinning feature, since a build goes with its lowest bit. So every WebGPU page with a skinned mesh would download them. They more than doubled the WebGPU skinning files: 2.2 to 2.5 MB uncompressed and 434 to 559 KB after gzip. The limits are 1,536 KB and 320 KB. The permutation module's `APART` list holds the pair, and the shader build makes no build with both bits of a pair in it.
- A bucket reads indices when the switch is on and its template has the builds, unless the vertex shader skins it. Custom materials, sprites, lines, the debug views and the texture coordinates template keep the copies. So do the transparent pass's instances, which the CPU writes after it sorts them. Custom materials have no `INSTANCE_INDEX` builds, which would double what a project's bundle holds for each material.
- Each bucket record has a word more, which tells the culling shader the bucket's form. A bucket that reads indices has its slice in the view's compacted instance buffer, after every copy. So the culling group binds no buffer more. Culling may bind at most 8 storage buffers, the default limit. Occlusion culling takes the last of them for its depth pyramid. A unit test keeps every pipeline within that limit.
- Each index fills a whole 16-byte entry, which the shader writes as one vector. Its base counts entries from the buffer's start. A first build wrote each index as one 32-bit word of a vector, four indices to an entry. That is a data race. WGSL may write one part of a vector in storage as a read and a write of the whole vector. So two threads that write neighbouring parts of one entry can lose a write on any GPU. SwiftShader drew every index image right, and Apple's GPUs showed the race. One index per entry ends it, as atomic writes would. The timings below come from an earlier build, with 4-byte indices in a buffer of their own. Occlusion culling has since taken that buffer's place in the culling group.
- Each view has an index group of bind group layout `INSTANCE_INDEX`. It binds the view's culling parameters as a uniform block, for the view's row of the cell offsets texture. Then it binds the matrices, the bucket table and records of the layout that the view draws, and the cell offsets texture ([D-95](D-95-culling-cell-offsets.md)). The group is made again whenever the view's culling group is, since both bind the same resources. It sits after the template's own groups: the frame's, the maps' and the joint texture's, where the template has them.
- The vertex shader adds the cell's offset to each matrix row with the same 32-bit addition that the culling shader makes for a copy. So both ways give each vertex shader the same matrix, bit for bit.

The default path changes too. Each bucket record has a word more, and the culling shader writes each copy as unsigned integers, which keeps every bit of the floats. The shader build makes 118 more WGSL builds.

## Data

### Images

| Measure | Result | Where |
| --- | --- | --- |
| Twelve scenes drawn both ways in one run, compared pixel for pixel: objects and an instance batch, cells 1,000 km out, the standard material's maps, cascaded shadows, point light shadows, skinned characters from the skinning pass and skinned in the vertex shader, hidden outlines, see-through objects, custom materials with textures, S1-cells and S4 | 0 pixels differ in each scene | Chrome on the Mac's GPU, and SwiftShader, 2026-10-05 |
| The twelve copies in the image test manifest (`-index`), against their tests' references | All pass on both reference sets | `bun run test:images -g "-index"` |
| A fault that moved each instance read by index 1 m along x | Four of five scenes failed, with 6.1% to 15.5% of their pixels changed. The custom material scene kept its image, as custom materials keep the copies | The Mac's GPU, 2026-10-05 |

The fault check shows that the copies of the image tests draw through the index path.

### Download size

These figures compare with main on 2026-10-05, after Brotli. The WebGPU start shader files grew by 0.0% to 0.5%, and the core WebAssembly files by 0.1% to 0.2%. The renderer's JavaScript grew by up to 0.8%. At full precision the four new shader files take 15,957 and 15,949 bytes, without and with tone mapping in the shader. At half precision they take 15,418 and 17,098 bytes. Uncompressed they are 1,043 to 1,183 KB, and after gzip 213 to 272 KB.

### Timing

The benchmark page kind `null3d-webgpu-index` starts null3D with `?instances=index`, so a run takes turns between it and `null3d-webgpu`. The GPU time is the median of each run's frames, from timestamp queries. Each figure below is the median of five runs, and every page passed on both devices: 33 of 33 each.

| Device, 2026-10-05 | Scene | Copies (ms) | Indices (ms) | Change | Range of the five runs, copies / indices (ms) |
| --- | --- | --- | --- | --- | --- |
| Galaxy S25, Chrome 149, device cloud | S1 | 12.71 | 11.01 | 13.4% faster | 12.71 to 12.78 / 10.98 to 11.04 |
| | S1-static | 7.83 | 7.73 | 1.3% faster | 7.77 to 8.09 / 7.70 to 7.86 |
| | S4 | 7.57 | 7.60 | 0.4% slower | 7.54 to 7.70 / 7.60 to 7.63 |
| iPad (10th generation), Safari 27, device cloud | S1 | 15.19 | 15.41 | 1.4% slower | 14.25 to 16.21 / 14.04 to 16.10 |
| | S1-static | 7.21 | 7.31 | 1.4% slower | 6.71 to 7.57 / 6.74 to 7.69 |
| | S4 | 16.84 | 16.86 | 0.1% slower | 13.74 to 17.54 / 13.75 to 17.17 |

These runs drew the build before the index builds moved to first-use files and before meshes skinned in the vertex shader kept the copies. Neither change alters what S1, S1-static or S4 draw on the GPU. The S25's display ran at 30 Hz, which the runner marks as unreliable for frame timing. The GPU times come from timestamp queries, so the refresh rate does not set them.

On the S25, S1 gains 13%, but S1-static, where the rule looks, gains only 1.3%. On the iPad every scene is 0.1% to 1.4% slower, and the five runs of each page overlap by more than the change. No device yet meets the rule's 5% in S1-static.

The Mac ran Chrome on WebGPU, five runs of each page, with its load about 3.9 (run `20261005-162153-bench`). Its GPU times are equal: S1 takes 2.11 ms with the copies and 2.13 ms with the indices, and S1-static changes by 0%. On the main thread, S1 takes 2.05 ms with the copies and 2.33 ms with the indices, 0.28 ms more. S1-static takes 0.07 ms both ways, and S4 0.12 ms with the copies and 0.10 ms with the indices.

Still to run:

- The owner's iPad: `bun tests/real-browsers.ts --plan bench --lan ipad-safari --scenes s1,s1-static,s4 --pages null3d-webgpu,null3d-webgpu-index`
- S6, when it exists: the same commands with `--scenes s6`.

The device cloud runs above came from `bun tests/real-browsers.ts --plan bench --cloud bsgalaxys25-chrome,bsipad10-safari --scenes s1,s1-static,s4 --pages null3d-webgpu,null3d-webgpu-index`.

S1 and S1-static are each one instance batch, and instance batches cast no shadows yet. So their runs time the culling and the camera's pass. S4's sun casts shadows in the preset's cascades, so S4 times the shadow passes too.

What to expect: per visible instance and pass, the index path writes 60 bytes less. It reads about as many bytes, but through storage buffers instead of the vertex fetch. S1-static uploads no matrices, so the copies are a larger share of its frame's work than in S1.

## Decision

No device meets the rule's 5% in S1-static: the Galaxy S25 gains 1.3%, the cloud iPad loses 1.4%, and the Mac shows no change. So the copies stay the only default, and `?instances=index` stays a test switch, off by default. The owner's iPad run is still to come and can reopen this. If a device then meets the rule, the index path ships behind a capability flag for core WebGPU, and the transparent pass's instances follow it.

## Consequences

- `AGENTS.md` hard rule 7 names the switch as its one exception while this record is open.
- The image test manifest draws the twelve scenes again with the switch, on core WebGPU, against their own references.
- The public docs do not list the switch, since the path does not ship.
