# D-271: A ground surface's reflection of the sky costs about a third of a millisecond

Status: decided, for the owner's review. Built: S7, the page switch that drops the reflection and
the page's memory figures. Open: the Medium and High rows on a tablet and on a phone. Task: M3-R26.

Summary: A paved surface that reflects a sky with a layer costs 0.33 ms of GPU time per frame on the
Mac at High on WebGPU, where a frame with the reflection takes 2.29 ms. The owner's accepted 0.35 ms
holds for this surface, and the reflection's own memory is 10.7 MiB.

## Question

What does a ground surface that reflects a sky layer cost per frame, at the presets that the
benchmark suite reports, and does that cost confirm the 0.35 ms that the owner accepted on S6 at
Medium?

## Rule

A surface's reflection is worth its cost when the owner accepts it. The scene that measures it holds
one fixed camera, one paved surface and one still sky, and its two runs differ by the reflection
alone. The cost is judged beside the frame it sits in and the memory it takes, on a machine with a
GPU of its own.

## Data

| Measure | Reflection on | Reflection off | Difference | Run |
| --- | --- | --- | --- | --- |
| GPU time per frame, WebGPU at High | 2.29 ms | 1.96 ms | 0.33 ms, 14.4% | 20261027-193057-bench |
| GPU time per frame, WebGPU at Medium | 2.34 ms | 2.03 ms | 0.31 ms, 13.2% | 20261027-194010-bench |
| GPU textures | 150.4 MiB | 143.4 MiB | 7.0 MiB | 20261027-191420-bench |
| GPU buffers | 4.7 MiB | 1.2 MiB | 3.5 MiB | 20261027-191420-bench |
| Page memory | 167.1 MiB | 156.4 MiB | 10.7 MiB | 20261027-191420-bench |

How the data was produced: `bun run bench:run --scenes s7 --pages
null3d-webgpu,null3d-webgpu-reflection-off,null3d-webgl2,null3d-webgl2-reflection-off --switches
preset=high&governor=off --runs 5 --seconds 5`, and the same at Medium with the two WebGPU pages, on
the Mac (Apple M3 Max, 14 cores, 36 GB, Chrome 156), at commit 12bcb2e22. The runs held the job
queue's quiet window, and every page presented 120 frames a second. The memory figures come from the
page's `?memory-figures` mode, which reads the stats overlay after its timed run.

The WebGL2 pages reported GPU times, but their reflection-off run read slower than their on run in
every round, which is the wrong way for the effect. That timer gives no figure for this scene, so its
row waits for a tablet and a phone, which time the WebGL2 path themselves.

## Look

The reflection is the scene's subject, and the paved surface shows it: the sky's bands cross the
stones, and the joints keep the surface visible to the horizon. Without the reflection the surface is
a flat lit pavement, which is the same scene with its subject taken out. A mirror-smooth surface
looked worse than the paving: its reflection met the sky with no line, so the frame read as sky
alone and no pixel showed a joint. The surface therefore keeps enough roughness to show its stones.

## Decision

Keep the ground plane's reflection. The measured cost is 0.33 ms at High and 0.31 ms at Medium, so
the owner's 0.35 ms is the right order for a ground surface that reflects, and this scene revises it
to about a third of a millisecond. The cost is 14% of the frame that carries it, and the reflection
adds 10.7 MiB of memory, so neither presses on a desktop frame. A scene without the reflection was
rejected, because the reflection is the subject. A mirror-smooth surface was rejected for the look
above.

## Consequences

- S7 joins the benchmark suite: its page tests, its image test with references on every tier, and
  the CI shard list, which grows to 9 shards for 18 pages.
- The page kinds `null3d-webgpu-reflection-off` and `null3d-webgl2-reflection-off` let one bench run
  take turns between a page and its twin.
- [Benchmarks](../benchmarks.md) says how to run the scene and read its two runs, and
  [benchmark results](../benchmark-results.md) keeps its rows.
- The tablet and phone rows are owed: the same two runs at Medium and High on one tablet and one
  phone, with the WebGL2 figure that the Mac cannot give.
