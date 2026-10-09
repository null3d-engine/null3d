# D-110: Pointer lock, and one set of first-person controls for two three.js controls

Status: decided by the M2-P1 helper. Date: 2026-10-08. Task: M2-P1.

Summary: The page asks for the pointer lock with `engine.requestPointerLock()`, which resolves when the lock begins and fails with E1425. While the canvas holds the lock, the page writes the mouse's movement into the input ring in place of its position. The sketch reads it as `input.pointer.dx` and `dy`, and `input.pointer.locked` is true. One call, `createFirstPersonControls`, acts as three.js's `FirstPersonControls` without the lock, and as its `PointerLockControls` with it.

## Question

How does a locked pointer's movement reach the sketch, which runs in a worker and reads input once per frame? And how do null3D's controls cover three.js's three first-person and fly controls: `FlyControls`, `FirstPersonControls` and `PointerLockControls`?

## Rule

- Only the page can lock the pointer, and browsers lock it only right after the user acts (transient activation). So the request is a page call.
- The sketch reads all input from the input ring once per frame, and reading allocates nothing. The lock must add no second path for input.
- Each set of controls must reach three.js's pose for the same input, as M1-I2's orbit and map controls do.
- A port of three.js code should change as little as it can.

## Data

What browsers do while the pointer is locked, from the Pointer Lock specification and the browsers' behavior:

| Field | While locked |
| --- | --- |
| `clientX`, `clientY` | Stay where the lock began |
| `movementX`, `movementY` | The mouse's movement since the previous event, with no edge to stop it |
| `pointerleave` | Never comes: the pointer cannot leave the canvas |

How browsers answer `requestPointerLock()`: Chrome returns a promise that rejects with the reason, such as `NotSupportedError` for `unadjustedMovement` where it cannot give it. Chrome also refuses a new lock for about a second after the user pressed Esc. Other browsers answer only with a `pointerlockchange` or `pointerlockerror` event on the document, and the error event gives no reason. Phones have no pointer lock.

What the three.js controls do (three.js r186):

| Controls | Look | Move |
| --- | --- | --- |
| `FlyControls` | The pointer's place on the canvas sets a turn speed. Arrows, Q and E turn and roll | Keys along the camera's own axes; the left and right buttons move forward and back |
| `FirstPersonControls` | A drag's length from its press sets a turn speed, which eases in and out | Keys over the ground; a press walks along the view; speeds ease |
| `PointerLockControls` | Each locked mouse move turns the view by 0.002 rad per pixel, within polar limits | None: the app moves the camera with `moveForward` and `moveRight` |

## Options

The input ring:

| Option | For | Against |
| --- | --- | --- |
| (a) A new event type that carries the movement beside each pointer move | Position and movement both reach the sketch | Two records per move, and the position does not change while locked anyway |
| (b) A flag on pointer records, whose X and Y then hold the movement, and an event for the lock's start and end (chosen) | One record per move, as now. `pointer.dx` and `dy` give the movement with no new field, so orbit controls and sketch code work while locked | Records mean two things, so code that reads X and Y must check the flag: the reader and the log of pointer events on objects |
| (c) A virtual position: the lock's place plus the summed movement | No change to the record format | The position leaves the canvas, so picking and `ndcX` give nonsense |

The controls:

| Option | For | Against |
| --- | --- | --- |
| (d) Three sets of controls, one for each three.js class | One-to-one names | `PointerLockControls` alone has no keys and no update, and needs a lock state that only the page knows. Two first-person sets would share most of their code |
| (e) Fly controls, and first-person controls that turn as `PointerLockControls` while locked (chosen) | One call covers first-person views with and without the lock. The mapping already named this pair | `PointerLockControls` code sets `movementSpeed: 0` so the keys do not also walk. `lock`, `unlock` and their events have no equivalent |

## Decision

(b) and (e).

- While the canvas holds the lock, each pointer record carries `FLAG_LOCKED`, and its X and Y hold `movementX` and `movementY`. The reader adds them to `dx` and `dy` (and `dragDx` and `dragDy` while a button is held) and leaves the position alone. The page writes `EVENT_POINTER_LOCK` when the lock begins or ends, and when it stops or starts listening, so `input.pointer.locked` is never stale. The log of pointer events on objects skips locked records: their X and Y point at nothing.
- `engine.requestPointerLock(options)` resolves on `pointerlockchange` to the canvas. It rejects with E1425 on the browser's rejected promise, which gives the reason, or on `pointerlockerror` where the browser gives no promise. Destroying the engine ends a lock it holds.
- First-person controls step `FirstPersonControls`' update each frame. While locked, the frame's movement turns the view as `PointerLockControls` turn it, and a drag neither looks nor walks. The view then stays within `minPolarAngle` and `maxPolarAngle`, in place of the drag's 85 degree limit. They also offer `moveForward`, `moveRight` and `getDirection`.
- Both sets keep the camera's pose in double precision, as three.js does, and take the camera's pose only when the sketch changed it ([camera-pose.ts](../../packages/controls/src/camera-pose.ts)).
- Damping in first-person controls applies a share that suits the frame's step, `1 - (1 - dampingFactor)^(60 dt)`, as orbit controls do. three.js applies `dampingFactor` once per update, so at 60 frames per second both match.

Known differences, which [Camera controls](../../docs/api/controls.md#differences-from-threejs) lists:

- The locked moves of one frame add up before the polar limits apply. three.js clamps after each move.
- First-person controls never roll the camera.
- With two fingers down, the first finger turns the view.
- In fly controls, the keys add to the pointer's turn. In three.js the last of them wins.

The unit tests feed the same scripted input to null3D's controls and to three.js's, and compare the poses after each frame. Fly controls have 7 such tests, and first-person controls 11. A browser test locks the pointer in Chrome and checks that the engine's first-person controls reach the pose of three.js's `PointerLockControls` on the same canvas.

That test runs in Playwright's full Chromium build in Chrome's own headless mode, not in Playwright's headless shell, which the other SwiftShader tests use. The headless shell, Chromium 153 with Playwright 1.63, gets the lock wrong in two ways. On Linux, as in CI, it grants the lock. But each mouse move under the lock reports the pointer's position as its movement, and then the same movement back. The moves add up to nothing, so neither camera turned, and the test failed in CI. On a Mac it refuses the lock with `WrongDocumentError`. Playwright's mouse cannot set the movement itself, as Chrome DevTools' mouse event has no movement field. The full build reports the movement as Google Chrome does, on Linux and on a Mac. The browser's own reason can end with a full stop, as `WrongDocumentError`'s does, so E1425's message drops it before adding its own.

## Consequences

- `shared/control.ts` gains `EVENT_POINTER_LOCK` and `FLAG_LOCKED`. `page/input.ts` writes them, `sketch/input.ts` reads them, and `InputPointer` gains `locked`.
- `page/pointer-lock.ts` holds the request, and `Engine` gains `requestPointerLock`. The error table gains E1425.
- `@null3d/controls` gains `createFlyControls` and `createFirstPersonControls`.
- Docs: `api/controls`, `api/engine`, `api/input`, and the mapping entry `fly-controls`. Skills: the develop skill's quick reference and the port skill's controls table.
