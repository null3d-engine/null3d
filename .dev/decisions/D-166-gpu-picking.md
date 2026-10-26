# D-166: GPU picking: which object a pixel shows

Status: decided. Built: the GPU pick on both GPU paths, and its texture coordinates from a raycast.
Also built: the rejection of a pick that waits when the GPU device is lost. Not built yet: the
device proof of the depth test on the Mac, the iPad and an Adreno phone. Task: M2-D6, M3-A1,
M3-R35.

Summary: `scene.pick(x, y)` draws the camera's opaque objects once more into an id target of four
bytes a pixel, and copies one pixel back through a promise. The depth test against the opaque pass
is exact on WebGPU and has a small bias on WebGL2 (D-43). Masked objects pick by their mask. A
raycast through the same point gives the texture coordinates. It also answers the whole pick in a
scene with a source that the id target cannot hold.

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
- A pick that waits for its read when the GPU device is lost is rejected with E1436. It is not
  asked again on the new device. A pick still queued behind it was never recorded, so it goes to
  the new device in its turn.

## Data

### What the id target holds

The table of object ranges already gives each source a 32-bit key. The key is a scene object's
slot, or a batch row's key in its data texture. The table is in `object_ranges.rs`. `pick_key` in
the pick template writes that key. `pick_color` packs its four bytes into a target of
`RGBA8_UNORM`. An eight-bit target stores each byte as the byte itself, so the key reads back
exactly. The sketch turns the key into a target with the layout's batch bases: the object's slot,
or the batch's core handle and the row.

The eight-bit target is 4 bytes a pixel, 8 MiB at 1,080p with four samples, and it draws
multisampled on every device.

### The depth test

`pick.wgsl` places each vertex as the shading template of the same draw does. It has `SKIN` and
`MORPH` builds where the shading has them. On WebGPU the pipeline keeps a pixel only where the two
depths are equal, as D-30's addendum says. On WebGL2 two programs can give depths a rounding step apart,
as in Chrome on a Mac (D-43). The pipeline there tests for a nearer depth, with a constant bias of
four steps toward the camera. The outline mask's visible draw uses the same bias (D-36). A surface
that wrote the depth passes. An object behind it fails by more than the bias. The bias is tiny
against a real distance, so it cannot reach an object in front of the surface.

A fragment that a mask discarded wrote no depth. On WebGPU the equal test rejects its id fragment,
so a masked object picks by its mask. On WebGL2 the biased test would keep it. The pick shader
therefore repeats the material's cutoff test, reading the material's alpha, the vertex alpha and
the base color map's alpha. A standard material binds every map slot; an unlit map binds the base
color map alone. Each has a pick template of its own. Coverage and hash masks keep to a raycast, since
an id target of one sample per pixel does not draw their patterns. A custom material with a vertex
offset has its own template's pick builds; a masked custom material keeps to a raycast. A whole
shader of the sketch's, a blended pair, and a surface that lets light through have no pick build in
the scene's layout.

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
size and a sample count with the scene's depth. The graph declares the passes when the first pick
waits and leaves them declared. A frame without a pick skips their step, and their targets stay in
the plan. No later plan then releases one while a copy may still read it. At 1,080p with four
samples the id target is about 8 MiB and the resolved copy another 2 MiB. Both stay on every frame
after the first pick. The layout holds its pick pipelines for a few frames after a read. A scene
change just after an answer therefore cannot drop them before the sketch reads it.

### Which camera answers

The sketch records a pick during the update that reads the input event. The next recorded frame
draws it. The pass must use the depth that the same frame wrote, because the equality test compares
against it. So the camera of the frame that records the pick answers. It is not the camera of the
frame that was on screen at the click. The sketch's camera ring could give the event's view, but
the scene depth of that frame is gone. The public docs state the difference. A still pointer click
is unaffected. A click during a fast pan can name the object under the point in the next frame.

The same rule makes a still camera answer. A frame with a pick's read must draw, so `frameRests`
reports false for it. A rested frame would never copy the ids back.

### A pick when the GPU device is lost

A pick in flight waits for the GPU to copy its four bytes back. When the browser takes the device
away, recovery replaces it and raises the GPU epoch, and every GPU object of the old device is
gone. The read that the old device recorded never lands, so the pick's control slot stays unraised
and polling waits forever.

Each pick in flight therefore remembers the epoch it was recorded for. The frame loop rejects the
pick once the epoch moves. Its promise settles with E1436, and the pick is not asked again on the
new device. A pick in the queue behind it holds no read, so it is sent to the new device in its
turn. Rejecting rather than re-asking is the owner's ruling, made for M3-R35: a repeated pick
would answer from a later frame, after the scene may have moved.

### The rest of the scene

A scene whose sources all have pick builds and draw opaque answers with the GPU. The core answers
`pickCoversScene` from the frame that recorded the read, not the frame that polls for it. The
scene can change between the two, and a later frame may have dropped the pick builds. It is true
when every drawn pair had a pick build, and when the transparent pass's list was empty. Otherwise
the pick answers with a raycast. The ray uses the camera of the frame that last ran. It tests
triangles and ignores masks. This is the documented CPU path for custom materials that D-30's
addendum asks for.

### A pick's texture coordinates

`scene.pick` gives the `uv` and `hasUv` fields that a raycast and a pointer event carry. A page that
clicks an in-world screen then needs no plane math of its own.

The id target holds the source key of a pixel and nothing else. A key names the object or the
instance row, not the triangle under the pixel, so the pick cannot read the coordinates from the
target. A raycast through the same point gives them, from the camera of the frame that recorded the
pick. The core already blends a triangle's first texture coordinates for a raycast, so nothing new
computes them. The ray costs one CPU query per pick, which is a user interaction, and no GPU memory.

The core records the engine frame that drew the landed pick, and `pickFrame` gives it to the sketch.
`FrameCameras.frameRay` then casts the ray with that frame's camera. So the coordinates match the
frame that produced the object answer. The sketch keeps the id target's answer as the source. A ray
that meets another source, or none, leaves `hasUv` false. It never names a triangle that the pixel
did not show.

The coordinates stay the mesh's own, as a raycast's do. A repeated texture reports values past 1,
and a material's `uvTransform` does not move them. A skinned or morphed character, and a custom
material that offsets vertices, draws a shape that the ray does not test. Their coordinates
describe the mesh's own triangle, and can differ from the drawn pose. The API page says so.

## Options rejected

- **An id target of `RGBA32_UINT`.** Multisampled, it is 16 bytes a pixel, 33 MiB at 1,080p with
  four samples. An integer format's multisampling is also less certain.
- **A second target for the texture coordinates.** The pick pass would write them in four bytes a
  pixel. That costs about 41 MB at 1080p with four samples, plus the single-sample copy that a read
  takes, and a second resolve. Every page that picks at all would pay that memory for a pick that
  otherwise costs one draw and a read of four bytes.

## Consequences

- `crates/null3d-render/src/pick.rs` holds the request, the pick keys, the resolve pipeline's key
  and the readback.
- `frame_graph.rs` declares the pass and its resolve while a pick waits. The render graph's targets
  take a copy usage.
- Both builders hold the pick pipeline of each bucket or draw, the ring's read buffers and the
  resolve pass's bind group. They append the copy and the read after the graph records.
- `crates/null3d-wasm` adds `requestPick`, `pickResultAddress`, `pickCoversScene`, `pickTargetId`
  and `pickTargetRow`.
- `packages/engine/src/scene/picks.ts` holds the queue, the ring, the epoch of each read in flight
  and the decoding. `scene.pick` is the public call, and `docs/api/raycast` describes it.
- The three.js mapping takes no entry, as three.js offers no pixel pick. The raycast mapping
  entries stay as they are.
- The device proof of the depth test that D-30's addendum asks for is still to run. It covers the
  Mac, the iPad and an Adreno phone. The pick template's WebGL2 path asserts the test with the
  bias. The browser image test draws a thin and a masked object on both GPU paths in Chrome. The
  prototype G7 on the iPad and the cloud S25 follows.
- Tests: `packages/engine/src/scene/picks.test.ts` checks the queue's decoding with the ray's
  frame. It also checks a pick that names no frame, another source and a mesh without coordinates.
  It rejects a pick whose device was lost, and sends the picks behind it to the new device.
  `tests/image/pick.spec.ts` loses the device with a pick in flight, on both GPU paths, and checks
  that the promise rejects with E1436. `tests/image/pick-uv.spec.ts` compares a pick with a raycast
  and with the geometry on both GPU paths. It covers a repeated set, a texture transform, a batch of
  rows that differ in scale, and a mesh with no coordinates.
