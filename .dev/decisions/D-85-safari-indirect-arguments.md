# D-85: Indirect draws on Safari 26: each draw reads its own copy of its arguments

Status: decided; since [D-87](D-87-webkit-indirect-arguments.md), the copies run only in Apple's WebKit. Date: 2026-10-06. Task: fix/safari-gate-1006 (an M1 gate failure).

## Question

Safari 26 can hang the GPU when one render pass holds two indexed indirect draws from one buffer. The engine's culled passes draw every bucket that way. How should the engine avoid the fault?

## Rule

- No GPU reset, and the right image, in Safari 26 on WebGPU and in compatibility mode.
- The WebGPU backend cannot tell browsers apart (hard rule 14). The fix runs in every browser, so its cost in Chrome must be too small to measure, or within the noise of the benchmark comparison.
- No allocation in steady frames, and no change to what the culling pass computes.

## Data

The fault is WebKit bug 321876, which WebKit fixed in August 2026 (commit 6dca6330), after Safari 26 shipped. Safari clamps each indirect draw's arguments into a scratch slot before the draw. Safari 26 keeps one slot per buffer, and nothing makes a draw read the slot before the next draw's clamp writes it again. So a draw can run with the next draw's counts, or a mix of the two.

Safari 26.6.2 on the owner's Mac (M5 Max), 6 October 2026:

| Page | Result |
| --- | --- |
| `sprites-100k`: 100,000 sprites, then 8 sized in pixels, two buckets in one pass | GPU reset after about 15 s, on WebGPU and in compatibility mode |
| The same with 87,500 sprites or fewer, or with the small bucket first, or with it culled away | Passed |
| 100,000 sprites, then 1 sprite in a bucket of its own, of either kind | GPU reset |
| Plain WebGPU, no engine: 100,000 instanced quads, then 1, both indirect from one buffer | GPU reset; with 60,000 quads, 16 s |
| The same with direct draws, the small draw first, a new pass for the second draw, a buffer for each draw's arguments, or each draw's arguments copied into a buffer of its own | 5 ms |
| The engine with each draw's arguments copied (this record's choice) | `sprites-100k` passed on WebGPU and in compatibility mode, with no GPU reset |

The cost of the copies in Chrome on the Mac's GPU: S1, S2 and S4 on WebGPU. The run was `bench:run --compare`, main against the fix, 5 rounds of 10 s each.

| Scene | Measure | Main, ms (median of runs) | With the copies, ms | Change | Noise | Comparison's result |
| --- | --- | --- | --- | --- | --- | --- |
| S2 (about 100 buckets) | busiest thread | 0.150 | 0.160 | -0.0% | 3.0% | same |
| S2 | own work | 0.145 | 0.155 | -0.0% | 3.2% | same |
| S4 (shadow cascades) | busiest thread | 0.130 | 0.110 | +0.0% | 16.5% | same |
| S4 | own work | 0.110 | 0.095 | +4.3% | 19.3% | same |
| S1 (one bucket: no copies) | busiest thread | 3.210 | 2.772 | -15.5% | 2.0% | faster |
| S1 | own work | 0.265 | 0.222 | -12.8% | 3.5% | same |

Chrome 154.0.8037.98 on the Mac at 144 Hz, load 11.9 at the start and 21.2 at the end (results `target/bench/20261006-011859-compare` in the fix's worktree). S1 holds one bucket, so it copies nothing, and its change shows the noise of a busy Mac. In S2 and S4 the change is within the noise.

## Options

1. Copy each draw's 20 bytes of arguments into a small buffer of its own before the pass. Do so when the pass holds two or more indexed indirect draws. Chosen.
2. Begin a new render pass for each indirect draw. It also passed, but each new pass loads and stores the targets again. That costs a tile-based GPU memory traffic for every bucket, in every view and every frame.
3. Read instances and vertices from storage buffers, so that Safari does not clamp the draws. Compatibility mode allows no storage buffers in vertex shaders, and every pipeline would change.
4. Two argument buffers taken in turn. Then only Metal's barriers would end a draw's read of its arguments before a later draw's clamp writes them. WebKit's fix says that no barrier can name that read.
5. Copies in Safari only. Hard rule 14 forbids choosing by browser, and a feature test would need a GPU hang to see the fault. Rejected at first; the owner later chose it as a narrow exception to rule 14 ([D-87](D-87-webkit-indirect-arguments.md)), once the copies proved to double S4's GPU time in Chrome.

## Decision

Option 1. The backend (`gpu/webgpu/indirect-arguments.ts`) finds the pass's indexed indirect draws when the pass begins, its bundles included. It copies each one's arguments into a buffer of its own, which it makes once and keeps. A buffer that indirect draws read is made as a copy source too. A pass with one indirect draw copies nothing. In Chrome, the copies cost no CPU time that the comparison can measure. The comparison did not look at GPU time, which the copies doubled in S4: [D-87](D-87-webkit-indirect-arguments.md) has the figures, and limits the copies to Apple's WebKit.

## Consequences

- The culled passes run the same draws as before, from copies of their arguments. The culling pass and the draw list do not change.
- When Safari's fix has shipped and the engine's minimum Safari has it, the copies can go. [D-64](D-64-minimum-browsers.md) sets the minimum: Safari 18 today.
- [Implementation notes](../implementation-notes.md#browser-faults) give the evidence. [Device sessions](../devices.md#browser-apps-on-the-mac) say to hunt such faults only while the owner is away, because a GPU reset disturbs the whole Mac.
