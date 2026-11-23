# D-383: the core WebAssembly budget is 640 KB after Brotli

Status: decided. Task: the island showcase's engine work.

Summary: Each core WebAssembly file may take 640 KB after Brotli. The owner raised the budget from
600 KB in writing, because the branch's core sits at the old limit. The query-sync fix needs 348
bytes more than that limit allows. The new headroom also holds the fixes queued behind it.

## Question

The core sits at its 600 KB limit with the query-sync fix applied. Should the fix stay outside the
branch, or may the budget rise so it can land?

## Rule

Only the owner raises a budget, in writing (AGENTS.md, "Budgets"). A raise names the measured
figures it answers. It also names the work it makes room for.

## Data

| Measure | 600 KB budget | 640 KB budget | Device and browser |
| --- | --- | --- | --- |
| Query-sync fix, threaded core | 614,748 bytes, 348 over | 41 KB under | This Mac, `bun run build` |
| Query-sync fix, single core | 613,641 bytes, 759 under | 42 KB under | This Mac, `bun run build` |
| Seven trims for the same fix | 614,375 to 615,328, no direction | inside the band | This Mac, `bun run build` |

How the data was produced: `bun run build` in the worktree at the branch's head, with the fix's
sources applied. Seven shapes were built, each passing the same tests, clippy and rustfmt. The
fix's own measurement: the island's worst recurring query sync falls from 24.3 ms to 2.1 ms.

## Look

No look changes. This is a download-size gate, and the same bytes draw the same picture.

## Decision

The budget is 640 KB after Brotli for each core WebAssembly file. The owner's written instruction
settles it. The figures show the old limit leaves less headroom than the fix needs on one build.
Trimming moved the threaded figure by under a kilobyte in either direction, across seven shapes.
Holding 600 KB and funding a size pass was not taken. The owner asked for the raise, and the pass
would stop all Rust work until it finished.

## Consequences

The build's budget constant and its two messages read 640 KB. So do the README's download-size
line, the benchmark gate's wording and AGENTS.md's budget line. The size-growth rule against main's
build is unchanged. The cull, fog and WebGL2 reflection slices now have room to land.
