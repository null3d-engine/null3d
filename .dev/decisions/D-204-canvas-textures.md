# D-204: Canvas textures refresh by their changed rectangle

Status: decided. Date: 21 October 2026. Task: M3-A2. The measured refresh cost is still owed: the image test that prints it needs a full build, and no full build finished on 21 October 2026.

Summary: A texture can follow an `OffscreenCanvas`, and `texture.refresh(rect)` uploads only the rectangle that changed, within the frame's upload budget. A 1024 x 1024 screen that refreshes a 256 x 256 rectangle at 30 Hz sends 7.5 MiB a second. Each fragment fits the Low preset's 2 MiB budget.

## Question

How does a sketch show an `OffscreenCanvas` in the world? How does it send only the pixels that changed, so a screen that refreshes often stays within the upload budget?

## Rule

A screen at 1024 x 1024 texels refreshes a 256 x 256 rectangle at 30 Hz. Each frame's upload is at most the preset's `uploadBytesPerFrame`, and the engine's measured cost of a refresh is recorded for the Mac. Device rows follow when the coordinator runs the plan on them.

## Data

| Measure | Whole canvas | 256 x 256 rectangle | Device and browser |
| --- | --- | --- | --- |
| Bytes of one refresh | 4 MiB | 0.25 MiB | any |
| Bytes a second at 30 Hz | 120 MiB | 7.5 MiB | any |
| Frames to upload at the Low preset's 2 MiB budget | 2 | 1 | any |
| Sketch cost of one refresh, milliseconds | owed | owed | Mac, Chrome |
| Sketch cost per MiB of changed rectangle, milliseconds | owed | owed | Mac, Chrome |
| The same, on an iPad | owed | owed | iPad Pro 11-inch, Safari |
| The same, on a phone | owed | owed | Galaxy S24+, Chrome |

How the data was produced: the rows marked owed come from `bun run test:images -g "refresh cost"` on the Mac. It opens `tests/pages/canvas-texture.html` on each GPU path. The page starts the engine with a 1024 x 1024 canvas, and times twenty refreshes of the marker's rectangle and four of the whole canvas. It then measures two seconds of frames with `engine.measure`. The bytes follow from the sizes: four bytes a texel.

## Decision

A canvas texture follows the canvas through a rectangle upload that the render core gains. The sketch reads the changed rectangle with `getImageData`, turns its rows over, and copies them into engine memory, so the upload is the rectangle alone. The texture carries a refresh rate, and a call that comes sooner reads nothing.

## Consequences

- `textures.fromCanvas(canvas, { refreshHz })` and `texture.refresh(rect)` join the texture API on both GPU paths. The rectangle must lie inside the canvas, and a refresh before the first upload reaches the GPU sends the whole canvas.
- The render store gains a rectangle source that uploads in bands within the frame's budget and makes the texture's mip levels again after each refresh.
- A refresh allocates one `ImageData` of the rectangle, which the browser returns. The engine's own copy path allocates nothing.
- The docs, the cookbook's "Screens in the world" recipe and the develop skill show the calls. An example, `canvas-screen`, draws three wall screens in a control room.
