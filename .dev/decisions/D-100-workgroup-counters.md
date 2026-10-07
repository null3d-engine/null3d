# D-100: The culling shader counts each workgroup's survivors before it adds to the indirect draws

Status: proposed. Date: 8 October 2026. Task: M2-I5. The Mac's run of prototype G2 is in. The runs on the Galaxy S25, the Pixel 9 and the iPads are pending.

Summary: Each workgroup of the culling shader counts its visible instances per bucket in workgroup memory. One thread per bucket then adds the workgroup's count to each of the bucket's indirect draws. Before, every visible instance added 1 to the same word, one thread after another. On the Mac the culling pass of 240,000 boxes went from 0.62 ms to 0.14 ms in S1, and from 0.37 ms to 0.10 ms in S1-static. The phones' and tablets' figures of prototype G2 are pending.

## Question

How should the culling shader count the visible instances of each bucket? In S1-static, all 240,000 boxes are in one bucket, so every visible box added 1 to one word of the indirect draws with an atomic add. A bucket with several mesh parts added 1 to each part's word too. Qualcomm, Arm and Apple advise against many threads adding to one address, and advise a count per workgroup first.

## Rule

Prototype G2: `bun run bench:run --compare` with S1 and S1-static at 240,000 boxes on WebGPU, 10 rounds on the Mac, and runs on the owner's iPad and an Android WebGPU phone. The change stays when the culling pass is faster on one device and slower on none. The images must stay the same.

## Data

The culling pass is the frame's one compute pass in these scenes. Each figure is the median of the runs' medians of GPU time per frame. The change is the median over rounds of the branch's run against main's.

| Measure | Main (one add per instance) | Workgroup counts | Change | Device and browser |
| --- | --- | --- | --- | --- |
| Culling pass, S1 | 0.615 ms | 0.142 ms | -77% | Mac (M5 Max), Chrome 155 |
| Culling pass, S1-static | 0.371 ms | 0.103 ms | -72% | Mac (M5 Max), Chrome 155 |
| Whole frame's GPU time, S1 | 4.784 ms | 4.543 ms | -5% | Mac (M5 Max), Chrome 155 |
| Whole frame's GPU time, S1-static | 3.138 ms | 2.839 ms | -9% | Mac (M5 Max), Chrome 155 |

- The culling pass was faster in each of the 10 rounds of both scenes. Main's slowest round took 0.79 ms in S1 and the branch's 0.14 ms.
- In S1, main's render passes took 3.5 to 4.0 ms by round, and the branch's 4.0 ms in each round. Main's rounds with the faster render passes also had its fastest culling, 0.56 ms against 0.79 ms. So the GPU ran at a higher clock speed in those rounds, with more work to do. In the rounds that ran at the same speed, the render passes took the same time on both builds, so the order of instances in the slices costs nothing.
- The CPU figures did not change: the comparison judged both pages the same.

How the data was produced: `bun run bench:run --compare <main>,<branch> --scenes s1,s1-static --pages null3d-webgpu --switches n=240000 --runs 10 --seconds 5` in a quiet window on 8 October 2026, 00:44 to 00:51, at 120 Hz. Main was efead8b5d and the branch 2ed8971bc. One run of the branch in S1 was dropped, as it measured 125 Hz. The run's record is `bench/results/20261007-164404-compare.json`, which keeps each run's GPU time per pass from this change on.

## Options weighed

- One atomic add per visible instance, as before. It is the simplest, and it is the baseline of G2.
- A count per workgroup, and one add per bucket in each workgroup (chosen if G2 passes). A workgroup holds a table of 128 slots, one per thread, in workgroup memory. A bucket takes the slot at its index modulo 128, or the next free one after it, so the table never fills. Each thread counts itself in its bucket's slot. The thread that took the slot adds the count to each draw of the bucket, and the add on the first draw gives the workgroup its place in the bucket's slice. Each thread then writes its instance at that place plus its own count. The table takes 1.5 KiB of the 16 KiB of workgroup memory that every device allows. Each thread clears its own slot first, because PowerVR GPUs may not zero workgroup memory.
- A count per workgroup on the first draw only, and a second pass that copies each bucket's count to its other parts' draws. The task first named this pass. It adds a dispatch, a pipeline and a bind group to each view's culling, and a barrier before the draws. The slot's owner already adds to each part's draw once per workgroup, so the other parts see the same few adds as the first. A copy pass would remove only those adds, so it was not built.
- Subgroup operations, which count without workgroup memory. They are an optional WebGPU feature, so they need a capability check and this path as the fallback anyway.

## Decision

Pending the figures of G2.

## Consequences

- `bench/lib/archive.ts`: each archived run keeps its median GPU time per pass, so a record holds the culling pass's figures that this record cites.
- `crates/null3d-shaders/wgsl/cull.wgsl`: `main`, `early` and `late` call one `append` from every thread. A thread whose instance does not draw passes no bucket, because the workgroup's barriers need every thread.
- The order of instances within a bucket's slice was already not fixed between frames, so no image changes. The image tests on WebGPU and compatibility mode passed 473 of 473 on the Mac's GPU, with both checks that occlusion culling draws what culling without it draws.
- The occlusion phases' shader file, which loads on first use, grows from 4,049 to 4,502 bytes after Brotli (+11.2%). The start shader files grow by 1.1% to 1.3%.
