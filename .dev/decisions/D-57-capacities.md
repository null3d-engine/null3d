# D-57: Capacities that grow, frames that fail whole, and skinning split by the device's limits

Status: decided. Date: 2026-10-04. Task: M2-R13.

## Question

Some of the renderer's capacities were fixed, and a scene past them failed with no error, or stopped drawing for good. The code review of 4 October found four:

- Each frame's draw list had a fixed size. A crowd of about 300 animated characters with 4 cascades filled it on WebGPU, and about 1,500 meshes did on WebGL2 without `WEBGL_multi_draw` (Firefox). After that, every frame failed and the scene never drew again.
- A frame that failed part way still reached the GPU with half its commands, and the builder believed the rest had run. A texture could then lose its mipmaps for good.
- WebGPU's skinning pass dispatched one workgroup per 64 vertices of a mesh page, along one axis. A dispatch reaches at most 65,535 workgroups per axis. So the pass skipped the characters past about 4,190,000 vertices, 83 of S5's 500 knights in the review's count. A bigger crowd asked for one skinned vertex buffer larger than WebGPU binds, so none animated.
- The joint texture was 3,072 texels wide, past the 2,048 that WebGL2 promises.

How should each capacity behave when a scene reaches it?

## Rule

No capacity fails silently. A capacity that memory alone bounds grows, so a scene that fits memory draws. A capacity that the device's limits fix gives an error that names it and its size. A frame either reaches the GPU whole or not at all. Steady frames allocate nothing, by the allocation check.

## Data

The Rust tests in `crates/null3d-render/tests/capacities.rs` record each case through the mock backend. That backend now refuses a dispatch past 65,535 workgroups on any axis, as a GPU does. Each test failed on the crowd branch (`feat/m2-l2-crowd`, 9bdbce14), which this change builds on.

| Case | Before | After |
| --- | --- | --- |
| 2,500 meshes of their own on WebGL2 without multi-draw, with 4 cascades | The list held 65,536 words; the frame needs 84,743 for its 7,504 draws, so every frame failed | Records whole; the list grows once and keeps its memory |
| A list that starts at 16 words, on both builders | The first frame failed | It grows in the first frame; later frames keep its address |
| A frame past the draw list's limit after it recorded commands | Not handled | The frame publishes no commands; later frames fail with the same error until a new GPU device; then it records whole |
| 470 skinned columns of 9,000 vertices on one mesh page, at a 256 MiB binding | One dispatch of 65,424 workgroups for 66,270 needed: 6 columns never skinned | One dispatch of 33,135 x 2 workgroups covers all 66,270 |
| 1,000 columns of 4,962 vertices, as many vertices as 1,000 of S5's knights, at WebGPU's default 128 MiB binding | One dispatch of 65,520 for 78,000 needed, and one skinned buffer of 159 MB, past the binding | Two buffers of 134 and 37 MB, two dispatches (32,955 x 2 and 12,090) that cover every vertex |
| 25 columns of 9,000 vertices at a 1 MiB binding, which 8 buffers of 1 MiB cannot hold | Not handled | E1501, "the 8 MB that GPU skinning holds"; with one column fewer the next frame records |
| Skinned meshes on 33 mesh pages | Pages past 32 were never skinned | E1501, "more than 32 mesh pages" |

How the data was produced: `cargo test -p null3d-render --test capacities`, on this branch and with the crowd branch's renderer sources in its place, on 4 October 2026.

## Decision

### The draw list grows

A draw list grows when a command needs more room than it has, to at least twice its size, up to a limit. The limit is the words that 32-bit addresses of engine memory reach, unless a test sets a lower one (`draw_list_limit` on both builders). Each frame parity keeps its own list. So frames of one size grow the list only in the first of them, and steady frames allocate nothing. Growing moves the words. So the sketch thread gives the thread that draws each list's address with every frame, as it has since the crowd branch.

The crowd branch reserved room per writer instead: each bundle and each transparent draw reserved its bound before it recorded. That left WebGL2's per-frame draws without multi-draw. The planned work also adds writers. These are one indirect draw per detail level, a second draw for double-sided blended runs, fade draws, and joint rows for wide lines. Each would need its own bound, and one missed bound brings the cliff back. Growth covers every writer. The bounds' code (`bundles_bound`, `words_bound`, `reserve_words`) is gone.

A larger fixed list would waste memory on small scenes and still have a cliff.

### A frame is all or nothing

A frame that fails publishes an empty list. The thread that draws then replays nothing, and the canvas keeps the last frame that recorded whole. What happens next depends on when the frame failed:

- Before it recorded any command, as a scene with too many sources or past a skinning cap does, the GPU did not change. The scene's structure stays marked as changed, so the next frame lays it out again and records whole once the scene fits.
- After it recorded commands, the builder already marks GPU objects as made that the dropped commands would have made. Its state no longer matches the GPU's. So every later frame fails with the same error, and draws nothing, until the thread that draws starts a new GPU device. The builder then makes everything again from its own data.

Most failures come before the first command. After it, memory and the draw list's limit are the usual causes, and memory that cannot grow ends the page's work anyway. Two other designs were rejected. Undoing each module's state on failure touches every part of the builder, and a missed part brings back half-applied frames. A reset of the builder on the same device would make every texture again. The store keeps the texels of only some textures, so the others would lose their images.

### Skinning splits its dispatches and its buffers

- A dispatch with more than 65,535 workgroups spreads them over the fewest rows that hold them. The shader numbers each workgroup by its row and its place in it. Workgroups past the last vertex do nothing, fewer than one per row. One dispatch per segment needs no new table or bind group. A dispatch per 65,535 workgroups would need both.
- Skinned vertices fill up to 8 buffers, each at most the device's largest storage binding. That is 1 GiB in all at WebGPU's default of 128 MiB. A mesh page's parts lie together. Each run of one page's parts in one buffer is a segment of the pass's table. A segment has a bind group and a dispatch of its own. The WebGPU builder also caps each mesh page at the storage binding, as the pass binds a page whole.
- At most 32 mesh pages hold skinned meshes. A page holds one vertex layout. So a scene passes this cap with skinned meshes of more than 32 vertex layouts, or more than 32 bindings of them.
- A scene past either cap fails its frames with E1501 before the frame records a command. Render detail 12 names the skinned vertices, with the megabytes the buffers hold. Detail 13 names the pages, with their count. No skinned object goes without its region, so no character silently stays at rest.

The notes on crowds propose skinning in the vertex shader past a memory cap, and skipping characters whose pose did not change. Both belong to the lean skinning task (M2-C8), which builds on this split.

### The joint texture fits WebGL2

The crowd branch's change keeps: 512 joints per row, 1,536 texels wide. An animation table may hold at most 2,048 rows of joints, which is 1,048,576 joints. So the texture's height fits WebGL2's floor too. `initAnimations` refuses a larger table with E1108. The engine's table holds 65,536 joints, 128 rows. A Rust test checks that the renderer, `skin.wgsl` and `lib/mesh.wgsl` give the row the same size.

## How three.js handles it

three.js's renderers issue GPU calls as they go, with no command list, so they have no list to fill. A scene too large for memory fails in the browser's own calls. three.js skins in the vertex shader of each pass (see [D-20](D-20-webgpu-skinning.md)), so it has no skinned vertex buffers and no dispatch limit. Its bone texture is sized per skeleton, and a skeleton too large for the texture limit fails in WebGL's texture call.

## Consequences

- `null3d_gpu::drawlist::DrawList` grows, with `DrawListError::Full { limit }` and `OutOfMemory`. The parallel recorder keeps lists of a fixed size, as it promises no allocation.
- `RecordError::DrawListFull` carries the limit in mebibytes, and `SkinnedVerticesFull` and `SkinnedPagesFull` are new. E1501's message names each, and its docs page lists the caps.
- `caps::MAX_WORKGROUPS_PER_DIMENSION` holds the dispatch limit, which the skinning pass, the culling pass's binding cap and the mock backend share.
- [D-20](D-20-webgpu-skinning.md) describes the split pass. The animation docs state the skinning caps, and the performance guide gives the crowd limits.
- The record is in the table in [README.md](README.md).
