# D-114: Still-camera accumulation

Status: proposed. Date: 2026-10-13. Task: M2-F11.

Summary: A view whose scene stops changing draws each frame with the camera's projection moved by a
sub-pixel jitter, and blends the frames into a kept 16-bit history, so the still image converges on
a sharper one. The frame builder decides that nothing changed by comparing the frame it recorded
with the frame of the same parity two frames before. Once enough frames are accumulated, the thread
that draws takes frames without drawing, and the GPU rests until the scene changes. This record
holds the design; the measurements below are still owed, so its status is proposed.

## Question

How does the engine sharpen a view that does not move and stop the GPU when nothing changes, on
both GPU paths, without showing a frozen screen of a scene that moved?

## Rule

- A still frame must converge on a sharper image than one frame, at no more than one frame's cost
  for each sample.
- The engine must stop drawing a still view within about a second, and must draw again on the frame
  after the scene changes.
- A missed source of change must read as "changed". The accumulation must never hold a frozen
  image. A failure in the other direction only forgoes the rest.
- The feature draws on core WebGPU, compatibility mode and WebGL2. It is off in hold mode and in
  the image tests.
- WebGPU keeps its default limits, and the history keeps `rgba16float`
  ([D-77](D-77-final-pass-order-and-formats.md)).

## Data

The measurements are not taken yet. Each figure below names what it must decide.

| Measure | What it decides |
| --- | --- |
| The Y sign of the jitter on WebGPU against WebGL2 | Whether one jitter serves both paths or each needs its own sign |
| The converged image against the single frame, on the Mac and SwiftShader | That the accumulation sharpens, and the references for its image tests |
| The GPU time of the accumulation steps at the render scale of each preset | Whether the feature stays on by default |
| The frames to converge and the frames to rest | `MAX_SAMPLES`, and the sharpness against the time to rest |

How the data will be produced: an image test of a still scene, its reference taken from the
converged frame; `bun run bench:bench` with the switch on and off; `bun run bench:gpu-check`.

## Decision

Proposed, pending the data.

- The jitter cycles through the Halton sequence of bases 2 and 3. Sample 0 is no offset, so the
  first frame of a still view is the frame a moving view draws. The offset is a fraction of a pixel
  in clip space, within half a pixel of the centre.
- The camera view's frame uniform carries the jitter, which the vertex shaders add to a position's
  clip position, scaled by `w`, so geometry and depth agree. The frame uniform grows by 16 bytes.
- A kept `rgba16float` texture holds the history at the render size. A blend step reads the scene
  color and the history and writes the average into a target, and a store step copies that target
  into the history, because one pass may not both read and write the history. The weight of a frame
  is one over the frames it joins.
- The final pass reads the blended target in place of the scene color while the view is still, and
  skips FXAA, because the accumulation smooths the edges instead.
- The frame builder compares the frame it has just recorded with the frame of the same parity two
  frames before it: the same draw list, the same upload arena, and no object transform changed. The
  clock and the jitter are the only values a still frame writes each time, and the comparison skips
  them. The accumulated count falls to zero on the first frame that differs.
- The frame builder stays one frame behind: a frame draws with the jitter and the weight that the
  frame before it settled, which costs nothing visible and lets the comparison run after recording.
- The thread that draws takes a frame but submits no draw once the count reaches the limit. The
  sketch keeps stepping, so it can see the change that ends the rest.
- The feature does not draw while bloom, an outline or a folded effect draws, and on the 8-bit
  path. Those combinations draw as they do now.

## Consequences

- Code: `still.rs` (the jitter, the state and the comparison), `frame.rs` (the upload arena's
  volatile ranges, the parity snapshots and the still state), `frame_data.rs` (the jitter in the
  frame uniform), `accumulate.rs` (the blend and store steps) and `frame_graph.rs` (the history, the
  steps and the final pass's still build). `accumulate.wgsl` is a shader of its own, with the store
  build as a flag rather than a permutation.
- The generated draw-list constants take template 40, bind layout 26 and a 16-byte settings block.
- Tests: unit tests of the jitter and the comparison, an image test of a converged still scene on
  the three tiers, and a browser test that a still scene stops drawing and draws again when the
  scene changes.
- Docs: `concepts/post-processing`, `guides/phones` (the power it saves) and `api/post`, plus both
  skills' anti-aliasing notes.

## Options rejected

- A per-pixel blend constant for the average. WebGPU has no blend constant, so the two paths would
  need different mechanisms.
- Accumulating in the final pass alone. The pass writes the canvas, which it cannot read back, so
  the history needs a pass of its own.
- Deciding stillness from a scene-wide version counter. A missed setter would then freeze the
  screen, which the rule forbids.
- Resting by stopping the sketch. The sketch's step is what sees a change, so it must keep running;
  only the drawing stops.
