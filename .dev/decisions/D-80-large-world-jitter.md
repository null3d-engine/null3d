# D-80: How the large-world jitter check measures a flight, and its tolerance

Status: decided. Date: 2026-10-05; the iPad's run 2026-10-07. Task: M2-H2.

Summary: A camera flies sideways past six squares that face it, 16 frames, at the origin, 1,000 km and 6,378 km. Each object's motion from frame to frame must match the origin flight's within 0.05 px; large-world mode measures under 0.0001 px on every GPU path. The same flights with every cell taken, which is the engine without cells, jump 3.2 to 7.8 px. The engine warns once when the cells run out.

## Question

[D-42](D-42-large-world.md) keeps positions precise far from the origin in still frames. A camera that moves is a harder case. Each frame rounds the camera's position again, and a rounding that changes from frame to frame makes the image jump. The question has three parts:

1. How a test measures that jump in frames that the engine draws, on every GPU path and device.
2. The tolerance of a flight far from the origin against the same flight at the origin.
3. How the test shows that it can see the jitter at all, when the engine has no switch that turns cells off.

## Rule

- The figure compares each frame with the next: an object's image must move by the camera's motion only.
- A flight 1,000 km out and one at the Earth's radius pass in large-world mode. They pass on WebGPU, its compatibility mode and WebGL2. They pass on the Mac's GPU and on SwiftShader. In the device runner they pass on the Mac, the owner's iPad, the S24+ and four cloud phones.
- The same flights without cells fail the figure by a wide margin, on the same devices.
- The check runs in CI in under a minute per GPU path.

## Data

The jitter page flies each flight in its own engine, 16 frames of 480 x 270 pixels with MSAA. "Jitter" is the largest difference, in pixels, between an object's motion from one frame to the next and the same motion at the origin. "Own" is the largest difference from the object's mean motion in its own flight.

| Flight | Jitter, Mac GPU | Own, Mac GPU | Jitter, SwiftShader | Own, SwiftShader |
| --- | --- | --- | --- | --- |
| Origin | 0 | 0.200 to 0.201 | 0 | 0.226 to 0.233 |
| 1,000 km, large-world mode | under 0.0001 | 0.200 to 0.201 | under 0.0001 | 0.226 to 0.233 |
| 6,378 km, large-world mode | under 0.0001 | 0.200 to 0.201 | under 0.0001 | 0.226 to 0.233 |
| 1,000 km, every cell taken | 3.48 to 3.50 | 3.54 to 3.57 | 3.24 to 3.25 | 3.29 to 3.30 |
| 6,378 km, every cell taken | 7.75 to 7.76 | 7.93 to 7.94 | 7.75 to 7.76 | 7.93 to 7.94 |
| 1,000 km, no large-world mode, cells on | 3.50 | 3.57 | | |
| 6,378 km, no large-world mode, cells on | 7.75 | 7.93 | | |

Each range covers WebGPU, compatibility mode and WebGL2. `bun run --cwd tests test jitter.spec.ts`, Chrome on the Mac's GPU and with `CI=1` on SwiftShader, 2026-10-05. The rows without large-world mode come from a temporary build of the page, on WebGPU only. The device runner's figures go in the table below as the runs come in.

| Device and browser | GPU path | Far flights, jitter | Flights without cells, jitter | Date |
| --- | --- | --- | --- | --- |
| Mac, Safari 26.6.2 | WebGPU | under 0.0001 px (own 0.2007) | 3.4993 px at 1,000 km, 7.7509 px at 6,378 km | 2026-10-05 |
| Mac, Safari 26.6.2 | WebGL2 | under 0.0001 px (own 0.1996) | 3.4998 px at 1,000 km, 7.7503 px at 6,378 km | 2026-10-05 |
| iPad Pro 11-inch, Safari 26.6.2 (iPadOS 26.7) | WebGPU and WebGL2 | under 0.0001 px (own 0.2007 and 0.1996) | 3.4993 and 3.4998 px at 1,000 km, 7.7509 and 7.7503 px at 6,378 km | 2026-10-07 |
| Galaxy S25, Chrome 149 (Adreno 830) | WebGPU and WebGL2 | under 0.0001 px (own 0.2007 and 0.1996) | 3.4993 and 3.4998 px at 1,000 km, 7.7509 and 7.7503 px at 6,378 km | 2026-10-06 |
| Galaxy Tab A9 Plus, Chrome 149 (Adreno 619) | WebGPU and WebGL2 | under 0.0001 px (own 0.2007 and 0.1996) | as the S25 | 2026-10-06 |
| Pixel 9, Chrome 149 (Mali-G715) | WebGPU and WebGL2 | under 0.0001 px (own 0.2007 and 0.1996) | as the S25 | 2026-10-06 |
| Galaxy M32, Chrome 149 (Mali-G57 MC3) | WebGL2; its WebGPU adapter offers compatibility mode only | under 0.0001 px (own 0.1996) | 3.4998 px at 1,000 km, 7.7503 px at 6,378 km | 2026-10-06 |
| Galaxy S24+, Chrome 154 (Xclipse 940, ANGLE on Vulkan) | WebGL2; the phone has no WebGPU adapter | under 0.0001 px (own 0.2001) | 3.5002 px at 1,000 km, 7.7508 px at 6,378 km | 2026-10-05 |

The phones on BrowserStack Automate ran the runner's `jitter` plan, runs 20261006-005305-jitter and 20261006-005648-jitter. The owner's iPad ran it in run 20261007-062320-jitter. Each phone gave the Mac's figures to four decimals on each GPU path. Each GPU path still gave its own frames: the squares' first centers differ between WebGPU and WebGL2 by a thousandth of a pixel. The squares face the camera, and the GPUs draw 4 samples per pixel at the standard sample places. So every GPU covers the same share of each pixel. SwiftShader places its samples elsewhere, and gives its own figures.

## Decision

### The flight

The camera looks along -z and moves 12 cm along +x per frame, about 7 m/s at 60 Hz. Six flat white squares face it at depths of 4 m to 35 m, on black. Each lies in its own band of 45 rows of the frame. A square that faces a camera moving along its plane keeps its shape. Its image moves by the same number of pixels in every frame: the focal length in pixels, times the step, over the depth. So any change of that motion is jitter, not perspective. A forward flight would change each image's size and motion from frame to frame. The figure would then need a model of that change.

The objects take the engine's three paths for positions. They are a root mesh, the child of a turned parent, and two rows of an instance batch around its origin. The scene stands along a direction off every axis. So all three coordinates are large, and rounding on each axis shows.

### The figure

Each object's center is the mean of its band's pixels, each weighed by its linear brightness: the share of the pixel that the object covers. Edge pixels then count in part, and the center keeps a small fraction of a pixel. The figure compares each motion from frame to frame with the same step of the flight at the origin. The origin's flight draws the same view, with positions near 0 where 32-bit floats are finest.

The flight's own figure, against its mean motion, is 0.2 px at the origin. That is the rasterization's own noise: an edge's coverage moves in steps of the MSAA samples, and the turned squares cross pixels at a slant. Comparing with the origin's frames takes that noise out, because the same view draws the same pixels. So a far flight in large-world mode measures under 0.0001 px.

### The tolerance: 0.05 px

The tolerance is a quarter of the origin flight's own noise. It lies far above the far flights' figures, which are under 0.0001 px on both GPU sets. It lies 70 times below the smaller fault, 3.5 px, of the flights without cells. A position off by 1 mm at the nearest square, 4 m away, moves its image 0.06 px. So the check catches a rounding of a millimeter. A phone's GPU may round vertices on its own, and its figures will show it. The device runs check the tolerance there.

The flights without cells must show at least 0.5 px, ten times the tolerance, so a check that cannot see jitter fails.

### Cells off: every cell taken

`?cells=off` turns off only cell culling, not cell-relative positions. So the sketch takes all 511 cells besides the origin's with empty groups near the origin before it builds the scene. The full table then puts the scene's objects and the camera into the origin's cell. There they have a 32-bit position's precision. That is the engine without cells. It needs no engine switch, and it runs the full table's path that users meet. Options that were rejected:

- A switch that caps the cell table. It adds an engine argument and a page switch for a test, and the full table's path already does the same thing.
- A flight without large-world mode as the control. It jitters as much (the last two data rows), because the camera's own position rounds. But it tests the setters, not the cells, so it stays a measurement here and not the control.

### The warning when the cells run out

The table counts each source that enters a new cell while the table is full. The sketch thread reads the count after each frame's batch update, one call into the core, and warns once in the console. The two flights without cells check that the warning comes once in each.

The reason: before this, a full table failed without a word. The object still draws, but in the origin's cell. So it jitters as the flights without cells do: 3.5 px at 1,000 km and 7.75 px at 6,378 km. A developer saw only a scene that shakes far from the origin, with nothing that pointed at the cells. The review of the large-world mode work (M2-H1, 4 October 2026, its issue 14) asked for the warning, and M2-H2 took it on.

- Once per engine, not once per refusal. A scene that runs out of cells can refuse a new one in every frame, and a warning each time would flood the console.
- A count in the core that the sketch thread reads once per frame. The check costs one call and allocates nothing. The core needs no path of its own to the console.
- A warning, not an error code: the scene still draws, and the developer decides whether the lost precision matters.

### Live frames, not hold mode

Hold mode starts an engine for each frame. Five flights of 16 frames would take 80 starts per GPU path. The page instead runs one live engine per flight. The sketch moves the camera when the page asks, and answers after 2 frames at the new place. In pipelined mode the sketch's frame two later means the thread that draws has taken the frame with the new place. Then `captureFrame` reads back the newest frame. Nothing moves between steps, and the governor and dynamic resolution are off, so each frame read back shows one step. The check takes 6 to 9 s per GPU path on the Mac, SwiftShader included.

## Consequences

- Code: `CellTable::refused`, `cellsRefused` in the WebAssembly entry point, `cellTableWarning` in `packages/engine/src/page/limits.ts`, the check in the sketch runner's frame, and `CELL_MAX` among the generated constants.
- Tests: `tests/pages/jitter.html`, `tests/pages/lib/jitter.ts`, `tests/pages/sketches/jitter-sketch.ts`, `tests/image/jitter.spec.ts`, the runner's `jitter` plan, and the unit tests in `tests/lib/jitter.test.ts` and the sketch runner's tests.
- Docs: `concepts/large-worlds` gives the measured stability and the warning. [Image tests](../image-tests.md#large-world-jitter) and [device sessions](../devices.md#the-jitter-plan) describe the check and the plan.
- Skills: the large worlds recipe of `null3d-develop` names the warning.
