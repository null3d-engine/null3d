# D-83: The owner's rulings on the M1 gate

Status: decided by the owner. M1 is closed: full CI run 37542830381 passed on the final main commit. Task: M1-K5.

Summary: The M1 gate holds on commit fdf14a28, where only the items that failed or gave no valid result ran again. T-28's cold-start target on the S24+ is 5.5 s, and Safari's memory fix, the shadow trail fix and the browser fixes in progress are part of the gate. The gate accepts the iPad's rise in S4's GPU time at Low, which is mostly the receiver plane of #257.

## Question

On the first gate commit 89a1d6295 (#321), most items of the M1 gate pass. One check fails on a known cause, and some device runs give no valid result. The S24+'s cold start misses its target by 32 and 57 ms. Must every item run again on a commit with the fix? Does the cold start fail item 5? The shadows trail the cars in S4 at Low: does their fix belong in the gate? The iPad's GPU time on fdf14a28 is 8% above the older commit: does the gate pass with it? Safari on the iPhone and the iPad keeps the memory of old engines until new engines meet E1109: is its fix part of the gate? And do the other browser fixes in progress join it?

## Rule

The owner decides. [Releases](../releases.md#m1-exit-gate) says that every item must hold on one gate commit. [D-06](D-06-success-targets.md#time-to-first-frame-t-28) sets T-28's targets on the S24+ in Chrome on Slow 4G. The first frame comes within 1 s on a warm load, and on a cold load within the target of ruling 2.

## Data

| Measure | Figure | Source |
| --- | --- | --- |
| S4's allocation on WebGL2, Chrome on the Mac | The governor's judge step allocates 4.1 bytes per frame against its budget of 4, and 4.6 at most. The cause is the float arrays that #318 put in the governor. #335 keeps the governor's times in 32-bit integers | [Releases](../releases.md#results-on-the-gate-commit-89a1d6295) |
| The iPad's 30-minute soaks | 12 of 12 passed, with no GPU loss and no memory growth. But the frame rate fell to 14.8 fps on WebGPU and 32.2 fps with WebGL2, against 59.1 and 53.3 on 5309dba5. GPU time per frame stayed at 13 to 14 ms | [Releases](../releases.md#results-on-the-gate-commit-89a1d6295) |
| The iPad's GPU time comparison, second round | Every leg ran below 30 fps, the older commit as slowly as the gate commit, so no leg counts | [Releases](../releases.md#results-on-the-gate-commit-89a1d6295) |
| Firefox and Safari on the Mac | 825 of 831 passed in each. Firefox failed the room environment on WebGL2 and one GPU timing page. Safari failed two sprite pages, on a Safari 26 fault that hangs the GPU, and four engine start pages, because the screen locked. Those four passed again with the display awake | [Releases](../releases.md#results-on-the-gate-commit-89a1d6295) |
| T-28 cold start, S24+, pipelined, median of 5 | 4,895 ms on 5309dba5. 4,439 to 4,489 ms on the cold-load fix with #306. 4,532 and 4,557 ms on the gate commit, in two runs. Warm 945 ms in both | [Releases](../releases.md#t-28-the-cores-download) |
| The start's cost per KB | On Slow 4G, each KB taken off the start saves about 6.5 ms on the S24+ | [Releases](../releases.md#t-28-the-cores-download) |

## Decision

| # | Ruling | Recorded in |
| --- | --- | --- |
| 1 | The gate commit is a newer main commit that holds the governor's allocation fix (#335). Only the items that failed, or that gave no valid result, run again there. The items that passed keep their results from 89a1d6295. The iPad items that ran before the cold-load fix keep theirs from 03a1ad198, which differs from 89a1d6295 only in how the start's download begins | [Releases](../releases.md#the-owners-rulings-on-the-gate) |
| 2 | T-28's cold-start target on the S24+ in Chrome on Slow 4G is 5.5 s. The warm target is 1 s. So the gate commit's 4,532 and 4,557 ms pass | [D-06](D-06-success-targets.md#time-to-first-frame-t-28), [Releases](../releases.md#the-owners-rulings-on-the-gate) |
| 3 | Replaced by ruling 6 (Options rejected) | [Releases](../releases.md#results-on-the-gate-commit-89a1d6295) |
| 4 | The fix for the memory that piles up in Safari on the iPhone and the iPad (#352) is part of the gate. Safari keeps the memory of engines whose drawing worker stays with the canvas, so new engines meet E1109. The gate needs #352 merged, then device evidence on that main: the cloud iPhone 16 runs the 12 engine pages that fail without it, and the owner's iPad runs its test pages without a Safari restart | [Releases](../releases.md#the-gate-commit) |
| 5 | The browser fixes for memory, speed and faults that are in progress at the ruling join the gate, and new features wait. The gate's final pass runs on the main commit of the last of these merges | [Releases](../releases.md#the-gate-commit) |
| 6 | The fix for the shadows that trail the cars in S4 at Low is part of the gate. At Low, the far cascade draws only every few frames, so it lags moving casters. The fix keeps a cached far layer. The gate needs its pull request merged, then a check on the owner's iPad after the gate's soak and GPU time comparison: S4 by eye, then a timing of main against the cache | [Releases](../releases.md#the-gate-commit) |
| 7 | The iPad's GPU time of S4 at Low on WebGPU is a gate item. On fdf14a28 it is 0.83 ms (8%) above the older commit f46c0686, with the same 56 draw calls per frame. Ruling 13 settles it | [Releases](../releases.md#the-gate-commit) |
| 8 | The shadow fix's cost on the owner's iPad is accepted: S4 at Low on WebGPU takes about 0.3 ms more per frame with #359 (11.70 to 11.73 ms against main's 11.42 ms), with 63 draw calls against 56. This cost stays apart from the rise of ruling 7 | [Releases](../releases.md#the-gate-commit) |
| 9 | To win back the iPad's GPU time, the cascade blend may become cheaper, as long as it looks the same | [Releases](../releases.md#the-gate-commit) |
| 10 | The coordinator may finish the gate without the owner. It starts a full CI run on the final main commit, then merges the gate's records and marks M1 done. If anything fails or needs judgement, it stops and leaves a summary for the owner | [Releases](../releases.md#the-gate-commit) |
| 11 | The receiver plane of #257 may get a rewrite of its math, as long as it looks the same. On the iPad the plane costs 1.19 ms per frame in S4 at Low, which is more than the whole rise | [Releases](../releases.md#the-gate-commit) |
| 12 | If that rewrite wins back most of the cost but not all, the rest is accepted as #257's cost, and the gate's GPU time item closes after the rewrite's iPad run | [Releases](../releases.md#the-gate-commit) |
| 13 | The gate accepts the iPad's GPU time and closes the item. The rewrite of the receiver plane (#371) wins back only about 0.1 ms. With #371, main takes 1.42 ms (15%) more than the gate's older build on the iPad: about 1.1 ms for #257's receiver plane, which the owner keeps, and about 0.3 ms for #359 (ruling 8). S4 at Low still holds 60 fps with about a third of the frame spare. M2-R25 looks for why the receiver plane costs so much on Apple GPUs, and for a cheaper method ([D-169](D-169-anti-acne-plane-cost.md)) | [Releases](../releases.md#reruns-on-the-gate-commit-fdf14a28) |
| 14 | M1 closes when a full CI run on the final main commit passes. Run 37498466285 on 74d5f4956 failed Safari's first shard twice, on E1302 and then E1109, and its rerun 37542830381 passed. Safari's failures in CI that come and go are a known problem. M2-R26, a high-priority task, looks at whether Safari's shared memory area fragments | [Releases](../releases.md#the-gates-final-pass) |

The items that run again on the gate commit:

- S4's allocation on WebGL2, Chrome on the Mac.
- The iPad's soak plan, on a cool iPad.
- The iPad's GPU time comparison of S4 at Low against the older commit f46c0686, on a cool iPad.
- Firefox and Safari on the Mac, after the fixes for their failures merge.

The coordinator chose the gate commit fdf14a28. It is the first main commit that holds #347, which keeps the refresh meter's frame tick free of allocation. Without #347, S4's allocation on WebGL2 fails. That commit also holds #335. Firefox and Safari run again on the main commit that holds the fixes for their failures, and their rows name that commit.

## Options rejected

- Run every item again on the gate commit. A full run of the gate takes about 5 hours of device time and 70 minutes of a quiet Mac. The fixes in #335 and #347 change only the governor's time keeping and the refresh meter's frame tick. So the items that passed have no reason to change.
- Keep the 4.5 s target and take more bytes off the start. The 57 ms miss needs about 9 KB less. The start grows with each feature, and about 2 KB more would miss again.
- Leave the shadows that trail the cars in S4 at Low out of the gate, with their fix in M2. This was ruling 3, and ruling 6 takes the fix into the gate instead.
- Hold the gate until the iPad's rise in GPU time is found and fixed (ruling 7). The rewrite of the receiver plane wins back only about 0.1 ms, so ruling 13 accepts the rest as the cost of #257 and #359.

## Consequences

- [Releases](../releases.md#the-owners-rulings-on-the-gate) lists the items that run again on the gate commit.
- D-06's T-28 target points to this record.
- The S24+'s T-28 rows on the gate commit read as a pass.
- The gate's final pass runs on the main commit of the last browser fix to merge.
- M2-R26, a high-priority task, covers Safari's failures in CI that come and go ([D-92](D-92-safari-removed-frames.md), [D-94](D-94-memory-retry-window.md)).
- M2-R25 looks for why the receiver plane of #257 costs about 1.1 ms on Apple GPUs, and for a cheaper method ([D-169](D-169-anti-acne-plane-cost.md)).
