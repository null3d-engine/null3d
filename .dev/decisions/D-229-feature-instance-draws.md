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
const draw = await scene.addFeatureInstances(description, { shader, vertices, capacity, count });
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
