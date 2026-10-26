# D-204: Canvas textures refresh by their changed rectangle

Status: decided and built. Task: M3-A2. The iPad, phone and Mac WebGL2 rows are measured. The Mac WebGPU row is owed. Its timing run measures only while the 1-minute load is below 8, and the load stayed at 8 or above for the ten-minute wait.

Summary: A texture can follow an `OffscreenCanvas`, and `texture.refresh(rect)` uploads only the rectangle that changed, within the frame's upload budget. A 1024 x 1024 screen that refreshes a 256 x 256 rectangle at 30 Hz sends 7.5 MiB a second. Each fragment fits the Low preset's 2 MiB budget.

## Question

How does a sketch show an `OffscreenCanvas` in the world? How does it send only the pixels that changed, so a screen that refreshes often stays within the upload budget?

## Rule

A screen at 1024 x 1024 texels refreshes a 256 x 256 rectangle at 30 Hz. Each frame's upload is at most the preset's `uploadBytesPerFrame`. The engine's measured cost of a refresh is recorded for the Mac, an iPad and a phone. The costs of the frames that carry it are recorded beside them.

## Data

The upload's bytes follow from the sizes: four bytes a texel.

| Measure | Whole canvas | 256 x 256 rectangle |
| --- | --- | --- |
| Bytes of one refresh | 4 MiB | 0.25 MiB |
| Bytes a second at 30 Hz | 120 MiB | 7.5 MiB |
| Frames to upload at the Low preset's 2 MiB budget | 2 | 1 |

Each device ran the page at the High preset, which WebGL2 caps at Medium. The frame columns give the middle frame's GPU and CPU time with refreshes and without them in the same drawing, so their difference is the upload's share of a frame. The refresh columns give the sketch's middle time for twenty rectangle reads and four whole-canvas reads, so they include the browser's image data.

| Device and browser | Path | Frame interval | Frame GPU, with / without | Frame CPU, with / without | One rectangle refresh | One whole refresh |
| --- | --- | --- | --- | --- | --- | --- |
| iPad Pro 13 2025, Safari 26.6.1 | WebGPU | 15.5 ms | 0.291 / 0.113 ms | 0.54 / 0.32 ms | 2.06 ms | 1.57 ms |
| iPad Pro 13 2025, Safari 26.6.1 | WebGL2 | 15.5 ms | no timer | 0.94 / 0.83 ms | 2.28 ms | 1.80 ms |
| Galaxy S24, Chrome 152 | WebGL2 | 33.33 ms | no timer | 3.215 / 2.155 ms | 8.90 ms | 7.77 ms |
| Mac (M3 Max), Chrome 156 | WebGPU | owed | owed | owed | owed | owed |
| Mac (M3 Max), Chrome 156 | WebGL2 | 16.67 ms | 0.319 / 0.276 ms | 0.125 / 0.050 ms | 3.46 ms | 3.40 ms |

The S24 has no WebGPU adapter, so it gives the WebGL2 row alone. Every measured frame stayed within its preset's upload budget, and the refresh uploaded the rectangle alone. One rectangle refresh took about half a millisecond more than one whole refresh on the iPad's two paths. On the phone it took about a millisecond more, while it sent a sixteenth of the bytes. The browser's image data and the call cost a fixed part that a quarter of a mebibyte does not spread. On the Mac's WebGL2 path the two refreshes cost the same, 3.46 and 3.40 ms. The refreshes added 0.043 ms of GPU time and 0.075 ms of CPU time to a frame. So the rectangle saves upload bandwidth, and the GPU's work on the upload, while the sketch's own read time stays about the same.

How the data was produced: each device ran `canvas-cost`, which opens `tests/pages/canvas-texture.html` on each GPU path. The page starts the engine with a 1024 x 1024 canvas. It times twenty refreshes of the marker's rectangle, then four of the whole canvas. It then measures a window of frames that refresh the rectangle, and a window of the same drawing with no refresh. The Mac times the same page in its installed Chrome, in a quiet window: `NULL3D_CANVAS_COST=1 bun run test:browser -- canvas-texture.spec.ts --workers=1`. That run measures only while the computer's 1-minute load is below 8, and gives up after ten minutes. Its run turns the browser's GPU timestamp rounding off, so its GPU figures are not rounded. The rows come from the [iPad run](../tested-devices/ipad-pro-13-safari/20261024-205051-canvas-cost.md), the [S24 run](../tested-devices/galaxy-s24-sm-s921b-chrome/20261024-213055-canvas-cost.md) and the Mac's WebGL2 test. The Mac's test waited until the 1-minute load reached 7.5. The Mac's WebGPU test gave up with the load at 8 or above for its ten minutes, so its row is owed.

## Decision

A canvas texture follows the canvas through a rectangle upload in the render core. The sketch reads the changed rectangle with `getImageData`, turns its rows over, and copies them into engine memory, so the upload is the rectangle alone. The texture carries a refresh rate, and a call that comes sooner reads nothing.

## Consequences

- `textures.fromCanvas(canvas, { refreshHz })` and `texture.refresh(rect)` are part of the texture API on both GPU paths. The rectangle must lie inside the canvas, and a refresh before the first upload reaches the GPU sends the whole canvas.
- The render store has a rectangle source that uploads in bands within the frame's budget and makes the texture's mip levels again after each refresh.
- A refresh allocates one `ImageData` of the rectangle, which the browser returns. The engine's own copy path allocates nothing.
- The docs, the cookbook's "Screens in the world" recipe and the develop skill show the calls. An example, `canvas-screen`, draws three wall screens in a control room.
