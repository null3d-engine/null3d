# D-229: Draws whose instance count the GPU writes

Status: decided by the helper of M3-E9 on 23 October 2026, for the owner's review. Built: the
opaque main-view path on WebGPU and the CPU-filled batch on WebGL2, with the count copied into the
indirect draw after each compute step; the compute pass that binds the two buffers (M3-E8), drawn
by the `feature-instances-compute` picture on WebGPU and in compatibility mode; the conversion of
the world rows to camera-relative rows; and the count in the shadow views (the addendum below).
Not built yet: the transparent path and the shadow-many path. The task also waits for its first
real user, since the splats add-on cannot take the hook. Date: 2026-10-23. Task: M3-E9.

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
draw.setCount(n);                        // the count word's start, and the CPU path's count
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

## Addendum 24 October 2026: the rows are converted on the GPU

The owner chose option 1: the engine converts the rows on the GPU. The conversion is one compute
dispatch for each draw in each frame, so a camera that moves costs no upload of the page's rows.

### The design

- The draw's instance buffer that the page and the add-on's compute write holds **world** rows, as
  the public contract says. The draw reads a second buffer of the same size, which the engine
  owns and fills each frame with the camera-relative rows.
- The conversion shader (`feature_rows.wgsl`) reads the camera's absolute world position from its
  block, the draw's count word, and each live instance's three matrix rows. It writes each row's
  `w` minus the camera's position on that axis, and copies the ids unchanged. The dispatch covers
  the draw's capacity, and the shader returns above the count, so a large capacity with a small
  live count converts only its live rows.
- The conversion reads the world buffer and writes the second buffer, rather than changing the
  world buffer in place. In place, each frame would subtract the camera again from rows that the
  previous frame had already converted, unless the page re-uploaded its rows or the add-on's
  compute rewrote every live row every frame. The second buffer makes the conversion a function of
  the world rows alone, so both update paths serve it.
- The bind group of a draw is `layout::FEATURE_ROWS` (60): the camera's block, the count word, the
  world rows and the rows it writes. The pipeline is `template::FEATURE_ROWS` (83). The camera's
  block is the conversion's own 16-byte uniform buffer, not the add-on compute block: the second
  buffer needs a fourth binding, so the conversion cannot share the add-on's group, and the compute
  block's 256-byte stride and 8 slots do not fit a scene's 64 draws.
- The render graph gained `after_all_compute`, which records once when the plan leaves its compute
  steps for the first render step. The frame converts the rows there, then copies each count word
  into the indirect draws. The count copy moved from after each compute step to that one point,
  which keeps both buffers final before the first reader and records each copy once per frame.
- The camera is the main view's absolute world position, `CellPosition::absolute()` in 64-bit
  floats, rounded once to 32 bits.

### Cost

- A frame that holds no feature-instance draw records no conversion: no buffer, no pipeline, no
  bind group and no dispatch.
- A frame that holds one pays one compute pass, one dispatch for each draw, one write of 16 bytes
  when the camera moved, and a bind group for each draw when the draw is new or its capacity
  changed.
- Each draw keeps a second instance buffer of `capacity * 64` bytes. At the docs' 100,000-instance
  example that is 6.4 MB, beside the world buffer's 6.4 MB. The option costs memory, not transfer.
- The camera position upload happens only while the camera moves. A still camera pays the
  dispatches alone.

### Limits

- The conversion uses the main view's camera. A shadow cascade or a tile reads the same
  camera-relative rows with its own light's view projection, so a feature-instance draw that casts
  shadows draws them from the main camera's rows. D-229's first version already draws such a draw
  in the main view alone; a later version can convert for each view if the shadows are needed.
- The add-on's compute pass must run before the first render step, as a pass of `band: 'before'`
  does. A pass after the scene writes rows too late for the opaque pass to read them.

### Tests

- A render test asserts that the conversion dispatch follows the add-on's compute pass and precedes
  the first render pass, and that a frame without a feature draw makes no conversion pipeline, group
  or dispatch.
- A render test asserts the draw reads the second buffer and that the group binds the camera's
  block, the count word, the world rows and the rows it writes.
- The image tests draw the two instance sketches on every tier and thread mode, and a test forces
  the direct-draw path to prove that the routing to the indirect path draws the same frame.

## Addendum, 25 October 2026: the shadow views take the GPU's count

The section above, and the Status's summary, said that shadow views draw the page's `setCount`
count until M3-F2 confirmed that the splats cast no shadows. D-241 changed that: the vegetation
add-on's GPU grass is a second user, near grass casts shadows, and its shadows must follow the
count that the GPU wrote. The first version's fallback is therefore gone.

The rule now: the frame copies each draw's count word into the bucket's reserved indirect entries
of the camera's own view **and of every shadow view that draws in the frame**, once every compute
step has ended and before the first render step, as it already did for the camera. A cascade and a
tile each own a copy of the casters' indirect buffer, so the copy reaches one of them per drawn
view. The casters' indirect template stays at the reset's zero: a shadow view that the copy does not
reach draws nothing rather than a stale page count. The page's count still fills the templates of
the views the copy does not reach: the camera's mirrors, probes and canvas views, and the outline,
skin and motion views.

Consequences:

- `feature_shadow_count` is removed: the CPU cannot read a GPU-written count, and no API reports it.
- A hidden draw copies nothing into any view, so it casts no shadow either.
- The render test `a_shadow_view_draws_the_count_that_the_gpu_writes` checks that each cascade's
  indirect buffer takes the count word after the last compute dispatch and before the first render
  pass. The limits unit test (`pipelines.test.ts`) now counts the two layouts this hook adds: the
  conversion's (`LAYOUT_FEATURE_ROWS`) and the add-on compute pass's
  (`LAYOUT_COMPUTE_INSTANCE_BUFFERS`).
- The per-frame cost is one 4-byte copy for each draw entry of each drawn shadow view, beside the
  camera's.

## Addendum, 26 October 2026: a feature's `ready` callback gates the draw

`docs/api/features.md` promises that a feature whose `ready` callback answers false costs nothing:
no pass, no target, and none of its code or shaders downloads. Nothing called that callback, so an
instance draw recorded its indirect draw and copied its count even while the add-on said that it
drew nothing. The engine now asks it.

The sketch's thread calls each instance draw's `ready` once each frame, before the frame's
commands, and tells the core when the answer changes. A draw whose feature is not ready keeps its
bucket, so the views keep their offsets, but records no draw in any view, copies no count word and
converts no rows. The layout is built again in the frame the answer changes, which re-records each
view's bundle. A description without a `ready` callback registers no poll at all, so the common
case costs nothing.

The render test `a_draw_records_nothing_while_its_feature_is_not_ready` reads both answers from the
recorded commands: the ready frame copies the count word and draws the reserved indirect entry, and
the unready frame does neither. The adapter's tests check that the page's `ready` reaches the core
once per change, and that the WebGL2 batch draws none of its rows while unready.

## Known gap, 26 October 2026: a casting instance draw's shadow falls in the wrong place

The count now reaches every shadow view, and a render test proves the cascade draws the reserved
entry. The geometry does not follow yet. The conversion subtracts the **main camera's** world
position, so the rows that a shadow view reads are relative to a camera that the view does not use.
The caster's vertex shader multiplies them by the light's own view-projection, so the instances land
off by the distance from the main camera to the light's camera, which for a cascade is tens of
meters: they fall outside the cascade and cast no shadow. The engine's own casters are unaffected,
because each view's culling writes its compacted rows relative to that view's camera.

A drawn test showed it. A compute-filled field of 42 discs lay above a ground with the sun casting,
and a standard box set beside the field cast a shadow while the discs cast none, on WebGPU and in
compatibility mode.

The fix is the per-view conversion that this record's "shadow-many path" deferred: each view that
draws a casting instance draw needs its own buffer of rows, converted with that view's camera, and
the draw's instance binding in that view must name it. The count copy and the readiness gate above
are unaffected by it.

Until it lands, a page should keep its instance draw out of the shadow views, or expect its shadow
in the wrong place. The M3-V8 grass, whose near blades must cast (D-241), waits on this fix.

## Addendum, 26 October 2026: what the allocation proof found, and a fault left open

The allocation proof earned its place on its first run. It found two allocations in the WebGL2 row
split: an array for every instance row, and `Math.hypot`'s arguments, which the browser keeps in an
array. A probe showed that the cost was per row, not per call: about 24 bytes each. Both are fixed.
The split writes the batch's arrays directly, and each column's length is a square root of the
squares. The check now passes on both GPU paths, at 6.4 s on WebGPU and 3.4 s on WebGL2.

One fault is recorded here and left open, by the coordinator's ruling of 26 October 2026. A device
that chose the direct-draw path fixes that choice on the first frame, while the scene holds no
feature-instance draw (`gpu_driven/mod.rs`, the `!self.created` test in `record_into`). A draw
created after that frame on such a device takes the direct path. Its bucket's CPU count is 0,
because the engine hides a feature draw from the culling shader, so the draw draws nothing and no
error says why. No page meets this today: every first user adds its draw in the sketch's setup. It
needs a task of its own, either to refuse such a draw or to move the session to the indirect path.
