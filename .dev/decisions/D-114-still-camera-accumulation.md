# D-114: Still-camera accumulation

Status: decided and built. Task: M2-F11.

Summary: A view whose scene stops changing draws each frame with the camera's projection moved by a
sub-pixel jitter, and blends the frames into a kept 16-bit history, so the still image converges on
a sharper one. The frame builder decides that nothing changed by comparing the frame it recorded
with the frame of the same parity two frames before, leaving out only what the accumulation itself
changes. After 63 blended frames the thread that draws takes frames without drawing, and the GPU
rests until the scene changes. The first changed frame draws at once.

## Question

How does the engine sharpen a view that does not move and stop the GPU when nothing changes, on
both GPU paths, without showing a frozen screen of a scene that moved?

## Rule

- A still frame must converge on a sharper image than one frame, at no more than one frame's cost
  for each sample.
- The engine must stop drawing a still view within about a second, and must draw the frame after
  the scene changes as a moving view does.
- A missed source of change must read as "changed". The accumulation must never hold a frozen
  image. A failure in the other direction only forgoes the rest.
- Starting or ending a still view must make no GPU object and compile nothing, so the first frame
  of a move costs what a moving frame costs.
- The feature draws on core WebGPU, compatibility mode and WebGL2. It is off in hold mode and in
  the image tests.
- WebGPU keeps its default limits, and the history keeps `rgba16float`
  ([D-77](D-77-final-pass-order-and-formats.md)).

## Data

A simpler form of this design has four faults. The design below removes each:

- Turning the blend on must not change the frame. New passes, a new compile of the graph, new
  textures or a new weight upload in every frame each count as a change. The comparison then sees
  a change in every frame, so a view never settles and never rests.
- The first blended frame must have weight 1. At weight 1/2 it mixes in a history that no frame
  has written.
- The final pass must not run FXAA over the converged image.
- Below render scale 1 the two-step output pass ([D-167](D-167-two-step-output.md)) takes the frame
  over. It then draws the scene color, not the history.

The measurements:

| Measure | Result |
| --- | --- |
| Frames until a still view rests, both frame builders (`crates/null3d-render/tests/still.rs`) | Both rest within the test's bound of 80 frames (64 samples plus the frames the first blend and a change wait for), in every case: both builders, MSAA, FXAA and no anti-aliasing, and a render scale of one half. |
| Frames until a still view rests in Chrome on the Mac, per tier (`tests/image/still.spec.ts`) | WebGPU: 21 frames, 684 ms. Compatibility mode: 19 frames, 666 ms. WebGL2: 19 frames, 651 ms. Each rests again 65 frames after a change draws. |
| The Y sign of the jitter on WebGPU against WebGL2 | One sign serves both: the jitter is added in clip space before naga's GLSL output flips Y, so it moves with the geometry on both paths. The converged images of the tiers match. |
| The converged image against the single frame | The still page's capture is the average of 64 jittered frames, and the image test compares it on each tier. |

## Decision

- The jitter cycles through the Halton sequence of bases 2 and 3. Sample 0 is no offset, so a moving
  view draws as it did. The offset is a fraction of a pixel in clip space, within half a pixel of
  the center. The camera view's frame uniform carries it (16 bytes), and the mesh and sprite vertex
  shaders add it to a position's clip position, scaled by `w`, so geometry and depth agree. Lines,
  points and particles draw without it.
- One kept `rgba16float` target holds the history at the canvas's size. A blend pass draws the
  frame's scene color into it with the pipeline's alpha blending: the shader writes the color times
  the frame's weight, with the weight as alpha, so the history becomes the mix of itself and the
  color. No pass reads and writes the history at once, and no second target holds the mix. The
  weight is one over the frames blended, so the first blended frame replaces the history. A resting
  view's frames have weight 0, so a capture, which draws the last frame again, shows the converged
  image.
- The final pass's still build tone maps the history into the canvas, in one step at any render
  scale, without FXAA, bloom or an outline. It is a second final pass with its own settings and bind
  group, so neither pass rebinds when a view starts or stops being still.
- The blend and the still build are declared whenever the HDR path draws and the page lets a view
  accumulate. Their pipelines are asked for from the frame after the first, so the first frame never
  waits for them, and a view that becomes still later makes no GPU object. Each frame's recording
  picks them or the final pass and the two-step pass's first step. Each frame uploads the blend's
  weight, whether it blends or not.
- The frame builder compares the frame it has just recorded with the frame of the same parity two
  frames before: the draw list's words and the upload arena's bytes, outside marked ranges, joined.
  The marks are the clock and the jitter in each view's frame values, the blend's weight, and the
  commands of the passes that a still frame swaps for others. Marks may differ in number and length
  between two frames, so a blended frame compares equal to the moving frame before it. A frame also
  counts as changed when an object transform, the scene's structure or an instance batch row
  changed. A batch that the engine recomputes every frame, which `dynamic: true` asks for, therefore
  never rests, even when its rows hold the same values: the comparison does not read those rows. A
  sketch that asks for no dynamic batch is unaffected.
- A frame that blends and turns out to have changed takes the whole weight: the builder writes 1
  over the weight in the arena before the frame is published. The first changed frame therefore
  shows itself, not the old history.
- The clock is left out of the comparison, so a frame that draws with a pipeline that reads the
  frame's clock never counts as still: the physical sky, whose stars twinkle, and every custom
  material. A unit test fails when any other shader reads the frame's clock. Shaders that read a
  clock from their own block, such as particles and custom effects, need nothing: the frame
  uploads that block each frame, and the comparison sees it change.
- Two parts of a frame move with the clock while the scene holds still. Each would keep the
  comparison from matching a frame with the frame of its parity two before.
  - WebGL2 writes each view's frame uniform into the next slot of a ring of three. The words that
    name the slot move with it. A settled view takes the slot of its frame's parity instead. The
    frame two before it used that slot, and the uniform outside the clock and the jitter is the
    same, so an older frame still reading it is unaffected.
  - The shadow schedule draws far cascades in turn. A settled view makes every cascade draw. The
    turns change the list, and nothing moves for them to follow.
- A frame that cannot settle compares nothing and keeps no frame: the next frame of its parity
  reads as changed, as after a change. The page's image tests and hold mode therefore record
  without any comparison.
- The core tells the two kinds of frame apart with a second change signal. Its changed stamp
  records every object a dynamic update recomputed, because an object's children recompute from
  it. The second signal, `SceneStorage::rows_changed`, records only the slots whose world row
  differs from the row their parity held. The comparison reads that one. A camera, which the
  engine creates as a dynamic object, therefore does not keep a still view from settling.
- A view never blends while bloom, an outline, an effect that folds into the final pass,
  automatic exposure, the volumetric fog or screen-space reflections draws, on a canvas that keeps
  its alpha, or on the 8-bit path. Their pictures change on the GPU alone, or the blend could not
  average them.
- The thread that draws takes a resting frame but submits nothing, and the sketch keeps stepping,
  so it sees the change that ends the rest. The first frame after a rest records no frame interval.
- Test and benchmark pages default to `?still-camera=off` (`tests/pages/lib/result.ts`): their captures,
  frame counts and timings assume that every frame draws. The still page asks for `?still-camera=on`.

## Consequences

- Code: `still.rs` (the jitter, the state and the comparison), `frame.rs` (the volatile ranges,
  the parity snapshots, `StillMarks` and the weight patch), `frame_data.rs` (the jitter in the frame
  uniform), `accumulate.rs` (the blend), `frame_graph.rs` (the history, the blend, the still build,
  the per-frame pick and the word marks) and `pipelines.rs` (the pipelines that read the clock).
  `accumulate.wgsl` is the blend's shader. The render loop's `Presenter` skips a resting frame.
- The history costs 8 bytes per pixel of the canvas, about 17 MB at 1920 x 1080, on every HDR
  device while the page lets a view accumulate.
- Tests: unit tests of the jitter, the state and the comparison; `crates/null3d-render/tests/still.rs`
  on both frame builders; `tests/image/still.spec.ts` on the three tiers; and the `still` image
  test of the converged frame.
- Docs: `concepts/post-processing`, `guides/phones` (power), `api/post`, and both skills.

## Options rejected

- Two targets, a blend into a second target and a copy back into the history. It costs a second
  full-screen pass and 8 more bytes per pixel, for the same image.
- Declaring the passes only while a view is still. Each start and end of a still view compiled the
  graph and made textures, which the comparison saw as a change, and the first frame of a move
  paid for it.
- Accumulating in the final pass alone. The pass writes the canvas, which it cannot read back, so
  the history needs a pass of its own.
- Deciding stillness from a scene-wide version counter. A missed setter would then freeze the
  screen, which the rule forbids.
- Resting by stopping the sketch. The sketch's step is what sees a change, so it must keep running;
  only the drawing stops.
