# D-183: The first-use shader budget raised, and the shader build's split owed

Status: decided by the owner on 2026-10-16. The shader build splits no combination module yet, so that
work is owed, and no date is set for it. Date: 2026-10-16. Task: the first-use shader budget,
16 October 2026.

Summary: Each first-use shader file may take 56 KB after Brotli, raised from 49 KB. The surface
displacement work of M2-J4 took one combination module to 50,962 bytes. A trim of that module was ruled
out with arithmetic: it compresses about 26 to 1, so the bytes are the feature's own code. The shader
build should split a combination module rather than let it grow, and a further raise should not be
assumed.

## Question

The surface displacement work of M2-J4 pushes 39 first-use shader modules past the figure of 49 KB after
Brotli. The worst is 786 bytes over. Should the figure rise again, should the code lose bytes, or should
the shader build split the module?

## Rule

- Only the owner raises a budget, and the raise is written here. AGENTS.md holds the rule.
- A raise clears the files it is for and leaves room for the next landing.
- The gzip and uncompressed figures of a first-use file stay at 320 KB and 1,536 KB.
- A raise that leaves work owed names that work, in writing.

## Data

Every raise so far went to the same cause: a feature whose generated shader code joined a combination
module. A combination module holds every build of a set of features, for one GPU target and one value of
the bits that a device fixes.

| Date | Figure after Brotli | What forced it |
| --- | --- | --- |
| 4 October 2026 | 24 KB | The owner set the limit at one start shader file's size |
| 5 October 2026 | 32 KB | The sun's shadow filter added 4 to 6 per cent to the WebGL2 morph files |
| 14 October 2026 | 48 KB | Area lights, transmission, weighted blending, row values, level-of-detail fade, coverage and hash each added a mesh-template permutation |
| 15 October 2026 | 49 KB | The screen-space reflections' lit code sits in every lit build |
| 16 October 2026 | 56 KB | The surface displacement of M2-J4 |

The start's budget rose for the same class of reason, so the pattern shows in one place. It went 140 KB
on 4 October, 145 KB and then 160 KB on 14 October, and 165 KB on 15 October. The last raise answered
main's own WebGL2 start, which measured 162.2 KB against 160 KB. [D-14](D-14-js-budget.md) holds each
figure and its reason.

The measurements for this raise come from the surface displacement tree:

| Measure | Value |
| --- | --- |
| The worst first-use module of that tree, after Brotli | 50,962 B |
| The same combination without displacement, after Brotli | 47,450 B |
| What displacement adds to it | 3,512 B |
| Over the figure of 49 KB | 786 B |
| Over the earlier figure of 48 KB | 1,810 B |
| First-use modules over 49 KB in that tree | 8 |
| First-use modules over 48 KB in that tree | 39, all GLSL, and none over the gzip or the uncompressed figure |
| The worst module uncompressed, and after gzip | 1,325,122 B and 218,428 B, a ratio of 26 to 1 |

How the data was produced: `bun run build` on `feat/m2-j4-displacement` at 7db011921, whose size gate
reported 54 problems. The report of that run is the tree's `target/size-report.json`. The twin without
displacement is the same module name with the displacement feature dropped.

### Why the module is not trimmed

Those modules compress about 26 to 1. The 1,810 bytes that the module must lose to pass 48 KB is about
46 KB of shader source. The displacement feature's own text in the module is 3,512 bytes after Brotli,
about 89 KB of source. The whole module is 1.3 MB of source.

So the bytes that a trim removes are the feature's own code and not spare text. It is not a trim, it is
a deletion.

## Decision

`FIRST_USE_SHADER_BUDGET.brotli` in `tools/lib/size-report.ts` rises from 49 KB to 56 KB. The gzip and
uncompressed figures stay at 320 KB and 1,536 KB.

The worst first-use module of that tree then sits 6,382 bytes under the figure. Main's own worst
combination module, measured on that tree, is 48,694 bytes. That is 1,482 bytes under the figure of
49 KB, so the next feature that joins one of those combinations breaks it. Every raise so far lasted
less than a day.

The alternative was the trim above, which is the feature's code and not padding. The owner chose the
raise, as they did for the start on 15 October and for the reflections the same day.

## Consequences

- `FIRST_USE_SHADER_BUDGET` in `tools/lib/size-report.ts` holds 56 KB after Brotli, and its test pins
  the figure.
- AGENTS.md, the README and [Benchmarks](../benchmarks.md#download-size) give the new figure.
  [D-14](D-14-js-budget.md) keeps it with the figures of the earlier raises.
- The shader build owes a split of an oversized combination module. The build groups those modules in
  `first_use_files`, in `crates/null3d-shaders/src/typescript.rs`. A split there gives a feature set
  more files, and each file a smaller one.
- That work has owners already, so this record names the place and leaves the work with them. The shader
  build's timing work (`perf/shader-build-time`) changes the same step. The shared paragraph table of the
  shader build does too, and D-181 records that work on its own branch.
- A further raise should not be assumed. The combination modules sit close to the figure already, so the
  next feature that joins one of them breaks the gate again.
