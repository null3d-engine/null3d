# D-83: The owner's rulings on the M1 gate, 6 October 2026

Status: decided by the owner on 2026-10-06, in the morning, Singapore time. Date: 2026-10-06. Task: M1-K5.

## Question

The M1 gate ran on the night of 5 to 6 October 2026, on the gate commit 89a1d6295 (#321). Most items passed. One check failed on a known cause, and some device runs gave no valid result. The S24+'s cold start missed its target by 32 and 57 ms. Must every item run again on a commit with the fix? Does the cold start fail item 5? The owner also saw the shadows trail the cars in S4 at Low. Does that hold back the gate? Last, Safari on the iPhone and the iPad kept the memory of old engines until new engines met E1109. Is its fix part of the gate?

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
| 3 | The shadows that trail the cars in S4 at Low do not hold back the gate. They are a known finding. At Low, the far cascade draws only every few frames, so it lags moving casters. The fix keeps a cached far layer, on fix/shadow-trail (944bb64ef), and lands in M2 | [Releases](../releases.md#results-on-the-gate-commit-89a1d6295) |
| 4 | The fix for the memory that piles up in Safari on the iPhone and the iPad (#352) is part of the gate. Safari kept the memory of engines whose drawing worker stays with the canvas, so new engines met E1109. The gate needs #352 merged, then device evidence on that main: the cloud iPhone 16 runs the 12 engine pages that failed before, and the owner's iPad runs its test pages without a Safari restart | [Releases](../releases.md#what-the-gate-still-needs) |

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
