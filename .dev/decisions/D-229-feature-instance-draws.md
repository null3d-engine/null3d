# D-229: Draws whose instance count the GPU writes

Status: decided by the helper of M3-E9 on 23 October 2026, for the owner's review. Built: the
opaque main-view path on WebGPU and the CPU-filled batch on WebGL2, with the count copied into the
indirect draw after each compute step. Not built yet: the compute pass that binds the two buffers,
which waits on M3-E8, and the transparent and shadow-many paths. The task is therefore not
complete: without that pass no test can show a compute shader's count becoming the drawn count.
Date: 2026-10-23. Task: M3-E9.

Summary: An add-on's instance draw reserves one indirect entry in each view's existing draw buffer,
and the engine copies the add-on's count word into that entry after every compute step and before
the pass. The count word and the per-instance buffer are engine-created buffers of the draw, so the
add-on's compute pass writes them like any other storage and the engine adds no second compute
surface. WebGL2 has no compute, so the draw is an unculled instance batch that the page fills, and
the same shader reads the same rows on both paths. The first version draws at the opaque point in
the main view alone, and shadow views draw the page's count.

## Question

Hook H2 asks for a draw whose live instance count the GPU writes. What does the add-on write, how
does the count reach the draw's indirect arguments, what does the engine copy and when, and what
happens on WebGL2?

## Rule

D-173's hook table sets the rules: one place per feature, the public API only, and both GPU paths or
a stated fallback. A count that a compute pass writes must be final before the pass that reads it
begins, because Apple's WebKit copies each indirect draw's words when the pass opens. A GPU-written
count cannot be bounded by the engine without an extra pass, so the add-on keeps it within the
capacity and the docs say so.

The count's buffer and the draw's indirect arguments are the engine's, not the add-on's: an add-on
that handed the engine a raw buffer would own a surface that the engine must validate and keep.

## Data

What the engine had before this change:

- **The indirect draws.** Each view owns a buffer of indexed indirect draws, one entry (five words)
  per layout draw and per occlusion phase, with `INDIRECT | STORAGE | COPY_DST` usage. The culling
  shader adds visible sources with `atomicAdd` on each entry's instance-count word.
- **The count surface.** No compute pass could bind a buffer for an add-on, and no draw took its
  count from memory that the page did not write through the CPU.
- **The compute surface (M3-E8).** One storage texture at a fixed binding. D-173's addendum keeps
  it one texture and defers a storage buffer to its first user, which is this hook.
- **WebGL2.** No compute shaders and no storage buffers. The engine's instance batches carry a
  capacity, an active count and per-row matrices, and their rows are culled by the CPU.
- **A batch's rows.** The engine culls a batch row by its sphere, and only a screen-sized sprite
  batch was unculled.

## Decision

### The public shape

```ts
const description = defineFeature({ name: 'splats', frame: 'opaque', kind: 'draw', views: ['main'] });
const draw = await scene.addComputeInstances(description, { shader, vertices, capacity, count });
draw.counts     // the engine's one-word count buffer, for the add-on's compute pass
draw.instances  // the engine's capacity of 16-float instance rows, for the same pass
draw.setCount(n);                        // the page's count, and a shadow view's count
draw.setInstances(rows, n);              // the CPU fill, on WebGL2 and before compute
```

Each instance row is the engine's own: three world-matrix rows with the translation in each row's
`w`, then the ids. A full shader reads a row through `find_instance`, so the same shader draws the
same picture on both paths.

### WebGPU

- The draw's object is unculled and gets a bucket of its own.
- The layout marks its bucket table entry `HIDDEN`, so the culling shader never visits it and never
  counts it. The bucket's draw is recorded as `DrawIndexedIndirect` from the view's existing buffer,
  so the sizing, the bundles and Apple's argument copy stay as they are.
- The frame writes the page's count into the count buffer before its compute steps, so a scene
  without the add-on's compute still draws, and the add-on's compute replaces the word in the same
  frame.
- After every compute step, and once before the render steps, the frame copies the count word into
  the instance count of each of the bucket's indirect draws. A copy between buffers needs a place
  outside every pass, so the render graph gained an `after_compute` step for it.
- A hidden object's entry keeps the reset's zero and its count is not copied, because culling no
  longer removes it the way it removes a hidden object in any other bucket.
- The draw's per-instance buffer binds at vertex slot 1 in place of the view's compacted instances.

### WebGL2

- The draw is an instance batch of the capacity, marked unculled: the page's count decides what
  draws, not the frustum.
- `setInstances` splits each 16-float row into the batch's position, rotation and scale. A sheared
  matrix does not split, which the docs state.
- `setCount` sets the batch's active count, and the CPU path draws exactly that many rows.

### Shadow views

The add-on's compute writes the main view's count alone. A shadow view draws the page's
`setCount` count, which the frame puts into the casters' indirect template before the reset uploads
it. M3-F2 confirms whether splats cast shadows; until then a shadow-casting instance draw draws the
page's count.

### Rejected

- **A second buffer surface for compute.** The count is a buffer that a compute pass writes, so
  this hook is the storage buffer that D-173's addendum deferred. The engine makes the buffer and
  the pass binds it; the add-on declares no layout of its own.
- **A separate count buffer copied into the indirect draw by a pass of its own.** The copy is
  already outside every pass; a pass would add a pipeline and a dispatch to every frame.
- **Writing the add-on's word straight into the indirect entry.** A storage binding's offset must
  meet the device's alignment, which the indirect entry's count word does not, and the entry is the
  engine's to reset.
- **Culling the draw on the GPU with the engine's cull.** The add-on's compute is the cull; a
  second one would count what the add-on already rejected.

## Consequences

- The public API is experimental. Its planned first user, the splats add-on (M3-F2), cannot take
  it: splats draw through the engine's transparent instance batch, whose rows the job workers sort
  back to front, and a GPU-written count would skip that sort; their count also changes only when
  the camera or the budget crosses a threshold, not every frame. The first-user outcome stays unmet
  until an add-on whose count a compute shader writes each frame takes the hook; no vegetation or
  hair add-on exists yet.
- The proof is a picture: `tests/pages/sketches/feature-instances-compute-sketch.ts` fills no
  instance row on the CPU, its compute shader writes 42 rows and the count word, and the draw shows
  exactly 42 quads. The count in that picture is what the shader wrote.
- The docs gain `docs/api/feature-instances.md`, and `docs/api/features.md` and
  `docs/api/feature-draws.md` name it.
- `InstanceBatch.setFrustumCulled` is new on both paths, so a page can keep a batch that its own
  cull decides.
- The compute pass's `buffers` option takes the draw's two handles in binding order, as the fixed
  storage-buffer bindings of its group; the storage buffer's layout is E8's surface to extend, not
  a second surface.

## Addendum 24 October 2026: a bucket that names the draw

The picture tests drew nothing on WebGPU core and in compatibility mode. That held for both the
page-filled count and the compute-written count. The same material and shader drew in an ordinary
mesh. The cause was the bucket key. A bucket's key carries the bounds that `Layout::rebuild` gives
its object. The layout found a bucket's feature draw through the one object that its own bounds
name. The adapter marks its object unculled, because the add-on's own count is its cull. That flag
gives bounds that several objects share. So the bucket held no object. It named no feature draw,
and it bound the view's compacted instances instead of the add-on's buffer. It never received a
count either: the frame skipped it in every count copy, and its indirect entry kept the reset's
zero.

A feature draw's object now takes bounds of its own whatever its flags say. Its bucket then names
the draw and its buffers. Its scene entry stays `HIDDEN` for culling, so the GPU culls none of it.
The unit test for this case set `CUSTOM_BOUNDS`, which the adapter never sets. It now sets the
flag that the adapter sets. It also covers an object with no bounds flags at all.

The fix found a second gap, on the direct-draw path that the start-up probe picks on Apple's GPUs
([D-174](D-174-apple-gpu-direct-draws.md)). That path counts every draw on the CPU. It makes no
indirect buffer, so the frame's count copy had nowhere to write. A scene that holds a
feature-instance draw now takes the indirect path for the whole session. The first frame picks the
path before it creates any path state. An add-on that creates such a draw after the first frame is
not supported on that path. The frame then names a buffer that does not exist, and it stops. The
sketch's setup creates its draw before the first frame, so the shipped sketches take the indirect
path.

## Open fault: the space of the instance rows

The pictures stay empty on WebGPU for a third reason. That reason needs a decision before the API's
contract freezes. The vertex shaders read an instance matrix in **camera-relative** space. This is
the engine's instance format. The frame that culls a scene adds the camera-to-cell offset to each
object's world matrix. `relative_position` then needs no further subtraction. A page writes the
rows that `setInstances` takes as **world** matrices, as the API page says. Nothing converts them
on the WebGPU path. The rows go straight into the add-on's buffer that the vertex shader reads.
The measured result is exact. A page row at the world origin reads as a position on the camera's
own plane. Its clip `w` is zero, and the triangle draws nothing. Rows that carry `-camera` in their
translation draw the expected picture on WebGPU: 4002 bright pixels against none. The same rows
drawn through the WebGL2 batch put the shape elsewhere, because that path places rows in world
space.

The WebGL2 path hides the fault. Its adapter splits each row into an instance batch, whose
positions the engine treats as world. So a page's world rows draw there and nowhere else.

Letting the add-on write camera-relative rows is not enough on its own. The add-on's compute pass
block carries no camera. A page's camera also moves after it has written its rows. Two ways out
are open, and the choice belongs to the owner:

1. Convert on the GPU. A small engine pass adds the frame's camera offset to the rows in place,
   once for each feature draw in each frame. One contract serves both paths, and no CPU work
   repeats. It costs a compute shader and a dispatch for each such draw.
2. Convert as the rows reach the buffer. The engine adds the camera offset to a page's rows when
   it uploads them. It also gives the add-on's compute pass the camera offset in its block, so the
   compute writes camera-relative rows. That repeats an upload of the drawn rows in every frame
   where the camera moves.

Until then the two instance pictures stay black on WebGPU, and the references stay missing. The
engine must not accept a blank picture as a reference.
