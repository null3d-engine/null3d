# D-31: Rays and screen points from the frame on screen

Status: decided. Date: 2026-10-03. Task: M2-D3.

## Question

`camera.screenToRay(x, y, ray)` turns a point on the canvas into a ray, and `camera.worldToScreen(point, out)` turns a point in the world into a place on the canvas. In pipelined mode the thread that draws shows an older frame than the one the sketch computes. Under GPU backpressure the frame on screen can be older still. Which camera should each call use, and how does the engine keep it?

The question has four parts:

1. Where the cameras of past frames live, and what each entry holds.
2. How `screenToRay` knows that a point came from an input event, and which frame that event saw.
3. Where a ray starts.
4. How the per-frame record stays free of allocation.

## Rule

- A ray through the point of a click hits what the frame on screen showed at that point. This holds in every thread mode, during a camera pan of any speed.
- The record of each frame and both calls allocate nothing (hard rule 1).
- The public call keeps the form that the skills and the three.js mapping already give: `camera.screenToRay(x, y, ray)` with `input.pointer.x` and `input.pointer.y`.
- Rays agree with three.js's `Raycaster.setFromCamera`, unless three.js misses objects that the frame draws.

## Data

| Measure | Result | How |
| --- | --- | --- |
| Perspective rays against three.js's `Raycaster.setFromCamera`, scaled cameras included | Equal to 1e-9 at the center, the corners and an odd point | `packages/engine/src/scene/scene.test.ts` |
| Orthographic rays, from a height and from four edges | three.js's direction to 1e-9; the origin `near` further along it | Same tests |
| `worldToScreen` against three.js's `Vector3.project`, both lenses | Equal to 1e-7 pixels; the ray through the result passes within 1e-9 of the point | Same tests |
| `worldToScreen` 6,378 km from the origin, a point 1 cm off the axis | Within 1e-6 pixels of the exact place | Same tests |
| A click during a pan of 0.05 radians a frame, in each of the five thread modes | Pending the first browser run | `tests/image/screen-rays.spec.ts` |
| Core calls that copy an array through wasm-bindgen | One allocation in the core and two new typed arrays in JavaScript per call; none after the change | The generated glue (`passArrayF64ToWasm0` and `__wbindgen_copy_to_typed_array`) |

## Decision

### The ring of frame cameras

After each frame of the sketch records, the sketch thread keeps the camera it drew from in a ring of the last four frames (`scene/frame-cameras.ts`). An entry holds:

- the sketch frame's number and the camera's handle;
- the camera's world matrix, 12 numbers with the translation in 64 bits, so rays stay precise far from the origin;
- the lens as the frame's canvas shaped it: two scales from device coordinates to the view, the orthographic center and the near distance;
- the canvas's size in CSS pixels, which input positions count in.

The lens takes its aspect ratio from the canvas's size in device pixels, as the core does when it builds the frame's projection. The CSS size can round differently: 401 by 200 device pixels can show on 200 by 100 CSS pixels.

The ring lives in TypeScript, on the thread that runs the sketch. The calls run there and need no core call to read it. The frame's camera is the active camera after `onLateUpdate`, which is the camera the core recorded the frame from. A ring in the core would also serve GPU picking (M2-D6). But picking can take the view-projection from this ring when it records its pass, so the core needs no second copy.

Four frames cover the engine's frames in flight. The thread that draws takes no new frame while two are unfinished on the GPU ([D-11](D-11-frames-in-flight.md)). The sketch runs at most one frame ahead of the frame being drawn. A frame older than the ring, or one drawn from another camera, falls back to the camera as it stands.

### Which frame a point names

The page writes the presented frame's number with each pointer event into the input ring. The sketch's input reader keeps it for the pointer and for each finger. `screenToRay` compares its `x` and `y` with the pointer's and each finger's position. When one matches exactly, the call uses that event's frame. Any other point uses the camera of the frame that last ran, with its lens as it is now.

The rejected option was a fourth argument that names a frame, or a call that takes the pointer object. Both need a public frame number. And a sketch that passes `input.pointer.x` would still get the current camera, the mistake this call exists to prevent. Matching the position needs no new API, and a point at the pointer's position is the pointer's point whichever variable holds it. The positions come from the same 32-bit floats of the input ring, so the comparison is exact.

`worldToScreen` always uses the camera of the frame that last ran. A sketch that calls it in `onLateUpdate` gets the frame that is being recorded. HTML labels (M2-D5) are projected while each frame records, and the thread that draws copies the presented frame's table, so they need no ring.

### Where a ray starts

A perspective ray starts at the camera, as in three.js, so a hit's distance is its distance from the camera. An orthographic ray starts on the near plane. three.js starts it on the camera's own plane. An orthographic near plane may lie behind the camera. three.js's ray then misses objects that the frame draws between the near plane and the camera. A ray from the near plane covers everything the frame draws. Each ray goes through the camera's world matrix, scale included, so it passes through what the frame drew at the point. The unit tests compare every ray with three.js's. Perspective rays match to 1e-9. Orthographic rays have three.js's direction and start `near` further along it.

### No allocation

The core's `worldMatrix` took an array. The generated glue copied it in through the core's general allocator. It copied it back through two new typed arrays on every call. The core now writes the matrix into 12 numbers of its own. TypeScript copies them out through a view in `CoreMemory.readWorldMatrix`, made again only when the memory grows. The world getters (`getWorldPosition`, `getWorldQuaternion`, `getWorldMatrix`) and the debug drawing's object shapes use the same read.

## Consequences

- `camera.screenToRay`, `camera.worldToScreen` and the `Ray` type are public, on `api/cameras`, with the develop skill's section 6 and a mapping entry for `Vector3.project` and `unproject`.
- The input reader keeps each finger's frame, and gives `frameAt(x, y)`.
- The browser test `tests/image/screen-rays.spec.ts` clicks during a pan of 0.05 radians a frame, in every thread mode.
- Raycasts (M2-D2) take `ray.origin` and `ray.direction`. Pointer events on objects (M2-D4) and GPU picking (M2-D6) take the frame camera from this ring.
