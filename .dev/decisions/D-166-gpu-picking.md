# D-166: GPU picking: which object a pixel shows

Status: decided, 18 October 2026. Task: M2-D6.

Summary: `scene.pick(x, y)` draws the camera's opaque objects once more into an id target. It draws
after the opaque pass and against the same depth. It then copies one pixel back through a promise.
The id pass keeps only the pixels where its own vertex placement meets the scene's depth. The test
is exact on WebGPU. On WebGL2 it is a nearer test with a small bias toward the camera, because two
programs can differ by a rounding step (D-43). A material's mask discarded the fragment that wrote
no depth, so masked objects pick by their mask. The id target has four bytes a pixel, because the
ids pass through a resolve on every device with MSAA. A scene with a source the id target cannot
hold answers with a raycast instead.

## Question

D-30 designed the query API and left GPU picking to this task. It asks which object a screen point
hits, to the pixel. These choices needed settling:

1. What the id target holds, and how a pixel becomes an object and a row.
2. How the pass tests the depth, on both GPU paths.
3. How a multisampled id target is read back, as neither WebGPU nor WebGL2 copies one.
4. Which sources the GPU answers, and what the query does for the rest.
5. Which frame's camera answers, when the sketch and the drawing are pipelined.

## Rule

- `scene.pick(x, y)` returns a promise for `{ object, instance }` or `null`. `x` and `y` are CSS
  pixels, as `camera.screenToRay` takes them.
- The pass runs only in a frame that has a request. It draws the camera's opaque objects with the
  pick template, and adds one resolve pass and a read of four bytes.
- A masked object picks by its mask. A surface thinner than a pixel picks where its pixels are.
- A scene with a whole shader, a blended or transmissive material, or a sprite, point or line batch
  answers the whole pick with a raycast. A raycast tests triangles, so it ignores masks. The
  public docs say so.
- Picks wait in a queue of their own. Each answers in a frame after the one that records it.

## Data

### What the id target holds

The table of object ranges already gives each source a 32-bit key. The key is a scene object's
slot, or a batch row's key in its data texture. The table is in `object_ranges.rs`. `pick_key` in
the pick template writes that key. `pick_color` packs its four bytes into a target of
`RGBA8_UNORM`. An eight-bit target stores each byte as the byte itself, so the key reads back
exactly. The sketch turns the key into a target with the layout's batch bases: the object's slot,
or the batch's core handle and the row.

`RGBA8_UNORM` replaces the `RGBA32_UINT` that the first template used. A multisampled
`RGBA32_UINT` target is 16 bytes a pixel. That is 33 MiB at 1,080p with four samples. The
eight-bit target is 4 bytes, 8 MiB, and it draws multisampled on every device. An integer format's
multisampling is less certain.

### The depth test

`pick.wgsl` places each vertex as the shading template of the same draw does. It has `SKIN` and
`MORPH` builds where the shading has them. On WebGPU the pipeline keeps a pixel only where the two
depths are equal, as D-30's addendum says. On WebGL2 two programs gave depths a rounding step apart
in Chrome on a Mac (D-43). The pipeline there tests for a nearer depth, with a constant bias of
four steps toward the camera. The outline mask's visible draw uses the same bias (D-36). A surface
that wrote the depth passes. An object behind it fails by more than the bias. The bias is tiny
against a real distance, so it cannot reach an object in front of the surface.

A fragment that a mask discarded wrote no depth. Its id fragment does not meet the scene's depth,
so it never wins. A masked object therefore picks by its mask, with no mask code in the pick
shader. A custom material with a vertex offset has its own template's pick builds. They move each
vertex as its surface draws. A whole shader of the sketch's, a blended pair, and a surface that
lets light through have no pick build in the scene's layout.

### Reading a multisampled target

Neither API copies a multisampled texture into a buffer. Neither can pick one sample of a resolve.
WebGPU's resolve and WebGL2's blit average the samples. The average names no object where a pixel's
samples belong to two objects. So the graph first resolves the id target into one sample per pixel.
A resolve pass (`pick_resolve.wgsl`) does that, and the frame copies the picked pixel of its
target. A pixel fully covered by one object resolves to that object's key. A pick exactly on a
silhouette can average two keys, which names no object. The sketch then answers null, or rarely the
object whose key the average happens to name. The public docs do not promise an answer on a
silhouette pixel.

The id target is the render size and takes the scene's samples. A render pass's targets share a
size and a sample count with the scene's depth. The graph declares the pass only while a pick
waits. Its textures exist for the frames of a pick alone. At 1,080p with four samples the id target
is about 8 MiB. The resolved copy is another 2 MiB.

### Which camera answers

The sketch records a pick during the update that reads the input event. The next recorded frame
draws it. The pass must use the depth that the same frame wrote, because the equality test compares
against it. So the camera of the frame that records the pick answers. It is not the camera of the
frame that was on screen at the click. The sketch's camera ring could give the event's view, but
the scene depth of that frame is gone. The public docs state the difference. A still pointer click
is unaffected. A click during a fast pan can name the object under the point in the next frame.

The same rule makes a still camera answer. A frame with a pick's read must draw, so `frameRests`
reports false for it. A rested frame would never copy the ids back.

### The rest of the scene

A scene whose sources all have pick builds and draw opaque answers with the GPU. The core answers
`pickCoversScene` from the layout. It is true when every drawn pair has a pick build, and when the
transparent pass's list is empty. Otherwise the pick answers with a raycast. The ray uses the
camera of the frame that last ran. It tests triangles and ignores masks. This is the documented CPU
path for custom materials that D-30's addendum asks for.

## Consequences

- `crates/null3d-render/src/pick.rs` holds the request, the pick keys, the resolve pipeline's key
  and the readback.
- `frame_graph.rs` declares the pass and its resolve while a pick waits. The render graph's targets
  take a copy usage.
- Both builders hold the pick pipeline of each bucket or draw, the ring's read buffers and the
  resolve pass's bind group. They append the copy and the read after the graph records.
- `crates/null3d-wasm` adds `requestPick`, `pickResultAddress`, `pickCoversScene`, `pickTargetId`
  and `pickTargetRow`.
- `packages/engine/src/scene/picks.ts` holds the queue, the ring and the decoding. `scene.pick` is
  the public call, and `docs/api/raycast` describes it.
- The three.js mapping takes no entry, as three.js offers no pixel pick. The raycast mapping
  entries stay as they are.
- The device proof of the depth test that D-30's addendum asks for is still to run. It covers the
  Mac, the iPad and an Adreno phone. The pick template's WebGL2 path asserts the test with the
  bias. The browser image test draws a thin and a masked object on both GPU paths in Chrome. The
  prototype G7 on the iPad and the cloud S25 follows.
