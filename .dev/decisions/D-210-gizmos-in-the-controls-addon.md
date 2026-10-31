# D-210: Gizmos in the controls add-on

Status: decided and built. Task: M3-K2.

Summary: `@null3d/controls` holds translate, rotate and scale gizmos shaped after three.js's `TransformControls`, and `DragControls` beside them. The handles draw on layers 30 and 29 of their own, which no scene gives out and no camera draws, so a press tests the gizmo alone. A turn takes the exact angle that the pointer sweeps around the axis, where three.js scales a linear approximation, so a long drag can differ by a few degrees.

## Question

Where do the gizmos live, how does a press find a handle without picking the scene's objects, and how closely should the maths follow three.js's `TransformControls`?

## Rule

- One place per feature ([D-173](D-173-addon-hooks.md)): gizmos are an optional editor feature, so they live in `@null3d/controls` and reach the engine through its public API alone.
- Look parity is equivalent or better ([D-52](D-52-intent-parity.md)): a port keeps three.js's option names, and a better technique replaces three.js's own where one exists.
- The public API carries what an add-on needs, and nothing else ([D-173](D-173-addon-hooks.md)).

## Data

| Measure | Handles on the scene's layers | Handles on layers of their own |
| --- | --- | --- |
| A press tests | Every object on the layers, nearest first | The pickers alone |
| A wall in front of a handle | Takes the press, so the handle cannot be grabbed | Stands aside |
| A sketch's own `scene.raycast` on its layers | Hits the handles | Never sees them |

Three.js's `TransformControls` gives the same protection with picker meshes that its raycast tests on their own. Its rotation is `angle = offset · (axis × eye) · 20 / distance`: a linear approximation of the angle that the pointer sweeps. Its translate and scale maths are exact: a plane through the object and a ratio of distances.

## Decision

- `createTransformControls(ctx, camera, options)` makes the handles in the scene and follows `attach(object)`. `update(dt)` reads the input once per frame, as the package's camera controls do, and returns true when it moved the object.
- The handles that draw sit on layer 30 and the pickers on layer 29, both overridable with `layers` and `pickLayers`. The controls add layer 30 to the camera's mask and restore the mask at `destroy`, so the camera draws the handles and never draws the pickers.
- A press is a raycast with `layers: pickLayers` alone. The hit is a picker, and its object's name gives the axis.
- A turn uses the angle between the two pointer arms about the axis, from the screen-facing plane through the object. A move and a scale follow three.js's plane and ratios, and the tests compare both with three.js's own results.
- `DragControls` reports `dragging`, `hovered` and `state` instead of three.js's events, as the camera controls report their state through `update`'s return value.
- The engine has `getLayers()` and `getParent()`: a gizmo adds a layer to the camera and needs the parent's world transform to carry a world move into the object's parent space. Both are three.js API.

## Consequences

- `docs/api/controls.md` describes the gizmos and the drag controls, `docs/api/objects.md` the two getters, and the mapping's `gizmos` entry points at `api/controls`.
- The examples hold the `gizmos` demo, which the image test manifest draws in hold mode.
- `packages/controls/src/gizmo-drag.test.ts` compares a move and a scale with three.js's `TransformControls`, and works a turn's expected angle from the plane that both engines share.
- `tests/image/gizmos.spec.ts` drives the handles with the mouse and with a finger through Chrome's input, for a move, a turn and a scale. The finger's code does not depend on the mode, so the three tests share its path and each shows its own mode's arithmetic.
