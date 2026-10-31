# D-280: A ground surface's reflection of the sky costs about a third of a millisecond

Status: decided, for the owner's review. Built: S7, the page switch that drops the reflection and
the page's memory figures, with the Mac, tablet and phone rows recorded. Open: nothing. Task: M3-R26.

Summary: A paved surface that reflects a sky with a layer costs 0.34 ms of GPU time per frame on the
Mac. It does so at High and at Medium on WebGPU, where a frame with the reflection takes 2.30 ms and
2.29 ms. The cost is about 15% of each frame. On the iPad Pro 13 at High it costs 0.204 ms, 7.5% of
its frame, and on the Galaxy S25 0.458 ms, 8.4%. The reflection adds 10.4 MiB on the GPU, and the
page's memory rises by 10.8 MiB.

## Question

What does a ground surface that reflects a sky layer cost per frame? The presets are those that the
benchmark suite reports. Does that cost confirm the 0.35 ms that the owner accepted on S6 at Medium?

## Rule

A surface's reflection is worth its cost when the owner accepts it. The scene that measures it holds
one fixed camera, one paved surface and one still sky, and its two runs differ by the reflection
alone. The cost is judged beside the frame it sits in and the memory it takes, on a machine with a
GPU of its own.

## Data

| Measure | Reflection on | Reflection off | Difference | Run |
| --- | --- | --- | --- | --- |
| GPU time per frame, WebGPU at High | 2.301 ms | 1.961 ms | 0.340 ms, 14.8% | 20261031-020842-bench |
| GPU time per frame, WebGPU at Medium | 2.291 ms | 1.948 ms | 0.343 ms, 15.0% | 20261031-021400-bench |
| GPU time per frame, WebGL2 at Medium | 4.099 ms | 4.235 ms | not usable | 20261031-020842-bench |
| GPU time per frame, iPad Pro 13 at High | 2.721 ms | 2.517 ms | 0.204 ms, 7.5% | 20261031-023430-bench |
| GPU time per frame, Galaxy S25 at High | 5.439 ms | 4.981 ms | 0.458 ms, 8.4% | 20261031-024942-bench |
| GPU textures | 150.40 MiB | 143.50 MiB | 6.90 MiB | 20261031-032342-bench |
| GPU buffers | 4.80 MiB | 1.30 MiB | 3.50 MiB | 20261031-032342-bench |
| Page memory | 166.50 MiB | 155.70 MiB | 10.80 MiB | 20261031-032342-bench |

The WebGL2 path gives no GPU figure on any machine of this sitting. The iPad and the phone have no
timer there, and the Mac's timer's rounds differ by more than the effect. Their CPU times do not
separate the two runs either.

The two runs draw the same camera, sky and material, and only the ground's environment map changes.
The iPad's WebGPU on and off live frames show it. Above row 375 of 720 they are pixel-identical, and
every differing pixel lies on the ground below the horizon. The plane draws in the held frame too.
The held reference's bottom band holds 6.6% sharp edges, the paving's joints, where the sky's top
band holds none. The ground-level plane fault that M3-R27 records does not appear here.

How the data was produced: `bun run bench:run --scenes s7 --pages
null3d-webgpu,null3d-webgpu-reflection-off,null3d-webgl2,null3d-webgl2-reflection-off --switches
"preset=high&governor=off" --runs 5 --seconds 5`, and `bun run bench:run --scenes s7 --pages
null3d-webgpu,null3d-webgpu-reflection-off --switches "preset=medium&governor=off" --runs 5 --seconds
5`, on the Mac (Apple M3 Max, 14 cores, 36 GB, Chrome 156) at commit 8d2fb64a5. The runs went through
the job queue with its quiet window, and every page presented 120 frames a second. The memory figures
come from the page's `?memory-figures` mode, `bun run bench:run --scenes s7 --pages
null3d-webgpu,null3d-webgpu-reflection-off --switches "memory-figures&preset=high&governor=off"
--runs 1` (run 20261031-032342-bench), which reads the stats overlay after its timed run. The tablet
and phone rows come from `bun run devices:cloud --only bsipadpro13-safari` and `--only
bsgalaxys25-chrome` on the iPad Pro 13 and the Galaxy S25, with the same pages and switches (runs
20261031-023430-bench and 20261031-024942-bench).

## Look

The reflection is the scene's subject. The surface mirrors the sky's color, and its lowest band lies
across the far stones where the surface meets the sky. The joints keep the surface visible to the
horizon. Without the reflection the surface is a flat lit paving, the same scene with its subject
taken out. A mirror-smooth surface looked
worse than the paving. Its reflection met the sky with no line, so the frame read as sky alone, and no
pixel showed a joint. The surface therefore keeps enough roughness to show its stones.

## Decision

Keep the ground surface's reflection. The measured cost is 0.340 ms at High and 0.343 ms at Medium
on the Mac, about 15% of each frame. The iPad costs 0.204 ms and the Galaxy S25 0.458 ms at High, so
the effect scales with the frame. The owner's accepted 0.35 ms is the right order for a ground
surface that reflects. The reflection adds 10.4 MiB on the GPU and 10.8 MiB to the page, so it does not press on a
desktop frame. A scene
without the reflection was rejected, because the reflection is the subject. A mirror-smooth surface
was rejected for the look above.

## Consequences

- S7 joins the benchmark suite: its page tests, its image test with references on every tier, and
  the CI shard list. The list grows to 9 shards for 18 pages.
- The page kinds `null3d-webgpu-reflection-off` and `null3d-webgl2-reflection-off` let one bench run
  take turns between a page and its twin.
- [Benchmarks](../benchmarks.md) says how to run the scene and read its two runs, and
  [benchmark results](../benchmark-results.md#s7) keeps its rows.
