# D-399: A camera's lens shift moves its image in clip space, in fractions of its view

Status: decided and built. Both kinds of camera have `camera.setLensShift(x, y)` and `camera.lensShift`. The core's projection and the shadow cascades' fit carry the shift. So do the frame cameras' rays and points, the labels, the sprite and particle shaders, and the add-ons that build rays from a camera's lens. Task: none.

Summary: A lens shift moves the projected image by twice its fractions of the view's width and height, after the perspective division. A real shift lens does the same, and so does three.js's `setViewOffset` on a full view. The projection carries the shift, so culling, picking, views, the light grid and the effects that invert the projection follow it unchanged.

## Question

A page that shows a scene beside its text wants the subject off center without turning the camera, which changes the perspective. three.js offers `camera.setViewOffset(fullWidth, fullHeight, x, y, width, height)`. Which call, which units, and where does the shift live, so that everything that reads the camera's view sees the shifted one?

## Rule

- The shifted image is exactly the matching crop of a wider image from the same camera: same perspective, same pixels.
- Everything that depends on the camera's view follows it. That covers culling, the shadow cascades, picking, `screenToRay`, `worldToScreen` and labels. It also covers views from `scene.createView`, and the post effects that rebuild positions from depth.
- No allocation in the setter or the frame (hard rule 1). A core call takes whole numbers only, so the shift goes through the call values.
- A camera with no shift draws exactly as before, bit for bit.

## Data

| Measure | Result | How |
| --- | --- | --- |
| A shifted, narrowed lens against the matching crop of a wider lens, both kinds | Same place to 1e-4 and same depth to 1e-5 in normalized device coordinates | `a_shifted_view_is_the_matching_crop_of_a_wider_view` in `crates/null3d-render/src/camera.rs` |
| The projection's third column against three.js's `setViewOffset` on a full view | Equal to 1e-6 | `a_lens_shift_matches_three_js_s_view_offset_on_a_full_view` |
| `screenToRay`, `worldToScreen`, a view's ray and 2D labels against three.js with `setViewOffset` | Rays to 1e-9, screen points to 1e-7 pixels | `packages/engine/src/scene/scene.test.ts` |
| Orbit controls' zoom toward the pointer with a shifted lens, against three.js's | The same camera after each frame, both kinds | `packages/controls/src/orbit-controls.test.ts` |
| A shifted view's shadow cascades | Every point of each slice lands in its cascade; each slice's sphere holds its eight corners | `crates/null3d-render/src/shadows.rs` |
| A view of the shifted camera over its quarter of the canvas, against the wide camera's frame, Mac GPU, Chrome | WebGPU: no pixel differs, both lenses. WebGL2: 98 of 76,800 pixels differ by more than 16 steps (perspective) and 0 (orthographic), with a mean difference of 0.14 and 0.20 steps | `tests/image/lens-shift.spec.ts` |
| The shifted camera alone on a 320 × 240 canvas, against the top-right quarter of the wide camera's frame on a 640 × 480 canvas, Mac GPU, Chrome | WebGPU: 1 and 0 pixels differ (perspective, orthographic), mean 0.47 and 0.45 steps. WebGL2: 57 and 2 pixels, mean 0.66 and 0.64 steps | Same test |
| The same test with the shift left out of the lens | 13% to 75% of the pixels differ, with means of 7 to 52 steps, so every case fails | Same test, with the sketch's shift set to 0 |

The browser test does not tell the cascades' fix apart: with the fit's old corners its figures stay the same, because a narrow view's slice spheres reach well past its sides. The core's unit tests catch the old fit, which leaves points of a shifted slice outside their cascade.

## Look

The options differ in look only where one of them misses a consumer. A turned camera, the workaround that the options replace, makes upright lines lean and shows the subject from another side.

## Decision

The call is `camera.setLensShift(x, y)`, with `camera.lensShift` reading `[x, y]`. `x` moves the view right by that fraction of its width, and `y` moves it up by that fraction of its height. These are a shift lens's units, a photographer's rise and shift. On a full view, three.js's `setViewOffset` gives the same fractions: `x / fullWidth` and `-y / fullHeight`. Fractions of the view keep their meaning on any canvas size, where pixels would need the page's size in the sketch.

The core keeps the shift on each lens. `Lens::projection` moves clip space by `-2 × shift` times w, the same step as the temporal jitter (`camera::shift_clip`, which `taa::jittered` calls too). So the view-projection, its inverse and the frustum all carry it. Everything that reads them follows: culling, occlusion, the light grid, picking and mirrors. So do depth of field, ambient occlusion, screen-space reflections, the volumetric fog, contact shadows and custom effects' `effectViewPosition`.

The parts that built the view from the field of view alone add the shift:

- The shadow cascades' fit: a slice's corners and its bounding sphere. A shifted slice's corners lie on circles around the line through the camera and the view's middle, not around the axis. So the sphere's center moves onto that line, where its near and far corners are equally far. A term for the corners' reach along the line joins the old formula. With no shift the terms vanish, and the fit makes the same sphere as before.
- The frame cameras' rays and screen points, and the labels' camera record. The 3D labels' container moves the whole image after the perspective, as three.js's `CSS3DRenderer` moves its view element.
- Sprites and particles, which took the camera's right and up axes from the view-projection's rows. A perspective shift adds some of the view's axis to those rows. The shaders take that share out (`screen_axis` in `null3d::globals`), which takes the jitter out too.
- The debug frustum, the orbit controls' rays, the grass add-on's tile cull and the water add-on's underwater sight lines.

Rejected:

- A view offset in pixels of a larger picture, as three.js's `setViewOffset` takes. It mixes two features: the shift and a narrower lens for a tile. A sketch already narrows a lens with `setFov` or `setOrthoHeight`, and the docs and the mapping give the numbers for a tile.
- A shift in fractions of the larger side, as Blender's shift does. A shift of 0.5 then reaches the edge on one axis only.
- A turned camera, the port's workaround. It changes the perspective.

## Consequences

- `docs/api/cameras.md` has a "Lens shift" section, and the three.js mapping maps `setViewOffset` and `clearViewOffset`. The content pages guide and both skills say to shift the lens rather than turn the camera.
- The depth of field demo's framing choice and its L key turn the shift on.
- A lens shift is not one of the properties that hold scripts and animation clips set.
