Plans: vegetation-poses 2026-10-31. The branch is `feat/m3-v10-branch-poses` at `dfb3a7ba7`. Its
measured pages are those of `8edc9c8cc`, and the branch merged `m3-start` at `fc8775f4c`, which
changed no Rust, shader or engine code. The dev server in `/Users/ram/dev/null3d-v10` served the
pages to the installed Google Chrome 156. The run held the quiet window on the Mac, at a load of 3
and an idle share of 87 to 89 per cent.

Result: 28 passed, 0 skipped, 0 failed.

The `vegetation-poses` plan times a dense grove of four oak variants in seven copies each, with the
per-vertex sway and with branch poses. Each pair of pages runs in turns at one preset and path, and
the order swaps. The frame is the median GPU time per frame over five seconds, after a settle. The
vertex view draws the same page at a quarter of the render scale with the sun's shadows off, so its
frame follows the vertex work that the two methods differ in. The window was 1,280 by 720 CSS
pixels at a pixel ratio of 1.

| GPU path | Preset | Frame, per vertex (ms) | Frame, poses (ms) | Vertex view, per vertex (ms) | Vertex view, poses (ms) |
| --- | --- | --- | --- | --- | --- |
| WebGPU | Low | 4.52 | 4.13 | 3.41 | 3.80 |
| WebGPU | Medium | 4.33 | 4.52 | 3.74 | 4.13 |
| WebGPU | High | 4.72 | 5.11 | 4.00 | 3.87 |
| WebGPU | Ultra | 4.85 | 5.18 | 4.13 | 4.13 |
| compatibility | Low | 4.33 | 4.46 | - | - |
| compatibility | Medium | 4.46 | 4.46 | - | - |
| WebGL2 | Low | 7.82 | 10.47 | 2.41 | 3.95 |
| WebGL2 | Medium | 14.44 | 16.84 | 2.60 | 6.71 |

The pose method wins twice, and not plainly. At Low its frame is 8.7 per cent faster and its vertex
view 11.5 per cent slower. At High its vertex view is 3.3 per cent faster and its frame 8.3 per cent
slower. At Medium and Ultra its frame is 4.6 and 6.7 per cent slower. The compatibility rows read the
same figure twice, within the timer's 0.0655 ms steps.

On WebGL2 the pose method is clearly slower: 34 and 16.6 per cent on the frame, and 64 and 158 per
cent in the vertex view. Its WebGL2 form draws one fragment for every pose texel, and the two texels
that hold a branch's turn each walk the whole ancestor chain with a spring step. The grove's four
variants then cost 1.3 to 2.6 ms of extra work in the vertex views.
