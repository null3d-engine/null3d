# D-266: The scene's depth at a render scale below the whole canvas

Status: decided by the M3-F5 helper on. A custom material's `sceneDepth(uv)` and
`sceneDistance(uv)` map the place on the image through the image's render size, not through the
copy's size. The copy keeps the canvas's size.  Task: M3-F5.

Summary: The frame's scene color and depth targets keep the canvas's size at every render scale. A
pass below the whole scale draws into a corner of them. The copy of the opaque depth that a custom
material reads is made at the canvas's size too, with the drawn image in a corner. The lookup that
turns a place on the image into a texel of that copy must therefore use the image's render size. It
used the copy's size instead, so the sampled texel was the pixel divided by the render scale. At
the whole scale the two sizes are the same, and the mapping is the identity. The governor's scale
moves in steps of 50 thousandths from 1 down to each preset's lowest, which is 0.75 at High. The
fault is therefore reachable on a desktop page at the preset that draws the recording. The held
picture tests never saw it until they fixed the scale themselves.

## Question

A custom material that reads the scene's depth turns its fragment position into a place on the
image. The recipe writes that place as `input.fragCoord.xy / frame.resolution`, then calls
`sceneDepth(uv)` or `sceneDistance(uv)`. Where does that place land in the copy of the opaque depth
when the scene draws below the whole scale? Which scales can a page reach at all?

## Data

- `RenderScale::of` makes the render size `ceil(canvas * thousandths / 1000)`, so a render scale
  below 1 gives an image smaller than the canvas on both paths.
- A target of `Size::Full` is made at the canvas's size, and `Size::viewport` gives the pass the
  top-left corner of the render size. The frame graph's `set_render_area` sets the viewport and the
  scissor to that corner.
- The copy of the opaque depth keeps the canvas's size, one texel for each canvas pixel. On WebGPU
  the image lies in the copy's first rows. On WebGL2 the backend flips the viewport, so the image
  lies in its last rows.
- The frame's render size is `frame.resolution`. Its documentation, `view_frame`, gives the target
  size as the size the view draws at, which fragment positions count in. A Rust test,
  `crates/null3d-render/tests/lights.rs`, asserts that it shrinks with the render scale. A place
  `uv` on the image is its pixel divided by that size. That is the pixel that the copy holds at the
  same place when the copy is read with the render size.
- On WebGL2 the CPU-culled path built the views' values while the job workers cull at the canvas's
  full size. The record reused them, so `frame.resolution` there was the canvas's size at every
  scale, while the scene drew a smaller image in a corner. Every screen-place lookup that divides by
  that value then ran past the drawn image. The water's light-from-behind lookup read the copy at the
  canvas's width while the image stopped at the render size. The river went dark past a straight line
  at the scale. The frame values the cull builds now carry the render scale. So `frame.resolution`
  is the render size on every path, as `view_frame` documents it and
  `crates/null3d-render/tests/lights.rs` asserts. The wider check stays open as M3-R28's own task.
  It must show that every screen-position lookup on all three paths divides by the size it should.
  It must also show that nothing else relied on the old value. This record closes the value that
  the water reads.
- The frame-budget governor moves the render scale by `SCALE_STEP`, 50 thousandths. It moves between
  the preset's `minRenderScale` and `maxRenderScale`. The lowest scale of each preset is 0.5 at Low,
  0.6 at Medium, 0.75 at High and 1 at Ultra. A sketch may set both bounds itself.
- At High the lowest reachable scale is therefore 0.75. The owner's two recordings show the water's
  edge at 74.8% of the width and 75.0% of the height. That is that scale.
- At the whole scale the render size equals the copy's size, so the corrected mapping and the old
  one agree on every texel.

## Decision

`scene_depth_texel(place, image_size)` takes the place on the image and the image's size in pixels.
`sceneDepth` gives that size as `frame.target_size`. The helper clamps the place into the smaller of
that size and the copy's. So the one-texel blank group that a draw outside the camera's view binds
still reads its only texel. It flips the row by the copy's height on WebGL2, where the image lies in
the copy's last rows. The copy stays at the canvas's size, so a change of render scale still makes
no texture, view, bind group or pipeline.

The views' frame values now carry the render scale on the CPU-culled path too, so
`frame.resolution` is the render size on every path. A custom material's pixel row on WebGL2 then
turns by the target's height rather than the render size's. The frame writes that height in
`occlusion.y`: the scene target keeps the canvas's height at every scale, and GL's fragment rows
count to it.

The picture tests pin the scale at 0.75, because hold mode has no governor and draws at the preset's
highest scale. They draw the Creek showcase at a near-square canvas from two points on its route.
They also draw the materials recipe's own page at 320 by 180. With the old mapping the recipe's own
page draws 64.229% of its pixels away from the fixed drawing on WebGPU. The Creek draws 0.934% and
1.066% away on WebGPU, and 0.771% and 0.823% on the compatibility path, against the 0.1% that the
tests allow. With this mapping they pass. The WebGL2 Creek pictures are drawn again from this code,
because the frame value that the water's light-from-behind lookup divides by changed there. The
tests that already judge the whole scale keep their pictures unchanged, where the mapping is the
identity.
