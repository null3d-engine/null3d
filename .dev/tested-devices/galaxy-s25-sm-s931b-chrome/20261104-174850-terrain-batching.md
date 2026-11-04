Plans: terrain-batching 2026-11-04. The branch is `perf/terrain-block-batching` at `9f071cab8`.
BrowserStack Automate served the pages over HTTPS through BrowserStack Local, in Chrome 152.0.7977.54
on Android 15.0, on the Galaxy S25 (SM-S931B), whose GPU is an Adreno 830. The engine drew on core
WebGPU at Medium. The display ran at 30 Hz, as it does on this cloud device, and the cloud gives no
reading of the phone's heat.

Result: 6 passed, 0 skipped, 0 failed. The run marks its timing figures unreliable because the
display ran at 30 Hz where the plan expects 60. Here every frame took about 100 ms, well under that
rate, so the GPU and not the display set the interval.

The plan drew the Island's town view in turns with the terrain drawn by a mesh per block (base) and
by shared grids drawn as copies (shared), in the order base, shared, base, shared, base. Both sides
drew 355 blocks. The figures are medians over each visit's four windows of three seconds.

| Visit | Side | GPU per frame | Frame interval | Render worker | Sketch worker | Draws | Triangles |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | base | 108.40 ms | 99.99 ms | 1.59 ms | 5.06 ms | 2,371 | 3.68 M |
| 2 | shared | 105.40 ms | 100.00 ms | 0.88 ms | 4.87 ms | 801 | 3.42 M |
| 3 | base | 95.72 ms | 99.98 ms | 1.55 ms | 4.89 ms | 2,371 | 3.81 M |
| 4 | shared | 106.15 ms | 99.97 ms | 0.91 ms | 4.95 ms | 801 | 3.68 M |
| 5 | base | 106.61 ms | 99.98 ms | 1.48 ms | 4.59 ms | 2,520 | 3.68 M |

The shared grids take about 0.6 ms a frame off the render worker and two thirds of the draws. The
phone's GPU holds the frame at about 100 ms on both sides, so the frame interval does not move. The
GPU time of the base visits spans 95.7 to 108.4 ms, wider than any difference between the sides.
