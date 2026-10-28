# D-247: An offset allocator for GPU sub-ranges, and why the engine keeps its repack placement

Status: decided by the helper of M3-R4, for the owner's review. Built: the offset allocator in `crates/null3d-render/src/offset_alloc.rs`, its unit tests, a comparison test against the engine's repack placement, and a cost page. The cost page measures a hole-closing removal frame against a frame that cuts a page's end. No renderer path places meshes with the allocator. The cheap frame models the allocator's free, as "Frame time" says. Task: M3-R4.

Summary: The engine's mesh pages keep their append-and-repack placement. On one churn workload, Aaltonen's allocator moves no bytes where the repack placement moves 10.3 MiB for each removed model. A hole-closing frame costs 2.0 ms of the render worker and 73.6 MB of upload more than a modelled free frame on WebGPU. On WebGL2 the gap is 0.1 ms and 2.2 MB. But the allocator holds its buffer's peak for the life of the page: 21.08 MB against 16.86 MB when the live set shrinks.

## Question

Should the engine place ranges inside its large GPU buffers with Sebastian Aaltonen's offset allocator? That allocator places a range in constant time and moves nothing. The ranges are instance rows, staging ranges and per-model ranges.

## Rule

Adopt the allocator only when both hold:

1. A frame that a placement touches costs at least 1 ms of the render worker on the Mac's GPU. The scene also removes a range at least once a second.
2. The allocator holds under 5% more memory than the repack placement when the scene shrinks. Or it can give a buffer's end back without a copy.

## Data

The workload holds 48 models of 600 to 24,000 vertices. A vertex takes 24 bytes and an index takes 2 bytes. Twelve rounds each remove the oldest 30% and add the same number of new models. So 168 models leave and 168 arrive after the 48 that start. Both placements meet the same sizes in the same order. The index pool gives whole 4-byte words.

| Measure | Repack placement | Offset allocator | How measured |
| --- | --- | --- | --- |
| Bytes moved by removals | 1,811,591,028 (1,727.7 MiB) | 0 | `offset_placement` test, native release, 5 trials |
| Time of the 384 placements and removals | 40.94 ms (median of 40.82, 40.86, 40.94, 41.01, 41.07) | 8.46 µs (median of 7.29, 8.45, 8.46, 8.50, 8.96) | The same test, `std::time::Instant` |
| Bytes moved by one removal | 10.3 MiB | 0 | The copy total divided by the 168 removals |
| Memory held at the end | 16,857,048 bytes | 21,081,684 bytes | The repack placement's page bytes; the allocator's smallest buffer that completes the workload |
| Memory held at the peak | 20,784,192 bytes | 21,081,684 bytes | The same |
| Free space at the end | 0 bytes, because the page packs | 4,224,636 bytes, largest free range 3,485,376 bytes | The allocator's report |

The allocator's least buffer is the repack placement's peak plus 1.43%. The size classes waste up to an eighth of a class, and the holes that the workload leaves need room. A buffer sized at the peak alone fails. A request of 19,854 units then met a largest free range of 11,442 units.

The 40.94 ms is the whole workload's 384 placements and removals, not one frame. One removal moves 10.3 MiB and takes about 0.24 ms of native time.

### Frame time

`tests/image/mesh-churn-cost.spec.ts` measures a frame of steady churn on the Mac's GPU. The page keeps 240 spheres live in every window and replaces one model each frame, so every window draws the same work. It measures three windows of each kind in turns, and each window lasts 1.2 s.

The oldest model's range sits before the others in its page. Its removal closes a hole, so every mesh after it moves, and the render worker uploads those bytes again. The newest model's range sits at the page's end. Its removal cuts the page's end, so nothing moves.

| Window, WebGPU at Low | Render worker | Sketch worker | Upload | Interval |
| --- | --- | --- | --- | --- |
| Idle | 0.240 ms | 0.016 ms | 11,220 B | 16.67 ms |
| Replace the oldest model | 2.432 ms | 2.566 ms | 76,070,950 B | 16.67 ms |
| Replace the newest model | 0.388 ms | 0.796 ms | 2,500,214 B | 16.67 ms |

| Window, WebGL2 at Low | Render worker | Sketch worker | Upload | Interval |
| --- | --- | --- | --- | --- |
| Idle | 0.167 ms | 0.038 ms | 7,538 B | 16.67 ms |
| Replace the oldest model | 0.338 ms | 1.058 ms | 2,676,175 B | 16.67 ms |
| Replace the newest model | 0.221 ms | 0.950 ms | 501,007 B | 16.67 ms |

On WebGPU all 240 models share one page of about 77 MB, and a removal near the page's start moves nearly all of it. On WebGL2 a page holds 8 models, about 2.6 MB, and a removal moves about seven eighths of one page.

The additions' bytes upload in both churn windows, so they cancel in the difference. A hole-closing frame costs 2.044 ms more of the render worker and 1.770 ms more of the sketch worker's own code. It also uploads 73,570,736 bytes more than a frame that cuts the page's end on WebGPU. On WebGL2 it costs 0.117 ms, 0.107 ms and 2,175,168 bytes more.

The second churn window is modelled on an allocator's free, not run with the allocator. It removes the newest range, which moves no bytes, and an allocator's free does the same. Its placement side is today's append, not the allocator's placement in a hole. The allocator does not run in any frame. The mesh storage appends into pages that grow and shrink. A page that an allocator fills keeps a fixed capacity that the storage does not keep.

The allocator's own placement and free take 8.46 µs for 384 operations in native code, or about 22 ns each. That is below what a frame measurement can resolve.

## Where the churn comes from

The workload is synthetic. It holds 48 models at once and replaces 30% of them in each of 12 rounds. No shipped scene removes meshes at that rate.

The engine's own paths that remove a mesh, and what each does:

- A prefab or asset unload frees every mesh of the model in one call. This is a level transition or an eviction, so one frame pays the repack of the page's tail.
- The terrain add-on destroys a block's mesh when a block has waited past its limit. Blocks are small grids, the default limit is 512, and one update frees a few.
- The splats add-on selects chunks each time the camera or the budget changes. It rewrites the splats of one mesh that already exists, so it adds and removes no mesh.
- The Battle and Factory comparison scenes make and destroy 400 objects and 250 cells in a frame. They destroy objects, and their meshes stay.

So a steady scene never pays the copy. A frame pays it in two cases: a level transition that unloads a prefab, or a scene that destroys many models in one frame. The cost page removes one model in each frame, which no shipped scene does.

The published allocator refuses a request of 100 units when a free range of 100 units exists. The request rounds up to the next size class, and the range rounds down to this one. This implementation keeps the constant-time bin search. It adds a pass over the free ranges when that search fails, so a refusal means that no free range fits. Only a request that would otherwise fail pays the pass.

The frame figures come from the cost page in a quiet window. [The Mac run](../tested-devices/macbook-pro-m3-max-chrome/20261028-131156-mesh-churn.md) gives the commit, the browser, the load and the conditions. The native figures come from the test's timed run.

## Decision

The engine keeps the repack placement. The memory rule fails. The allocator holds 25% more at the end, 21.08 MB against 16.86 MB, and it cannot give a buffer's end back without a copy. Neither half of rule 2 holds.

Rule 1 holds on WebGPU and not on WebGL2. A hole-closing frame costs 2.044 ms more of the render worker than the modelled free frame, which clears the 1 ms bar. On WebGL2 it costs 0.117 ms more, because its pages hold 8 models. The rule's second sentence still decides the case: no shipped scene removes a range at least once a second.

A tenth of the workload is 4.1 ms. One frame reaches that by removing about 17 models of 10.3 MiB, or by unloading a prefab whose pages hold about 175 MiB. Nothing that ships does the first. Dynamic units use instance batches, whose rows share one mesh. The second is a level transition.

- The allocator holds the buffer's peak for the life of the page. The extra 4.22 MB is retention, not a leak. The buffer is reserved once at the workload's peak. A range that leaves returns to the free list inside that buffer. A buffer cannot shrink without a copy. The gap grows with the peak: a scene that peaks at 500 MB would keep 500 MB after it shrinks. The repack placement gives memory back.
- A hole-closing removal of a 77 MB page costs 2.0 ms of the render worker. A level transition or a streamed eviction pays this once. A steady scene pays nothing.
- Placement, staging and instance rows have no such hole. The staging ring resets every frame. Instance rows live in each batch's own arrays until the culling pass compacts them. The allocator would add work there, not remove it.
- The engine would carry two placements: the allocator for pages, and the repack that other lists still need. Those lists hold joint spheres, morph reaches and a split mesh's sources.

Adopt the allocator in two cases. First, a measured scene removes models often enough that the copy shows in a frame. Second, the engine can grow a page's buffer without a copy, such as with a page of fixed chunks that it adds at the end. The comparison test and the cost page rerun the figures then.

## Consequences

- `offset_alloc.rs` holds the allocator. Its unit tests cover constant-time placement, merging on free and exact refusal. One test runs 20,000 steps and checks that every unit is placed once.
- `crates/null3d-render/tests/offset_placement.rs` compares both placements on the same workload. Its timed test runs with `--ignored`.
- `tests/pages/mesh-churn-cost.ts` and its spec measure a hole-closing frame and a frame that cuts a page's end on a real GPU. They run behind `NULL3D_MESH_CHURN_COST`. The second frame models the allocator's free, because no renderer path places meshes with the allocator.
- No shipping path, public API or docs page uses the allocator. The allocator's own frame is not measured, and a branch adopts it only with a renderer path that fills a page's holes.
