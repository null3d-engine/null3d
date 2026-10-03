# D-39: Pointer events on objects

Status: decided. Date: 2026-10-04. Task: M2-D4.

## Question

`object.on(type, handler)` gives objects the pointer events `click`, `pointerdown`, `pointerup`, `pointermove`, `pointerenter` and `pointerleave`. Each event needs a ray at the frame that was on screen when it came ([D-31](D-31-frame-cameras.md)), and a raycast against the scene's trees ([D-30](D-30-scene-queries.md)). The record settles six parts:

1. Which objects a ray tests, and which object gets the event.
2. Whether an event goes on to the object's parents.
3. What counts as a click.
4. How enter and leave follow the pointer, for a mouse and for a finger.
5. When handlers run, and what the engine does in a frame where no object listens.
6. How the dispatch stays free of allocation.

## Rule

- An event reaches the object that the user saw under the pointer, in every thread mode and on every GPU path. A click during a fast camera pan hits what the frame on screen showed.
- A frame in which no object listens copies no event and casts no ray.
- Each `pointerenter` gets one `pointerleave`, unless the object goes first.
- Dispatching allocates nothing in steady state (hard rule 1).
- The API follows the DOM's names and react-three-fiber's model where they agree, so ports from three.js keep their shape.

## Data

| Measure | Result | How |
| --- | --- | --- |
| Moves, presses, releases, clicks, enter and leave on boxes in a group, a box beside them and a panel behind, with the mouse | Every event reached the expected object and then its parents, in order, in the five thread modes on WebGPU, and in pipelined mode on WebGL2 and compatibility mode. Enter and leave came in pairs, a drag of 10 pixels gave no click, and leaving the canvas left the last box | `tests/image/object-events.spec.ts`, Chrome on the Mac, 2026-10-04 |
| Rays cast by pointer events before any handler, and after the last handler went | 0, and no more after the last handler went | Same test |
| Taps on the touch screen | Enter, press, release, click and leave, on the box and on its group | Same test |
| 8 clicks during a pan of 0.05 radians a frame, inside a dome | Every click's ray had the turn of the frame on screen, within 1e-4 radians. In the three pipelined modes, some clicks named a frame older than the one before | Same test |
| Allocation over 10,000 frames of the dispatch, half with a press, a release, a click and moves between two boxes, half with a resting pointer | No place in the dispatch, the frame cameras, the queries, the scene or the core's glue allocates | Same test, with Chrome's heap profiler on the page's own thread |
| The dispatch's rules, with a stand-in for the raycast | 16 unit tests: the log starts and stops with the handlers, rays only for events that have handlers, bubbling, the click's target, the click distance, pairs of enter and leave, rows of a batch, a resting pointer, two fingers, `stopPropagation`, errors in handlers | `packages/engine/src/scene/pointer-events.test.ts` |
| Cost of one ray | 0.96 to 2.6 µs in a scene of 20,000 objects on one thread | [D-30](D-30-scene-queries.md#costs) |

How three.js and react-three-fiber do it, read from their sources on 2026-10-04:

- three.js has no events on objects. An app adds DOM listeners to the canvas, and calls `Raycaster.setFromCamera` and `intersectObjects` in each one. Its examples cast a hover ray in every frame of the render loop.
- react-three-fiber casts rays only against objects that have handlers, its `internal.interaction` list in `core/events.ts`. Objects without handlers never block an event. It passes an event to every object that the ray hits, nearest first, and up each one's parents. A handler that calls `stopPropagation` ends it. `onClick` fires on an object that the press also hit, after a drag of any length. The drag's length is `event.delta`. A click on nothing counts as a miss only under 2 pixels. Hover follows a map keyed by object and `instanceId`, and changes only on pointer events.

## Decision

### The closest object that the camera draws gets the event

Each event casts one ray from the camera of its frame on screen (D-31), on the layers that this camera draws. The closest hit gets the event: an object, or the instance batch of a row. The ring of frame cameras now keeps each frame's camera layers with its matrix and lens. A frame that the ring no longer holds uses the active camera as it stands.

The rejected option was react-three-fiber's: test only objects with handlers, and pass the event to every object hit. It lets a box behind a wall take the click, which the user never saw. A wall without a handler in front of a unit is the common case in games and viewers. The cost of the closest hit is one raycast, the same either way. The cost of the choice is that a see-through object, such as glass or an effect drawn on the same layers, takes events too. The docs give the way around it: a ray of one's own with `camera.screenToRay` and `scene.raycast` on chosen layers.

### Events go on to the parents

After the object's handlers, the event goes to its parent, and on up to the root. An event on a web page goes up through the elements that hold its target in the same way. `event.stopPropagation()` stops it. So a handler on a model's group hears clicks on all its parts. Ports of react-three-fiber put such handlers on a `<group>`. A handler can tell the part by `event.object`. The chain of parents is read before any handler runs. So a handler that moves or destroys an object does not change where the event goes. Instance batches have no parents.

### A click needs the same object, and almost no movement

A click goes to the closest object that was under the pointer at both the press and the release of the main button. A press on one child of a group and a release on another click the group. The DOM's click goes to the closest element that holds both targets in the same way.

The pointer may move at most 2 CSS pixels for a mouse or a pen, and 10 for a finger. A drag that turns an orbit camera must not select what lies under the pointer when it stops. The DOM and react-three-fiber both fire their click after a drag, and leave the check to the app. Nearly every app with camera controls then adds it. Under 2 pixels, react-three-fiber counts a click on nothing as a miss. A finger moves a little as it lifts, and phones' own tap tolerance is about 10 points. So a finger gets 10.

### Enter and leave follow each pointer

The engine keeps the objects under each pointer: the object hit and its parents, with the row of a batch. When a ray hits something new, the objects that the pointer left get `pointerleave`, the object hit first. Then the objects that it came over get `pointerenter`, the outermost first. An object between the two stays entered. A move from one child of a group to another leaves the child and enters the next, and the group hears nothing. These are the DOM's `pointerenter` and `pointerleave`, which do not bubble. Each row of a batch is its own target, as react-three-fiber keys hover by `instanceId`.

While a mouse or a pen rests over the canvas, the engine casts its ray again in each frame. The ray comes from the frame on screen at that moment. It does so only while an object has an enter or a leave handler. So hover follows objects and cameras that move under a still pointer. three.js's examples do the same with a ray in every frame. react-three-fiber updates hover only on pointer events. A box that moves away from a still mouse then stays hovered. The extra ray costs a few microseconds a frame.

A mouse or a pen that leaves the canvas leaves every object. The page sends a new input event for it: `EVENT_POINTER_LEAVE` (9), from the canvas's `pointerleave`. A drag holds the pointer on the canvas, so the browser sends it only once no drag runs. An HTML element over the canvas, such as a label, also makes the browser send it. A finger enters at its press, and leaves after its release and click.

### Handlers run before the update, and nothing runs without them

Handlers run on the sketch's thread at the start of each frame. They run right after the input reader takes the frame's events, and before `onFixedUpdate` and `onUpdate`. Events dispatch in the order they came, and an error in one handler is reported without stopping the rest. Objects are tested where the last frame's update put them, as every query sees them (D-30). So a moving object can be a frame of its motion away from where the user saw it.

The scene counts handlers by type. The first handler hands the input reader a log, and the reader copies each pointer event into it as it reads the ring. The last handler's removal, or its object's destroy, takes the log away. So a sketch without handlers copies nothing and casts nothing. With handlers, an event casts a ray only when a handler needs it. With only `click` handlers, moves cast none, and a release casts one only after a press of the main button. Moves of one pointer that follow each other in a frame share one ray, at their last position.

### No allocation

The event is one object that the engine reuses, and the docs say so. three.js apps and react-three-fiber make new event objects for each event. The event's fractions, the position and the hit, live in one `Float64Array`. Its `x`, `y`, `distance` and `triangle` are getters on that array. In headless Chromium, each fraction stored in an object's field makes a new number object. For the same reason, the raycast for pointer events writes its hit into that array (`SceneQueries.pick`). The ray from the frame cameras takes its point from it too (`FrameCameras.frameRay`). The log is two typed arrays the size of the input ring. Each pointer's state and its chains of objects are made once, for 16 pointers at a time. The chains grow only to the deepest object. Handler lists change by copy when a handler is added or removed, so a dispatch keeps the list it started with.

## Consequences

- `packages/engine/src/scene/pointer-events.ts` holds the dispatch, the log and the types `ObjectEventType`, `ObjectPointerEvent` and `ObjectEventHandler`. `Object3D` and `InstanceBatch` have `on` and `off`, and destroying either removes its handlers.
- The input reader fills the log while one is set, and gives the frame on screen for resting pointers. The page writes `EVENT_POINTER_LEAVE`.
- E1205 also covers an event type that objects do not have.
- `docs/api/input.md` describes the events, `docs/api/objects.md` the calls, and `docs/api/raycast.md` points to both. The develop skill's click-to-select recipe uses `on('click')`, and the porting skill maps react-three-fiber's mesh events.
- A way to keep an object out of pointer events, such as react-three-fiber's `raycast={() => null}`, does not exist yet. A ray of one's own on chosen layers does that work.
