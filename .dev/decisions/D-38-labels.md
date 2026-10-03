# D-38: HTML labels that follow the frame on screen

Status: decided. Date: 2026-10-04. Task: M2-D5.

## Question

`ui.trackLabel(object, id, { offset })` in the sketch and `engine.labels.bind(id, element)` on the page put an HTML element over a scene object. In pipelined mode the thread that draws shows an older frame than the one the sketch computes, and under GPU backpressure older still. Where does the engine place each label, how does the place reach the page, and how does the page move the element?

The question has five parts:

1. Which thread projects the labels, and with which code.
2. How the places of the frame on screen reach the page, in every thread mode, with no message per frame.
3. How a label's id finds its place, when ids come and go.
4. How the page moves the elements, and when its own frame loop runs.
5. Where labels match three.js's `CSS2DRenderer`, and where they differ.

## Rule

- In each frame on screen, an element sits within one pixel of where that frame drew its label's anchor. This holds in every thread mode, during a fast camera move.
- The sketch thread and the thread that draws allocate nothing per frame for labels (hard rule 1). The page writes a style only when a value changed.
- A page with no bound element runs no frame loop for labels.
- An element's center sits where `CSS2DRenderer` puts a `CSS2DObject`'s center, so ported pages keep their layout.

## Data

| Measure | Result | How |
| --- | --- | --- |
| Element centers against `CSS2DRenderer`'s formula, a turned and scaled object with an offset, both lenses | Within 0.0005 CSS pixels | `packages/engine/src/scene/scene.test.ts`, "labels" |
| A label on a box while the camera rolls 0.1 radians a frame, about 6 CSS pixels of the box's motion, Chrome on the Mac | See the browser test rows below | `tests/image/labels.spec.ts` |
| The element against the center of the box's red pixels in a held frame | See the browser test rows below | Same test, hold mode |
| Bytes of the label tables at the default capacity | 3 tables × 4,096 labels × 16 bytes = 192 KB, in the control buffer | `shared/labels.ts` |

## Decision

### Projection on the sketch thread, with the camera code that `worldToScreen` uses

After each frame records, the sketch thread projects every label (`sketch/ui.ts`). The anchor is the object's world matrix applied to the label's offset. So the offset turns and scales with the object, as a `CSS2DObject`'s position does under its parent. The projection is `projectPoint` in `scene/frame-cameras.ts`, which `camera.worldToScreen` uses too. So a label and `worldToScreen` in `onLateUpdate` can never disagree. The unit tests compare that one piece of code with three.js. The camera is the active camera of the frame, as the frame camera ring keeps it ([D-31](D-31-frame-cameras.md)). The camera's position is subtracted in 64 bits first, so labels keep their precision far from the origin.

Each label costs one core call, the world matrix read that D-31 made free of allocation, and about 40 floating-point operations. The first design sent many labels to job workers. That needs a projection in the core, with its own copy of the camera's lens, which must stay equal to `worldToScreen`. One TypeScript loop over typed arrays keeps one projection. A page with a few dozen labels, as the showcase scenes have, then costs microseconds. Say a scene with thousands of labels shows the loop in its profile. A core function that projects a list of handles in one call is then the next step.

A label shows when three things hold. Its object and every ancestor are visible, and the camera draws one of the object's layers. The anchor also lies between the camera's near and far planes. These are `CSS2DRenderer`'s rules. It hides an object below an invisible parent, an object off the camera's layers, and a point outside normalized depth -1 to 1.

### Tables in the control buffer, copied by the thread that draws

The label tables live in the control buffer, after the input ring (`shared/labels.ts`). Every thread holds that buffer from the start, the single-threaded build included, so no thread needs a new handoff. It holds three tables of `maxLabels` records:

- one table for each frame parity, which the sketch thread writes as it projects;
- the presented table, which only the page reads.

Each record is 16 bytes: x and y in normalized device coordinates, the depth along the view, and a state word. The page turns x and y into CSS pixels with the canvas's CSS size as it is now. During a resize, the browser stretches the frame on screen to the canvas's new size, so this keeps the element over the stretched image.

`Presenter.draw` in `render/loop.ts` runs in every thread mode, in the thread that draws, as it presents a frame. It copies the frame's parity table into the presented table with `copyWithin`, between two increments of a sequence counter, then stores the frame's number. The sketch thread writes a parity table again only two frames later, after the thread that draws has taken the next frame. That is the same rule that keeps a draw list safe while it replays, so the copy reads a whole table. Low-latency and single-threaded modes present the frame they record, so the copy needs no special case there.

Rejected:

- Places from the sketch's current camera, sent as messages. In pipelined mode they run a frame ahead of the image, and a message per frame allocates on every thread.
- The page reading the parity tables itself. It would need the presented frame's parity, and the sketch could overwrite that table while the page reads it.

### Ids and slots

The sketch gives each id a slot in the tables. It sends the page the id, the slot and the slot's generation once, as a `label` message. Untracking an id, or destroying its object, frees the slot and sends the id with slot -1. The slot's generation changes each time it passes to another label, and the state word carries it in its high 16 bits. So the page never shows an element at the place of the slot's next label, whichever message or frame arrives first. A capacity of up to 65,536 labels keeps the slot within 16 bits. A full table fails with E1219.

### The page's loop

`PageLabels` in `page/labels.ts` keeps the bound elements and the slot of each id.

- Where a worker draws, the page runs a `requestAnimationFrame` loop only while an element is bound. Each callback reads the presented table and does nothing more when the sequence counter and the canvas's size are as before.
- Where the page draws, it moves the elements right after each frame it presents, through the `presented` hook of the frame loops. The elements then change in the same update of the page as the canvas. A loop of its own could run before the engine's frame callback in a browser frame, and show the frame before.
- A read retries while the sequence counter is odd or changed during the read, three times at most, then waits for the next frame.
- Each update reads every label before it writes any style. It writes `transform: translate3d(x, y, 0) translate(-50%, -50%)` only when a label moved by half a CSS pixel or more, and `visibility` only when the label shows or hides. Such writes need no layout.

The page's numbers live in typed arrays. The `transform` value is a new string for each element that moves, as the browser's style API needs. Nothing else on the page allocates per frame.

### Against `CSS2DRenderer`

- The element's center sits where `CSS2DRenderer` puts a `CSS2DObject`'s center by default, `translate(-50%, -50%)` and all.
- `CSS2DRenderer` writes every label's style in every frame. null3D writes only what changed.
- `CSS2DRenderer` hides with `display: none`, which changes layout. null3D uses `visibility: hidden`.
- `CSS2DRenderer` sorts elements by distance and sets `z-index`. null3D leaves the page's order, and has no `center` or `rotation2D`. The depth is in each record, so a later change can add the sort.

## Consequences

- `ctx.ui` with `trackLabel` and `untrackLabel`, `engine.labels.bind`, `createEngine`'s `maxLabels` option and E1219 are public, on `api/ui`, `guides/ui-overlays`, `api/engine` and `api/sketch`, with the develop skill's recipe 7 and the mapping entry for `CSS2DRenderer`.
- Each camera's lens carries its far plane, for the labels' depth test.
- `camera.worldToScreen` and the labels share `projectPoint`.
- The frame loops take a `presented` hook, which only the page's drawing uses.
- `bun run bench:allocation --labels 256` samples S1 with 256 moving labels.
