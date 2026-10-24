# D-247: An offset allocator for GPU sub-ranges, and why the engine keeps today's placement

Status: decided by the helper of M3-R4 on 24 October 2026, for the owner's review. Built: the offset allocator in `crates/null3d-render/src/offset_alloc.rs`, its unit tests, a comparison test against today's mesh placement, and a gated cost page for the Mac's GPU. Date: 2026-10-24. Task: M3-R4. Owed: the Mac GPU frame figure; the cost page is ready and the run did not get a quiet machine.

Summary: The engine's mesh pages keep today's append-and-repack placement. On one churn workload, Aaltonen's allocator moves no bytes where today's placement moves 10.3 MiB for each removed model. But the allocator holds its buffer's peak for the life of the page: 21.08 MB against 16.86 MB when the live set shrinks. It cannot give memory back.

## Question

Should the engine place ranges inside its large GPU buffers with Sebastian Aaltonen's offset allocator? That allocator places a range in constant time and moves nothing. The ranges are instance rows, staging ranges and per-model ranges.

## Rule

Adopt the allocator only when both hold:

1. A frame that a placement touches costs at least 1 ms of the render worker on the Mac's GPU. The scene also removes a range at least once a second.
2. The allocator holds under 5% more memory than today's placement when the scene shrinks. Or it can give a buffer's end back without a copy.

## Data

The workload holds 48 models of 600 to 24,000 vertices. A vertex takes 24 bytes and an index takes 2 bytes. Twelve rounds each remove the oldest 30% and add the same number of new models. So 168 models leave and 168 arrive after the 48 that start. Both placements meet the same sizes in the same order. The index pool gives whole 4-byte words.

| Measure | Today's placement | Offset allocator | How measured |
| --- | --- | --- | --- |
| Bytes moved by removals | 1,811,591,028 (1,727.7 MiB) | 0 | `offset_placement` test, native release, 5 trials |
| Time of the 384 placements and removals | 40.94 ms (median of 40.82, 40.86, 40.94, 41.01, 41.07) | 8.46 µs (median of 7.29, 8.45, 8.46, 8.50, 8.96) | The same test, `std::time::Instant` |
| Bytes moved by one removal | 10.3 MiB | 0 | The copy total divided by the 168 removals |
| Memory held at the end | 16,857,048 bytes | 21,081,684 bytes | Today's page bytes; the allocator's smallest buffer that completes the workload |
| Memory held at the peak | 20,784,192 bytes | 21,081,684 bytes | The same |
| Free space at the end | 0 bytes, because the page packs | 4,224,636 bytes, largest free range 3,485,376 bytes | The allocator's report |

The allocator's least buffer is today's peak plus 1.43%. The size classes waste up to an eighth of a class, and the holes that the workload leaves need room. A buffer sized at the peak alone fails. A request of 19,854 units then met a largest free range of 11,442 units.

The 40.94 ms is the whole workload's 384 placements and removals, not one frame. One removal moves 10.3 MiB and takes about 0.24 ms of native time.

## Where the churn comes from

The workload is synthetic. It holds 48 models at once and replaces 30% of them in each of 12 rounds. No shipped scene removes meshes at that rate.

The engine's own paths that remove a mesh, and what each does:

- A prefab or asset unload frees every mesh of the model in one call. This is a level transition or an eviction, so one frame pays the repack of the page's tail.
- The terrain add-on destroys a block's mesh when a block has waited past its limit. Blocks are small grids, the default limit is 512, and one update frees a few.
- The splats add-on selects chunks each time the camera or the budget changes. It rewrites the splats of one mesh that already exists, so it adds and removes no mesh.
- The Battle and Factory comparison scenes make and destroy 400 objects and 250 cells in a frame. They destroy objects, and their meshes stay.

So a steady scene never pays the copy. A frame pays it in two cases: a level transition that unloads a prefab, or a scene that destroys many models in one frame.

The published allocator refuses a request of 100 units when a free range of 100 units exists. The request rounds up to the next size class, and the range rounds down to this one. This implementation keeps the constant-time bin search. It adds a pass over the free ranges when that search fails, so a refusal means that no free range fits. Only a request that would otherwise fail pays the pass.

The Mac GPU frame figure is owed. The churn page measures it:

```text
cargo test -p null3d-render --release --test offset_placement -- --ignored --nocapture
NULL3D_MESH_CHURN_COST=1 bun run test:browser -- mesh-churn-cost.spec.ts
```

The page and its spec are ready. The run needs a quiet machine, and on 24 October 2026 the computer's load stayed above 19 for the whole wait, so the run failed. The verdict does not rest on the figure: the memory rule already fails.

## Decision

The engine keeps today's placement. The figures fail the memory rule. They also do not show the frame-time need that would overcome it.

A tenth of the workload is 4.1 ms. One frame reaches that by removing about 17 models of 10.3 MiB, or by unloading a prefab whose pages hold about 175 MiB. Nothing that ships does the first. Dynamic units use instance batches, whose rows share one mesh. The second is a level transition.

- The allocator holds the buffer's peak for the life of the page. The extra 4.22 MB is retention, not a leak. The buffer is reserved once at the workload's peak. A range that leaves returns to the free list inside that buffer. A buffer cannot shrink without a copy. The gap grows with the peak: a scene that peaks at 500 MB would keep 500 MB after it shrinks. Today's placement gives memory back.
- The workload's 168 removals and 168 additions took 40.94 ms, or about 0.24 ms for each pair. A removal moves 10.3 MiB. A level transition or a streamed eviction pays this once. A steady scene pays nothing.
- Placement, staging and instance rows have no such hole today. The staging ring resets every frame. Instance rows live in each batch's own arrays until the culling pass compacts them. The allocator would add work there, not remove it.
- The engine would carry two placements: the allocator for pages, and the repack that other lists still need. Those lists hold joint spheres, morph reaches and a split mesh's sources.

Adopt the allocator in two cases. First, a measured scene removes models often enough that the copy shows in a frame. Second, the engine can grow a page's buffer without a copy, such as with a page of fixed chunks that it adds at the end. The comparison test and the cost page rerun the figures then.

## Consequences

- `offset_alloc.rs` holds the allocator. Its unit tests cover constant-time placement, merging on free and exact refusal. One test runs 20,000 steps and checks that every unit is placed once.
- `crates/null3d-render/tests/offset_placement.rs` compares both placements on the same workload. Its timed test runs with `--ignored`.
- `tests/pages/mesh-churn-cost.ts` and its spec measure a removal frame and an addition frame on a real GPU. They run behind `NULL3D_MESH_CHURN_COST`.
- No shipping path changes. No public API and no docs page change, because the renderer does not use the allocator yet.
