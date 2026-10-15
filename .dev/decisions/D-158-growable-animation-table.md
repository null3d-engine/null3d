# D-158: The animation table grows, and a ramp judges completed scene updates

Status: decided. Date: 13 October 2026. Task: M2-R36.

Summary: The engine's animation table once held at most 1,024 animated objects. Battle's ramp then froze above about 1,030 units while frames kept presenting. The table now grows on demand to 1,048,576 joints, and a ramp stops below 20 fps or at its maximum count.

## Question

What should the engine do when a scene holds more animated objects than the table's capacity? A scene can also stop updating while its frames keep presenting. How should a comparison ramp judge that?

## Rule

Owner ruling, 13 October 2026, 14:08: a ramp runs until the scene's update rate falls below 20 fps. It also stops at the comparison's own maximum count. At the maximum the page says "reached the maximum of N at X fps". "Held N" is the largest count at 20 fps or more. The rule covers Battle, Factory, Night town and Busy page. The same session ruled 30 fps at 14:05, then 10 fps at 14:07, then this final figure.

A capability must not exceed what every device supports. The joint texture's rows fix the ceiling at 1,048,576 joints. That is 512 joints a row over 2,048 rows, the most a device with a 2,048 texture height can hold.

## Data

| Measure | Fixed table at 1,024 | Grown table |
| --- | --- | --- |
| Battle units before the update fails | about 1,030 | about 24,000 (1,048,576 joints) |
| Battle's ramp figure on the Mac, WebGPU, High | held 3,698, scene frozen | to be measured after this fix |
| Battle's ramp figure, Instanced, WebGPU, High | held 7,668, scene frozen | to be measured after this fix |
| Memory for the first growth | none | a copy of the table, in one short pause |

The owner found the fault by eye on 13 October 2026, in Chrome on the Mac (main 1630e41c4). He saw the bullets stop and the camera stand still while the ramp added soldiers past 13,000. The diagnosis is in the task's log `logs/r36/diag-1.log`. `createAnimatedInstance` returned E1102 for the 1,025th object. Battle's per-frame `pose()` builds its units first, so the throw stopped the update before it moved the camera and the bullets. The engine logged the error once and kept presenting frames. The ramp's "held" figure was then false.

## Decision

The table grows on demand. `createAnimatedInstance` doubles what it lacks, up to 1,048,576 joints, the joint texture's ceiling. A growth copies the table in one short pause. A growth that the engine's memory cannot hold fails with E1109. Only WebGL2 sets the ceiling: WebGPU shares the same joint texture.

The engine measures completed scene updates. `engine.measure` gains `updatedFps`, the frames per second whose update ran to its end. It also gains `updateErrors`, the count of frames whose update threw. A comparison ramp judges `updatedFps`, so a frozen scene cannot report a held figure. A step whose update failed stops the ramp at once with a scene error. `createEngine` gains `onSketchError`, and the stats overlay shows a red line while updates fail.

## Consequences

- The animation docs give the growing table and its ceiling ([Animation](../../docs/api/animation.md), [Limits of the scene](../../docs/api/scene.md)).
- The comparison page and the ramp judge the scene's rate. The page says which reason stopped each ramp.
- [D-121](D-121-comparison-tier.md) marks every null3D Battle figure above 1,024 units invalid, until a run with this fix replaces them.
- The browser tests run a comparison's ramp on null3D and check that the scene keeps moving. They read a camera signature at each step and check that no step reports a failed update.
