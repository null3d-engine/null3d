# D-158: The animation table grows, and a ramp judges completed scene updates

Status: decided, with the ramp's rule by the owner. Built: the growing table, the measure of completed updates, and views that follow the grown table. Not measured yet: Battle's ramp figures with the grown table. Task: M2-R36.

Summary: The engine's animation table grows on demand up to 1,048,576 joints, the joint texture's ceiling. A table fixed at 1,024 objects freezes Battle's ramp near 1,030 units while frames keep presenting. A ramp judges completed scene updates, and stops below 20 fps or at its maximum count.

## Question

What should the engine do when a scene holds more animated objects than the table's capacity? A scene can also stop updating while its frames keep presenting. How should a comparison ramp judge that?

## Rule

The owner ruled: a ramp runs until the scene's update rate falls below 20 fps. It also stops at the comparison's own maximum count. At the maximum the page says "reached the maximum of N at X fps". "Held N" is the largest count at 20 fps or more. The rule covers Battle, Factory, Night town and Busy page.

A capability must not exceed what every device supports. The joint texture's rows fix the ceiling at 1,048,576 joints. That is 512 joints a row over 2,048 rows, the most a device with a 2,048 texture height can hold.

## Data

| Measure | Fixed table at 1,024 | Grown table |
| --- | --- | --- |
| Battle units before the update fails | about 1,030 | about 24,000 (1,048,576 joints) |
| Battle's ramp figure on the Mac, WebGPU, High | held 3,698, scene frozen | not measured yet |
| Battle's ramp figure, Instanced, WebGPU, High | held 7,668, scene frozen | not measured yet |
| Memory for the first growth | none | a copy of the table, in one short pause |

With a fixed table, `createAnimatedInstance` returns E1102 for the 1,025th object. Battle's per-frame `pose()` builds its units first, so the throw stops the update before it moves the camera and the bullets. The engine logs the error once and keeps presenting frames. The bullets stop and the camera stands still while the ramp adds soldiers past 13,000, so its "held" figure is false. The owner saw it in Chrome on the Mac (main `1630e41c4`), and the task's log `logs/r36/diag-1.log` holds the diagnosis.

## Decision

The table grows on demand. `createAnimatedInstance` doubles what it lacks, up to 1,048,576 joints, the joint texture's ceiling. A growth copies the table in one short pause. A growth that the engine's memory cannot hold fails with E1109. Only WebGL2 sets the ceiling: WebGPU shares the same joint texture.

The engine measures completed scene updates. Its measure, `engine.measure`, gives `updatedFps`, the frames per second whose update ran to its end. It also gives `updateErrors`, the count of frames whose update threw. A comparison ramp judges `updatedFps`, so a frozen scene cannot report a held figure. A step whose update failed stops the ramp at once with a scene error. `createEngine` takes `onSketchError`, and the stats overlay shows a red line while updates fail.

## Consequences

- The animation docs give the growing table and its ceiling ([Animation](../../docs/api/animation.md), [Limits of the scene](../../docs/api/scene.md)).
- The comparison page and the ramp judge the scene's rate. The page says which reason stopped each ramp.
- [D-121](D-121-comparison-tier.md) marks every null3D Battle figure above 1,024 units invalid, until a run with this fix replaces them.
- The browser tests run a comparison's ramp on null3D and check that the scene keeps moving. They read a camera signature at each step and check that no step reports a failed update.

## Views follow the grown table

A growth gives every array of the table new memory and frees the old arrays. When the new arrays fit in free memory, the engine's memory does not grow. An animator view that waits for memory growth then writes into freed memory, which may hold other engine data. Those writes are time scales, update intervals, weights, joint overrides and look-at targets. A view sized for the start figure of 1,024 objects loses the writes for later objects, and `lookAt` throws a `RangeError`. Battle's ramp passes 1,024, 2,048 and 4,096 units. D-161's crowd rates call `setUpdateInterval` on far units in every frame. So both faults show there.

- The core counts each move of arrays that TypeScript views (`ARRAYS_MOVED`). A growth of the table steps the count, as a growth of the scene does, and so does the first table of joint overrides.
- The animator makes its views again when the count changes. It sizes each view from the table's capacity (`animationCapacity`), not from the start figure.
- The Rust test `each_move_of_the_animation_tables_arrays_steps_the_count` checks the count. The unit test in `scene/animation.test.ts` grows a fake table past 1,024 objects without memory growth. It checks that the views move, and that object 1,025's time scale, update interval and look-at reach the new arrays.
