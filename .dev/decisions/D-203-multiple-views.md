# D-203: Multiple views draw into rectangles of the camera's scene color

Status: decided by the M3-K1 task, for the owner's review. Built: `scene.createView`, the render graph's rectangle viewport, both frame builders, the `multiple-views` demo with the second view in the joint overrides demo, and the tests. The GPU time and memory on the Mac, the iPad and an S24-class phone are not recorded yet. Task: M3-K1.

Summary: A view draws the scene again from its own camera into a rectangle of the camera's scene color, after the camera's passes, through the viewport and the scissor, with a depth target of its own. It adds one cull and one scene draw at the rectangle's pixels, with no color target and no copy, on both GPU paths and in every thread mode. The camera's view still draws the whole canvas first, so a split screen draws the scene once more than its halves need.

## Question

Three.js draws a second view by calling `renderer.setViewport` and `setScissor` and drawing the scene again. null3D declares its passes, so a view has to take a place in the render graph. Two designs fit:

1. A view renders into a color target of its own, and a full-screen pass copies that image into the rectangle of the final image. Tone mapping and the effects then apply once, to the whole image, but the view needs a color texture and a copy.
2. A view renders directly into the camera's scene color, which the final pass or the resolve pass takes to the canvas. The rectangle's viewport and scissor limit its pixels. The view needs a depth target only.

## Rule

- The image must equal a render of the same camera and rectangle, on both GPU paths and in every thread mode.
- No extra color target and no extra full-screen pass per view where a design avoids them.
- The cost must follow the rectangle's pixels, not the canvas's.
- No new shader, and no change to the scene's draw lists or their bundles.

## Data

The render graph tests (`crates/null3d-render/tests/multiple_views.rs`) record frames on the mock backend for both builders, on the HDR path and the 8-bit path, and read the draw lists:

| Measure | Result |
| --- | --- |
| Render passes added for one view | One, holding its opaque and transparent passes, with the viewport and the scissor at its rectangle |
| Color targets added for one view | None: the view writes the camera's scene color |
| Depth targets added for one view | One, of the canvas's size, which the plan places in a texture that the frame's other views share when their turns do not overlap |
| Full-screen passes added for one view | None |
| Draws of the scene | One more per view, at the rectangle's pixels |
| 8-bit path with MSAA | The same view pass, and the resolve pass joins its step last, so the rectangle resolves into the canvas with the camera's image |
| Render scale below 1 | The viewport that the view draws at follows the render scale, as the camera's does |

GPU time and memory on the Mac, the iPad and an S24-class phone are not recorded yet; the plan asks for them with the task's measurements.

## Options rejected

- **A color target and a copy per view.** It costs a rectangle-sized color texture with MSAA samples and a full-screen pass to copy it, for no image difference. Tone mapping would still run once if the copy came before the final pass.
- **Drawing into the canvas after the final pass.** The tone curve, the grading and bloom would have to run per view, which needs a second final pass and its bind groups, and the 8-bit MSAA path has no final pass to add to.
- **A rectangle viewport on the canvas itself.** WebGPU cannot copy into a swap-chain texture and the canvas has no depth, so a view would still need a copy through the final pass.
- **Occlusion culling for a canvas view.** The depth pyramid maps the view's screen across its whole target, and a rectangle covers part of one, so the lookups would miss. A canvas view culls once: frustum and layers, with no occlusion.
- **A rectangle held in the compiled graph.** The render graph's steps are compiled with their passes. Keeping the rectangle out of the compilation, and reading it from the views when the frame records, lets a sketch move a view in any frame without compiling the graph again.

## Decision

Design 2: a view draws into the camera's scene color, limited by the viewport and the scissor to its rectangle, with a depth target of its own. It adds one render pass, no color target, no full-screen pass and one scene draw at the rectangle's pixels. The image takes the same tone curve, effects and bloom as the camera's view, because it is part of the same scene color before they run.

## Consequences

- **API:** `scene.createView({ camera, rect })` returns a `SceneView` with `setCamera`, `setRect`, `destroy`, `live`, `camera` and `rect`. The rectangle is `[x, y, width, height]` as fractions of the canvas from its top-left corner.
- **Render graph:** a view's rectangle is the render area of the steps that hold its passes, resolved at record time from the views as they stand, so a rectangle change needs no compile and allocates nothing.
- **What a view leaves out:** a view's objects take no ambient occlusion or screen-space reflections, and objects whose material shows a render pass's texture do not draw in it. The camera's volumetric fog and outline are added after the views draw, so they reach a view's rectangle.
- **Docs and skills:** `guides/multiple-views`, `api/scene`, the render graph concept page, the three.js mapping's `viewports` entry, and the develop skill's quick reference and minimap recipe.
- **Demos:** the `multiple-views` demo, and a close-up second view in the joint overrides demo.
