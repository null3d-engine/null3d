Plans: the shadow-cascade cost probe 2026-10-25 and 26 on commit bbf734ebb, run by hand

Result: the figures below, and one attempt that produced nothing

The demos are examples, so the benchmark harness does not reach them. Each ran from this checkout's
development server in Chrome on WebGPU at Medium, opened with `?bench`, and a script read
`engine.measure()` for its per-pass GPU times. The machine's load average was 69 at the first run and
34 to 48 at the later ones.

| Page | Frame GPU ms | Draw calls | First cascade | Second cascade |
| --- | --- | --- | --- | --- |
| `?demo=time-of-day&preset=medium` | 2.74, 2.96 | 61, 61 | 0.048, 0.042 | 0.094, 0.125 |
| `?demo=creek&preset=medium` | 11.96, 10.56 | 135, 137 | 0.288, 0.340 | 0.531, 0.490 |
| the same, grass not casting | 8.04, 6.39 | 101, 101 | 0.302, 0.351 | gone from the report |

The grass was turned off by setting `castShadows` false on the batch of tufts near the water, at
`examples/showcase/creek/grass.ts`. The edit was reverted and nothing of it is committed.

The third row does not measure the grass's cost. Two things change with it. The grass stops casting,
and the far cascades stop drawing in every frame, because the grass no longer marks them as holding a
moving caster. A pass that a far cascade draws in only some frames is left out of the per-pass
report. The report names passes by their place among the timed ones. So the second cascade's
disappearance there says nothing about what casts into it.

A later attempt to pin the scene failed. Hold mode draws every cascade in every frame and holds the
clock, which is what a like-for-like comparison needs. It takes `?hold&target-fps=1`. The engine
never published itself to the page in that mode, so the probe timed out.

Two runs of the plain page are also not comparable with each other. Creek's camera follows a route
that runs on the clock, so each run opens on a different pose. One pass read 60% higher between two
runs of one configuration, and the draw calls moved from 137 to 164.

Creek's light names two cascades, so its first two render passes are all of its shadow cost. The
time-of-day demo's light names none, so it draws the preset's three at Medium.
