# D-69: The texture memory budget

Status: decided for the method, 2026-10-05, and for HDR textures, 2026-10-07. The drop order waits for prototype A6's device runs. The start-time cost waits for the owner's view. Task: M2-A4.

Summary: Past each preset's budget, textures from files drop up to 3 mip levels, with a band of 5%. The order is Godot's: more detail than any view needs, then unseen the longest, then the largest. Levels come back by loading the file again into a hidden texture. Arrays start at 8 MiB, stop at 128 MiB and shrink. The 129th texture of 1,024 texels now holds 768 MiB for a frame, not 2,048.

## Question

How does the engine hold the GPU memory of textures under each preset's budget from [D-12](D-12-memory-budgets.md), and give detail back when room returns? And how do texture arrays stop holding twice their memory while they grow, and memory they no longer need (review finding R5-05)?

## Rule

- No preset passes its texture budget on either GPU path, with textures that the engine can load again.
- Every level that the engine drops can come back, at the detail of the file.
- A drop or a return never makes a texture draw without its map.
- The frame loop allocates nothing, and a frame without a budget to act on does no more than a sum over the arrays.

## Data

**The budget.** The preset row `textureMemoryMiB` keeps D-12's values: 256, 512, 1024 and 2048 MiB. Phones and tablets cap every preset at 1008 MiB, half the 2016 MiB at which the iPad Pro's tab died. A page's own `textureMemoryMiB` option, and `quality.set`, give their value as it is.

**Texture arrays before and after (R5-05).** Textures of 1024 x 1024 texels with mip levels take 5,592,404 bytes a layer:

| Case | Before | After |
| --- | --- | --- |
| One texture alone | 4 layers: 21.3 MiB | 1 layer: 5.3 MiB |
| 128 textures | one array of 128 layers: 683 MiB | 5 arrays of 24 and one of 8: 683 MiB |
| The 129th texture arrives | 256 new layers beside 128 old for a frame: 2,048 MiB | the last array grows from 8 to 16: 768 MiB for a frame |
| 128 of 129 destroyed | the 256-layer array stays: 1,365 MiB | 1 layer: 5.3 MiB |

The memory count before the change left out the old array in the frame that it held both. Now `textures.memoryBytes` counts it until the next frame's list destroys it.

**What drops in the test page.** The image test `texture-budget` loads two 512 x 512 PNG textures and a 64 x 64 one, then sets a budget of 1 MiB. On all three GPU paths and in all five thread modes, on Chrome on the Mac's GPU and on SwiftShader:

- Both large textures dropped one level, from 1,398,100 bytes each to 349,524. The memory fell from 5.4 MiB to under 1 MiB, and the small texture kept its levels.
- Raised to 64 MiB, the budget gave both levels back from the PNG file, and the textures took 1,398,100 bytes each again.
- At a budget of 64 KiB, the large textures dropped 3 levels each. A 512 x 512 KTX2 file of ETC1S data loaded again without its largest levels. It became BC7 on WebGPU and dropped 2 levels, from 349,552 bytes to 21,872. It became ETC2 on WebGL2 and dropped 1 level, from 174,776 bytes to 43,704.

**Size and start time.** Against main at df80eb92, on 2026-10-07, after Brotli:

| File | Main | With the budget | Growth |
| --- | --- | --- | --- |
| Core WebAssembly, threaded | 303,569 B | 310,381 B | +6,812 B (+2.2%) |
| Core WebAssembly, single | 302,657 B | 309,463 B | +6,806 B (+2.2%) |
| Core glue, threaded | 11,200 B | 11,295 B | +95 B (+0.8%) |
| Start JavaScript, pipelined | 126.1 KB | 127.1 KB of 140 KB | +1.0 KB |

[D-83](D-83-gate-rulings-2026-10-06.md) gives about 6.5 ms of the S24+'s cold start on Slow 4G for each KB of start download. So the core's growth costs about 43 ms. The whole start download grows about 7.7 KB, which costs about 50 ms. That is about 0.9% of D-83's cold start target of 5.5 s. The core keeps 52% of its 600 KB budget. Most of the growth is the budget's order, its estimate of need and the arrays' moves and shrinks. All of them run in the core every frame. None of it can load on first use: the budget must hold from the first texture. The owner sees the figure in pull request #346.

**The owner's iPad.** On 2026-10-07 the same page passed on both GPU paths in Safari on the owner's iPad Pro (run 20261007-062131-checks, [tested devices](../tested-devices.md)). The KTX2 texture became ETC2 on both paths and dropped a level by loading its file again. The WebGPU page ran at High and started with a budget of 1008 MiB, the tablet cap, not High's 1024 MiB. The WebGL2 page ran at Medium, WebGL2's highest preset, and started with Medium's 512 MiB. The test sets its own budgets with `quality.set`, so the preset does not change what it checks.

How the data was produced: on 2026-10-05, `NULL3D_PORT=17373 bun run test:images -g texture-budget`, then the same with `CI=1`. The size figures come from `bun run build:check-size` on 2026-10-07. The unit tests in `crates/null3d-render/src/textures.rs` and `textures/budget.rs` give the table's array figures.

## Decision

**When.** Before each frame culls, the texture store compares the memory that its arrays will hold once the frame has sized them with the budget. Above the budget plus 5%, every array that textures share loses its free layers first. Then the store drops one mip level at a time until the textures fit under the budget less 5%. Below that, it asks for dropped levels again while they fit. At most 8 steps start in a frame, and a texture drops at most one level a frame.

**The order.** Godot's texture streaming module sets it, in its `FitCandidateComparator` (`modules/texture_streaming`). First comes a texture that holds more detail than any view needs, then the texture unseen the longest. Then come the largest, the one with fewer dropped levels, and the lower slot. A texture drops at most 3 levels, as Godot's default `max_lod`. A texture under 64 KiB keeps its levels.

**The need.** Godot learns each material's need on the GPU: each fragment computes its UV derivatives and writes them with a storage atomic per subgroup. WebGL2 has no storage buffers, and WebGPU's compatibility mode allows none in fragment shaders. So the engine estimates the need on the CPU. It does so while the textures take more than half the budget, or while any texture has dropped levels. Each frame then reads 4,096 bounding spheres of objects and instance rows, from where the last frame stopped. Each sphere in the camera's frustum covers about `diameter / (distance * tan(fov / 2))` of the canvas's height. A texture needs about one texel per pixel across the largest object that maps it. The estimate assumes that the texture spans the object once, and keeps one more level. A texture that no object in the view maps needs none of the levels that the budget drops. A 2D background texture always needs every level. A cube map or environment background keeps every level, as every cube texture does, and a sky takes no texture.

**What drops, and how.** Only a texture whose texels the page can load again drops levels. That is a texture from `assets.loadTexture` or a glTF model, whose file the engine notes. A texture that a sketch makes from an image or data keeps its levels. The engine keeps no copy of its texels, so it could never give them back. Such a texture counts toward the budget. So do cube maps and environment maps, which keep every level: the built-in room's map, which the engine makes at load, among them. A texture drops a level in one of three ways:

- Uncompressed texels on the GPU move to the array of the next smaller size. The frame's list copies every level but the largest. The old layer frees after the copy.
- Texels that bring their own levels, and wait in engine memory for their upload, lose their largest level there.
- Compressed texels on the GPU load again from the file without their largest levels. Neither compatibility mode nor WebGL2 copies compressed texels. Since pull request #381, KTX2 files of UASTC HDR data transcode to `rgb9e5ufloat`. Those HDR texels load again the same way. WebGL2 cannot copy that format, so each such texture has an array of its own, as a compressed one has. The store applies this to any format that takes writes only, compressed or shared-exponent. A format added to that rule drops by loading again too.

**Giving levels back.** The engine asks the page to load the file again. The page fetches it with `cache: 'force-cache'`, so the HTTP cache usually answers. An image decodes at the size of the levels that stay, with `resizeQuality: 'high'`. A KTX2 file transcodes and keeps its smaller levels. An image inside a glTF file reads its byte range again. The parser notes the file that holds each buffer, and where the image lies in it. The texels go to a hidden texture of their size. Once they are on the GPU, the texture swaps places with it, so it draws with its old levels until then. Two loads run at once. A file that no longer loads keeps the texture at the levels it holds, and it drops no more. The same path loads a file's texture again after the browser takes the GPU away.

**Arrays.** An array that textures share starts with at most 8 MiB of layers, at least one, and doubles up to 128 MiB or 256 layers. When fewer than a quarter of its layers stay in use, it shrinks to the next power of two. Its textures then move to its lowest layers. While the textures pass their budget, it holds exactly its textures. An array that the frame's moves emptied, or that the frame resized, keeps its old GPU texture until the next frame's list. A capture plays a frame's list twice, so a list never destroys what it reads.

**Reports.** `quality.textureMemory` gives the bytes, the budget and the dropped levels and textures. `texture.droppedLevels` gives one texture's count, and `debug.frameStats()` adds `textureBytes`, `textureBudgetBytes` and `droppedLevels`. The `quality.onChange` handlers run after the budget drops levels or asks for them again.

Rejected:

- The first plan's order, the largest mip levels of the largest textures first. It is Godot's third key. With it, a large texture on screen loses detail before a small one that nothing shows.
- Godot's GPU feedback: it needs storage atomics in fragment shaders, which WebGL2 and compatibility mode lack (above).
- Keeping each texture's texels on the CPU to give levels back. The iPad's CPU and GPU share one memory, so the copy would cost what the budget saves.
- Dropping levels of the sketch's own textures with no way back. Their detail would be lost for good after a short burst of loads.
- An array per texture, which never wastes a layer. Materials whose maps share an array share a bind group, and the GPU switches textures less often between draws (`api/textures`).
- For `rgb9e5ufloat` textures: decoding them to `rgba16float`, which the GPU can copy. That doubles their memory, 8 bytes a texel against 4, and the budget exists to save memory. Leaving them out of the drops was rejected too: an HDR map from a file can be one of the largest textures in a scene. Decided on 2026-10-07, when #381 merged into this work.
- Destroying an array's old GPU texture in the frame that copies from it. A capture plays the list twice, and the second copy would read a destroyed texture.

## How three.js handles it

three.js sets no texture budget. Its `renderer.info.memory.textures` counts the textures that the renderer holds, not their bytes. Its WebGPU renderer counts bytes in `info.memory.texturesSize`, but gives every compressed texture 1 byte. An app learns that it used too much memory when the browser closes the tab. Babylon.js, PlayCanvas and Bevy set no budget either. Godot's texture streaming module is off by default. It drops levels by GPU feedback in the order above, with the same band of 5% and 3 levels at most.

## Consequences

- `crates/null3d-render/src/textures/budget.rs` holds the budget, the order, the estimate of need and the loads again. `textures.rs` holds the arrays' growth, the moves and the shrinks.
- `packages/engine/src/scene/textures.ts` starts the loads again that the core asks for. `assets.ts` and `gltf.ts` note each texture's file.
- The preset row moved from `quality/preset-docs.ts` into `quality/presets.ts`. It changes during play, and `quality/chooser.ts` holds the cap of phones and tablets.
- The docs pages `concepts/quality-presets`, `api/quality`, `api/textures`, `concepts/assets` and `guides/phones` describe the budget. The develop skill's `performance.md` and `api-quickref.md` show it, and the three.js mapping has a `texture-memory` entry.
- Prototype A6 checks the order on the iPad and on BrowserStack's Galaxy S25. It runs the `texture-budget` page through the runner, and the S6 scene once its textures pass a phone's budget. If a texture on screen loses detail before one off screen, the estimate of need changes, not the order.
- The test page's KTX2 file `budget-checker-etc1s.ktx2` joins the files whose transcoder output `packages/engine/src/scene/ktx2.test.ts` compares with the official Basis Universal 2.50 build. Its 5 hashes came from that official build, as [Image tests](../image-tests.md#the-manifest) says.
- `bun run decisions` lists the record ([D-84](D-84-generated-decision-list.md)). D-12's texture budgets now apply.
