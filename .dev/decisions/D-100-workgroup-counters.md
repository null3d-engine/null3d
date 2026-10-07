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
| Culling pass, S1 | 2.228 ms | 1.049 ms | -53% | Galaxy S25 (Adreno 830), Chrome 152 |
| Culling pass, S1-static | 0.885 to 0.918 ms | 0.918 ms | Same, within one step of the timer | Galaxy S25 (Adreno 830), Chrome 152 |
| Whole frame's GPU time, S1 | 18.45 to 18.48 ms | 17.30 ms | -6% | Galaxy S25 (Adreno 830), Chrome 152 |
| Whole frame's GPU time, S1-static | 9.47 to 9.54 ms | 9.57 ms | Same | Galaxy S25 (Adreno 830), Chrome 152 |

- The culling pass was faster in each of the 10 rounds of both scenes. Main's slowest round took 0.79 ms in S1 and the branch's 0.14 ms.
- In S1, main's render passes took 3.5 to 4.0 ms by round, and the branch's 4.0 ms in each round. Main's rounds with the faster render passes also had its fastest culling, 0.56 ms against 0.79 ms. So the GPU ran at a higher clock speed in those rounds, with more work to do. In the rounds that ran at the same speed, the render passes took the same time on both builds, so the order of instances in the slices costs nothing.
- The CPU figures did not change: the comparison judged both pages the same.
- On the Galaxy S25, the timer gives GPU times in steps of about 0.033 ms. The culling pass in S1 took the same time in every run of each build. In S1-static the two builds' runs took the same two values, 0.852 and 0.918 ms.
- The S25's render passes took the same time on both builds, so the order of instances in the slices costs nothing there either.

How the data was produced, on the Mac: `bun run bench:run --compare <main>,<branch> --scenes s1,s1-static --pages null3d-webgpu --switches n=240000 --runs 10 --seconds 5` in a quiet window on 8 October 2026, 00:44 to 00:51, at 120 Hz. Main was efead8b5d and the branch 2ed8971bc. One run of the branch in S1 was dropped, as it measured 125 Hz. The run's record is `bench/results/20261007-164404-compare.json`, which keeps each run's GPU time per pass from this change on.

On the Galaxy S25, through BrowserStack Automate on 8 October 2026, 01:04 to 01:40: `bun tests/real-browsers.ts --plan bench --scenes s1,s1-static --pages null3d-webgpu --runs 3 --n 240000 --cloud bsgalaxys25-chrome`, 4 times, in the order main, branch, branch, main. The runs are `20261007-170521-bench`, `20261007-171416-bench`, `20261007-172307-bench` and `20261007-173144-bench`. Its screen ran at 30 Hz, so only the GPU times count.

## Options weighed

- One atomic add per visible instance, as before. It is the simplest, and it is the baseline of G2.
- A count per workgroup, and one add per bucket in each workgroup (chosen if G2 passes). A workgroup holds a table of 128 slots, one per thread, in workgroup memory. A bucket takes the slot at its index modulo 128, or a free one in one of two more turns (see "Safari 27.0 and the slot claim"). Each thread counts itself in its bucket's slot. The first thread to count itself adds the count to each draw of the bucket, and the add on the first draw gives the workgroup its place in the bucket's slice. Each thread then writes its instance at that place plus its own count. The table takes 1.5 KiB of the 16 KiB of workgroup memory that every device allows. Each thread clears its own slot first, because PowerVR GPUs may not zero workgroup memory.
- A count per workgroup on the first draw only, and a second pass that copies each bucket's count to its other parts' draws. The task first named this pass. It adds a dispatch, a pipeline and a bind group to each view's culling, and a barrier before the draws. The slot's owner already adds to each part's draw once per workgroup, so the other parts see the same few adds as the first. A copy pass would remove only those adds, so it was not built.
- Subgroup operations, which count without workgroup memory. They are an optional WebGPU feature, so they need a capability check and this path as the fallback anyway.

## Safari 27.0 and the slot claim

The first form claimed a slot with `atomicCompareExchangeWeak` on workgroup memory. On 8 October 2026, every page of that build failed on a BrowserStack iPad with Safari 27.0: the bench pages with E1404 (a pipeline failed to build) and the image pages with E1408. The Metal compiler rejected WebKit's translation of the shader: "field may not be qualified with an address space ... in instantiation of template class `__atomic_compare_exchange_result<thread unsigned int>`". Main's build passed 8 of 8 pages on the same iPad.

The cause is in WebKit. For each shader that calls `atomicCompareExchangeWeak`, WebKit's Metal writer (`Source/WebGPU/WGSL/Metal/MetalFunctionWriter.cpp`, `emitNecessaryHelpers`) adds a helper. The helper returns `__atomic_compare_exchange_result<decltype(compare)>`, where `compare` is a parameter passed by value. The Metal compiler of the 27 releases gives that parameter the type `thread unsigned int`, and a struct field may not name an address space. So the fault hits compare-exchange on storage memory too, not only on workgroup memory. A public report shows the same error on a storage buffer (github.com/sbobyn/three-avbd issue 1). The helper took this form in March 2025 (WebKit commit bc4c25359fd4, bug 290327). Safari 26 compiles it, because its Metal compiler is older. A test compile of the old helper with the Metal compiler of macOS 26.6.2 also passed. So the Mac, which runs macOS 26, cannot show the fault.

WebKit fixed the helper on 13 September 2026 (commit 4f56cc248e8a, 321006@main), inside bug 323873, a general fix of failing conformance tests. No WebKit bug names this error. The fix is in Safari Technology Preview 253. It is not in Safari 27.0: WebKit's public branches for that release still hold the old line. Whether Safari 27.2 has it is not known yet. No report was filed (owner's call).

WebKit writes each other atomic built-in as one plain Metal call with no helper: `atomicAdd`, `atomicSub`, `atomicMin`, `atomicMax`, `atomicAnd`, `atomicOr`, `atomicXor`, `atomicExchange`, `atomicLoad` and `atomicStore`. Main's shaders use only `atomicAdd`, `atomicLoad` and `atomicStore`, on storage and on workgroup memory (`light_clusters.wgsl`), and they pass on Safari 27.0. `workgroupUniformLoad` on an atomic has a helper of its own and an open WebKit bug (297627), so the engine does not use that either.

So the claim now uses atomic loads and stores alone, the operations that main already runs on Safari 27.0. Each turn has two steps with a barrier between them. A thread whose bucket has no slot yet stores its bucket into its slot if the slot is free. After the barrier, it reads which bucket the slot holds. A slot that holds a bucket never changes again, because a thread stores only into a slot that it read as free. So no store in a later turn can change a slot that a thread reads in the turn before, and one barrier per turn is enough. The threads of one bucket always try the same slot and read the same bucket there, so they settle together, and the first of them to count itself in the slot adds the slot's count to the draws.

The table holds 128 slots, and a workgroup can name 128 buckets at most. So the earlier form, which tried slots until one was free, always settled. Loads and stores cannot end a loop that runs a different number of turns in different threads, because each turn needs a barrier that every thread of the workgroup reaches. The loop therefore runs a fixed 3 turns, and a bucket that is still without a slot adds its instances to the draws one by one, as main does. Its threads then cost what they cost on main, and the result is the same. Two buckets want one slot only when their numbers differ by a multiple of 128. A bucket that loses its slot tries the slot 65 places on, not the next one, because buckets numbered next to each other often share a workgroup and would hold the next slot. The first form ran 3 barriers per workgroup, and this one runs 6, one more for each turn.

Other claims weighed:

- `atomicMin` or `atomicMax` on a key of the turn and the bucket, so that a slot settled in an earlier turn wins over later claims. It works, but needs the same turns and barriers, and main runs neither operation on Safari.
- `atomicExchange`, as three-avbd used. An exchange always writes, so a thread can overwrite a slot that another bucket already holds. It needs a way to put the other bucket back, which brings back a loop of turns of its own.
- The claim on a storage-buffer atomic. The fault is the same on storage memory, and storage atomics cost more than workgroup ones.
- A loop that ends when every bucket has a slot. It needs every thread to read a shared flag the same way, which takes `workgroupUniformLoad` of a flag and one more barrier in every turn. A flag that several threads write without atomics is a data race in WGSL.
- A test at start-up that builds a pipeline with `atomicCompareExchangeWeak`, and the old form where it compiles. It adds a pipeline build to every start, and two forms of the shader to test.

The shader build now rejects `atomicCompareExchangeWeak` in every shader, the engine's and users' alike, with the reason and the forms that compile (`crates/null3d-shaders/src/features.rs`, `docs/shaders/wgsl-rules.md`). A test in the shader crate checks the rule. Users' shaders would fail on Safari 27.0 the same way, and the build cannot tell which address space a call uses before naga reads the module. The rule can go once the oldest Safari that null3D supports has WebKit's fix.

## Decision

Pending the figures of G2.

## Consequences

- `bench/lib/archive.ts`: each archived run keeps its median GPU time per pass, so a record holds the culling pass's figures that this record cites.
- `crates/null3d-shaders/wgsl/cull.wgsl`: `main`, `early` and `late` call one `append` from every thread. A thread whose instance does not draw passes no bucket, because the workgroup's barriers need every thread.
- The order of instances within a bucket's slice was already not fixed between frames, so no image changes. The image tests on WebGPU and compatibility mode passed 473 of 473 on the Mac's GPU, with both checks that occlusion culling draws what culling without it draws.
- The occlusion phases' shader file, which loads on first use, grows from 4,049 to 4,502 bytes after Brotli (+11.2%). The start shader files grow by 1.1% to 1.3%.
