# D-83: The owner's rulings on the M1 gate, 6 October 2026

Status: decided by the owner, Singapore time: rulings 1 to 10 on 2026-10-06, rulings 11 and 12 late that night, and rulings 13 and 14 on 2026-10-07. Date: 2026-10-06. Task: M1-K5.

Summary: The gate commit moved to fdf14a28, where only the failed and invalid items ran again. T-28's cold-start target on the S24+ became 5.5 s, and Safari's memory fix, the shadow trail fix and that day's browser fixes joined the gate. The iPad's rise in S4's GPU time at Low was accepted after the receiver plane's rewrite won back about 0.1 ms.

## Question

The M1 gate ran on the night of 5 to 6 October 2026, on the gate commit 89a1d6295 (#321). Most items passed. One check failed on a known cause, and some device runs gave no valid result. The S24+'s cold start missed its target by 32 and 57 ms. Must every item run again on a commit with the fix? Does the cold start fail item 5? The owner also saw the shadows trail the cars in S4 at Low. Does their fix belong in the gate? Then the iPad's GPU time on fdf14a28 came in 8% above the older commit. Does the gate pass with it? Last, Safari on the iPhone and the iPad kept the memory of old engines until new engines met E1109. Is its fix part of the gate? And do the other browser fixes in progress that day join it?

## Rule

The owner decides. [Releases](../releases.md#m1-exit-gate) says that every item must hold on one gate commit. [D-06](D-06-success-targets.md#addendum-2026-09-30-time-to-first-frame-t-28) set T-28's targets on 30 September 2026, on the S24+ in Chrome on Slow 4G. The first frame comes within 4.5 s on a cold load and within 1 s on a warm load.

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
| 1 | The gate commit moves to a newer main commit that holds the governor's allocation fix (#335). Only the items that failed, or that gave no valid result, run again there. The items that passed keep their results from 89a1d6295. The iPad items that ran before the cold-load fix keep theirs from 03a1ad198, which differs from 89a1d6295 only in how the start's download begins | [Releases](../releases.md#the-owners-rulings-of-6-october-2026) |
| 2 | T-28's cold-start target on the S24+ in Chrome on Slow 4G is 5.5 s, up from 4.5 s. The warm target stays at 1 s. So the gate commit's 4,532 and 4,557 ms pass | [D-06](D-06-success-targets.md#addendum-2026-09-30-time-to-first-frame-t-28), [Releases](../releases.md#the-owners-rulings-of-6-october-2026) |
| 3 | Replaced by ruling 6. First ruling: the shadows that trail the cars in S4 at Low do not hold back the gate, and their fix lands in M2 | [Releases](../releases.md#results-on-the-gate-commit-89a1d6295) |
| 4 | The fix for the memory that piles up in Safari on the iPhone and the iPad (#352) is part of the gate. Safari kept the memory of engines whose drawing worker stays with the canvas, so new engines met E1109. The gate needs #352 merged, then device evidence on that main: the cloud iPhone 16 runs the 12 engine pages that failed before, and the owner's iPad runs its test pages without a Safari restart | [Releases](../releases.md#what-the-gate-still-needs) |
| 5 | The browser fixes for memory, speed and faults that are in progress on 6 October join the gate. New features wait for the next week. The gate's final pass runs on the main commit of the last of these merges | [Releases](../releases.md#what-the-gate-still-needs) |
| 6 | The fix for the shadows that trail the cars in S4 at Low is part of the gate, and it replaces ruling 3. At Low, the far cascade draws only every few frames, so it lags moving casters. The fix keeps a cached far layer, on fix/shadow-trail. The gate needs its pull request merged, then a check on the owner's iPad after the gate's soak and GPU time comparison: S4 by eye, then a timing of main against the cache | [Releases](../releases.md#what-the-gate-still-needs) |
| 7 | The gate holds on the iPad's GPU time of S4 at Low on WebGPU. On fdf14a28 it is 0.83 ms (8%) above the older commit f46c0686, with the same 56 draw calls per frame. That rise must be found and fixed before the gate passes | [Releases](../releases.md#what-the-gate-still-needs) |
| 8 | The shadow fix's cost on the owner's iPad is accepted: S4 at Low on WebGPU takes about 0.3 ms more per frame with #359 (11.70 to 11.73 ms against main's 11.42 ms), with 63 draw calls against 56. This cost stays apart from the rise of ruling 7 | [Releases](../releases.md#what-the-gate-still-needs) |
| 9 | To win back the iPad's GPU time, the cascade blend may become cheaper, as long as it looks the same | [Releases](../releases.md#what-the-gate-still-needs) |
| 10 | The coordinator may finish the gate without the owner. It starts a full CI run on the final main commit, then merges the gate's records and marks M1 done. If anything fails or needs judgement, it stops and leaves a summary for the owner | [Releases](../releases.md#what-the-gate-still-needs) |
| 11 | The receiver plane of #257 may get a rewrite of its math, as long as it looks the same. On the iPad the plane costs 1.19 ms per frame in S4 at Low, which is more than the whole rise | [Releases](../releases.md#what-the-gate-still-needs) |
| 12 | If that rewrite wins back most of the cost but not all, the rest is accepted as #257's cost, and the gate's GPU time item closes after the rewrite's iPad run | [Releases](../releases.md#what-the-gate-still-needs) |
| 13 | The gate accepts the iPad's GPU time and closes the item. The rewrite of the receiver plane (#371) won back only about 0.1 ms. With #371, main takes 1.42 ms (15%) more than the gate's older build on the iPad: about 1.1 ms for #257's receiver plane, which the owner keeps, and about 0.3 ms for #359 (ruling 8). S4 at Low still holds 60 fps with about a third of the frame spare. A new M2 task, proposed as M2-R25 for the owner to confirm, finds why the receiver plane costs so much on Apple GPUs, and a cheaper method | [Releases](../releases.md#reruns-on-the-gate-commit-fdf14a28) |
| 14 | The full CI run on the final main commit runs again, and if it passes, M1 closes. The full CI run 37498466285 on 74d5f4956 had failed Safari's first shard twice, on E1302 and then E1109. The rerun, 37542830381, passed. Safari's failures in CI stay a known problem that comes and goes, with a high-priority M2 task, proposed as M2-R26. It looks at whether Safari's shared memory area fragments | [Releases](../releases.md#the-gates-final-pass) |

The items that run again on the new gate commit:

- S4's allocation on WebGL2, Chrome on the Mac.
- The iPad's soak plan, on a cool iPad.
- The iPad's GPU time comparison of S4 at Low against the older commit f46c0686, on a cool iPad.
- Firefox and Safari on the Mac, after the fixes for their failures merge.

The coordinator chose the new gate commit on 6 October 2026: fdf14a28. It is the first main commit that holds #347, which keeps the refresh meter's frame tick free of allocation. Without #347, S4's allocation on WebGL2 still fails. That commit also holds #335. Firefox and Safari run again on the later main commit that holds the fixes for their failures, and their rows name that commit.

## Options rejected

- Run every item again on the new commit. The night's order took about 5 hours of device time and 70 minutes of a quiet Mac. The fixes in #335 and #347 change only the governor's time keeping and the refresh meter's frame tick. So the items that passed have no reason to change.
- Keep the 4.5 s target and take more bytes off the start. The 57 ms miss needs about 9 KB less. The start grew with each feature since the target was set, and about 2 KB more would miss again.

## Consequences

- [Releases](../releases.md#the-owners-rulings-of-6-october-2026) lists the items that run again, and the gate passes when they pass on the new commit.
- D-06's T-28 target points to this record.
- The S24+'s T-28 rows on the gate commit read as a pass.
- The gate's final pass runs on the main commit of the last browser fix to merge.
- A high-priority M2 task is proposed as M2-R26, for the owner to confirm, for Safari's failures in CI that come and go.
- A new M2 task is proposed as M2-R25, for the owner to confirm. It finds why the receiver plane of #257 costs about 1.1 ms on Apple GPUs, and a cheaper method.
