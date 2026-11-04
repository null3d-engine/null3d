Plans: terrain-batching 2026-11-04. The branch is `perf/terrain-block-batching` at `9f071cab8`.
BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Safari 26.6 on
iOS 26, on the iPhone 17. The engine drew on WebGPU at Medium with two job workers, and the runner
page measured the display at 59 Hz. The cloud gives no reading of the phone's heat.

Result: 6 passed, 0 skipped, 0 failed.

The plan drew the Island's town view in turns with the terrain drawn by a mesh per block (base) and
by shared grids drawn as copies (shared), in the order base, shared, base, shared, base. Both sides
drew 391 blocks. The figures are medians over each visit's four windows of three seconds, with the
longest frame interval of the visit.

| Visit | Side | GPU per frame | Frame interval | Longest | Render worker | Sketch worker | Draws | Triangles |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | base | 72.16 ms | 84.39 ms | 92.4 ms | 2.56 ms | 7.95 ms | 2,680 | 3.73 M |
| 2 | shared | 52.93 ms | 62.29 ms | 85.0 ms | 1.34 ms | 8.12 ms | 786 | 3.73 M |
| 3 | base | 53.25 ms | 64.10 ms | 78.1 ms | 2.27 ms | 8.00 ms | 2,518 | 3.73 M |
| 4 | shared | 51.95 ms | 61.18 ms | 67.4 ms | 1.34 ms | 8.03 ms | 786 | 3.73 M |
| 5 | base | 73.22 ms | 84.80 ms | 98.0 ms | 2.34 ms | 7.98 ms | 2,363 | 3.60 M |

The shared grids take about 1 ms a frame off the render worker and two thirds of the draws. The
GPU sets the frame on both sides. The base visits disagree with each other by 20 ms of GPU time
and of frame interval, far more than the sides differ, so the run cannot say whether the shared
grids move the frame. Against the base visit between them, the shared visits draw at the same GPU
time and 2 to 3 ms faster frames, which is inside that spread.
