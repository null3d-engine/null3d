# D-04: WebAssembly shared memory maximum

Status: decided by the owner on 2026-09-30. Date: 2026-09-29. Test: T-07.

Summary: Keep 1024 MiB as the default maximum, and let a page ask for up to 4096 MiB.

## Question

What maximum should the engine declare for its shared WebAssembly memory? A shared memory cannot move, so the browser reserves address space for the whole maximum when the engine starts. Too small a maximum limits the scene; too large a one can fail to load on a phone or a tablet.

## Rule

The largest maximum that loads in 20 of 20 reloads on the iPad (4 GB) and the S24+. T-07: try maxima from low to high, 20 reloads each.

## Data

The runner's memory plan loads the engine test page 20 times at each maximum (the `?memory=<MiB>` switch), from low to high, in one runner tab. A load passes when the engine starts with the threaded build.

| Maximum | iPad Pro 11-inch, Safari 26.6 | S24+, Chrome | S24+, Brave |
| --- | --- | --- | --- |
| 256 MiB | 20 of 20 | 20 of 20 | 20 of 20 |
| 512 MiB | 20 of 20 | 20 of 20 | 20 of 20 |
| 1024 MiB (today's default) | 20 of 20 | 20 of 20 | 20 of 20 |
| 2048 MiB | 19 of 20 (see below) | 20 of 20 | 20 of 20 |
| 4096 MiB (the core's declared limit) | 20 of 20 | 20 of 20 | 20 of 20 |

The one failed load at 2048 MiB was not an allocation failure. The engine's small file of memory limits arrived broken, and the engine read it without checking the download. #33 makes the loader check each core file (error E1406).

How the data was produced: `bun tests/real-browsers.ts --lan ipad-safari --plan memory` on 2026-09-29, run 20260929-151313-memory, after #33's fixes, and `bun tests/real-browsers.ts --plan memory --android chrome,brave` the same day, run 20260929-152340-memory (Chrome 154 and Brave on the S24+; Brave's Shields state was not recorded). The iPad was an iPad Pro 11-inch with 8 cores; Safari does not report its RAM (`navigator.deviceMemory` is null). The rule names a 4 GB iPad, which this is probably not.

### Room for more than one engine

A maximum also sets how many engines' memories a page can hold at once. The shared memory test page counts it: it allocates memories with the maximum until the browser refuses. The memory plan counts it before its loads at each maximum (#35; `--runs 0` runs only the counts).

| Maximum | iPad Pro 11-inch, Safari 26.6 | S24+, Chrome and Brave |
| --- | --- | --- |
| 256 MiB | 18 | 64 or more |
| 512 MiB | 10 | 64 or more |
| 1024 MiB | 6 | 64 or more |
| 2048 MiB | 4 | 64 or more |
| 4096 MiB | 3 | 64 or more |

The page stops counting at 64. Run 20260929-154854-memory, 2026-09-29. On the Mac, Safari 26.6 holds 35 to 39 memories with a 1 GiB maximum, and Chrome 64 or more. The iPad's counts do not fall in proportion to the maximum, so Safari reserves more than the maximum for each memory.

Before #33, Safari kept the memory of every stopped engine until the tab closed. The engine stopped its job workers inside a blocking wait, and Safari never frees a shared memory that such a thread held. A page on the iPad could then start the engine about six times. With #33, the room comes back after each stop (10 starts and stops in each thread mode, room 6 before and after).

## Decision

Decided by the owner on 2026-09-30: keep 1024 MiB as the default, and let a page ask for up to 4096 MiB.

- The rule as written allows 4096 MiB: every maximum up to the core's declared 4096 MiB loads 20 of 20 on both devices.
- The room counts argue against 4096 MiB as the default. The maximum reserves address space, not memory. At 4096 MiB an iPad page holds 3 engines, and every other WebAssembly module on the page, such as a physics engine, shares what is left. At 1024 MiB it holds 6. A page briefly holds two engines when it starts a new one before the old one has stopped, so each maximum up to 4096 MiB still works on this iPad.
- Scenes need far less than 1 GiB today: S1 at 100,000 objects runs in 41 MB of engine memory (the soak test of #34).
- The iPad measured is a Pro model. The rule names a 4 GB iPad, which may have less address space. Run `--plan memory --runs 0` on one before a preset asks for more than 1 GiB.

## Consequences

- The default in `packages/engine/src/page/loader.ts` stays 1024 MiB. Its comment ("until per-preset budgets exist") gets this record's reasoning.
- A public option for the maximum, validated up to 4096 MiB, replaces the test-only `?memory=` switch as the way a page asks for more. The quality presets set it when they come.
- T-07 is closed for the iPad Pro and the S24+, and stays open for a 4 GB iPad.
