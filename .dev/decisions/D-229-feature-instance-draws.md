# D-229: Draws whose instance count the GPU writes

Status: decided by the helper of M3-E9, for the owner's review; the owner chose to convert the rows
on the GPU. Built: the opaque main-view path on WebGPU and the CPU-filled batch on WebGL2. On WebGPU
the add-on's compute pass binds the count and the rows. After the last compute step, the engine
converts the rows and copies the count into the indirect draw. Not built: the transparent and
shadow-many paths, and GPU counts in the shadow views, which draw the page's count. Task: M3-E9.

Summary: An add-on's instance draw reserves one indirect entry in each view's draw buffer, and its
compute pass writes a count and world-space rows. After the last compute step, the engine converts
the rows to camera-relative space and copies the count into the entry. On WebGL2 the page fills an
unculled instance batch; the draw runs in the main view alone, and shadow views draw the page's
count.

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

What the engine provides:

- **The indirect draws.** Each view owns a buffer of indexed indirect draws, one entry (five words)
  per layout draw and per occlusion phase, with `INDIRECT | STORAGE | COPY_DST` usage. The culling
  shader adds visible sources with `atomicAdd` on each entry's instance-count word.
- **The count surface.** Without this hook, no compute pass binds a buffer for an add-on, and no
  draw takes its count from memory that the page does not write through the CPU.
- **The compute surface (M3-E8).** One storage texture at a fixed binding. D-173's addendum keeps
  it one texture and defers a storage buffer to its first user, which is this hook.
- **WebGL2.** No compute shaders and no storage buffers. The engine's instance batches carry a
  capacity, an active count and per-row matrices, and their rows are culled by the CPU.
- **A batch's rows.** The engine culls a batch row by its sphere, unless the batch is unculled, as
  a screen-sized sprite batch is.

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

- The draw's object is unculled and gets a bucket of its own. The object takes bounds of its own
  whatever its flags say, so its bucket names the draw and its buffers. With the bounds that the
  unculled flag gives, which several objects share, the bucket holds no object. It then names no
  feature draw, binds the view's compacted instances, receives no count and draws nothing on
  WebGPU core and in compatibility mode. The unit test sets the flag that the adapter sets, and
  also covers an object with no bounds flags at all.
- The layout marks its bucket table entry `HIDDEN`, so the culling shader never visits it and never
  counts it. The bucket's draw is recorded as `DrawIndexedIndirect` from the view's existing buffer,
  so the sizing, the bundles and Apple's argument copy stay as they are.
- The frame writes the page's count into the count buffer before its compute steps, so a scene
  without the add-on's compute still draws, and the add-on's compute replaces the word in the same
  frame.
- The render graph's `after_all_compute` step records once, when the plan leaves its compute steps
  for the first render step. A copy between buffers needs a place outside every pass. There the
  frame converts the rows ([The rows are converted on the GPU](#the-rows-are-converted-on-the-gpu)).
  Then it copies the count word into the instance count of each of the bucket's indirect draws.
  One point keeps both buffers final before the first reader and records each copy once per frame.
- A hidden object's entry keeps the reset's zero and its count is not copied, because culling does
  not remove it the way it removes a hidden object in any other bucket.
- The engine's camera-relative copy of the draw's rows binds at vertex slot 1 in place of the
  view's compacted instances.
- A scene that holds a feature-instance draw takes the indirect path for the whole session. The
  direct-draw path, which the start-up probe picks on Apple's GPUs
  ([D-174](D-174-apple-gpu-direct-draws.md)), counts every draw on the CPU. It makes no indirect
  buffer, so the count copy would have nowhere to write. The first frame picks the path before it
  creates any path state. An add-on that creates such a draw after the first frame is not supported
  on that path. The frame then names a buffer that does not exist, and it stops. The sketch's setup
  creates its draw before the first frame, so the shipped sketches take the indirect path.

### WebGL2

- The draw is an instance batch of the capacity, marked unculled: the page's count decides what
  draws, not the frustum.
- `setInstances` splits each 16-float row into the batch's position, rotation and scale. A sheared
  matrix does not split, which the docs state.
- `setCount` sets the batch's active count, and the CPU path draws exactly that many rows.

### Shadow views

The add-on's compute writes the main view's count alone. A shadow view draws the page's
`setCount` count, which the frame puts into the casters' indirect template before the reset uploads
it.

### Rejected

- **A second buffer surface for compute.** The count is a buffer that a compute pass writes, so
  this hook is the storage buffer that D-173's addendum deferred. The engine makes the buffer and
  the pass binds it; the add-on declares no layout of its own.
- **A separate count buffer copied into the indirect draw by a pass of its own.** The copy sits
  outside every pass; a pass would add a pipeline and a dispatch to every frame.
- **Writing the add-on's word straight into the indirect entry.** A storage binding's offset must
  meet the device's alignment, which the indirect entry's count word does not, and the entry is the
  engine's to reset.
- **Culling the draw on the GPU with the engine's cull.** The add-on's compute is the cull; a
  second one would count what the add-on already rejected.
- **Converting the rows as they reach the buffer.** The engine would add the camera offset to a
  page's rows when it uploads them, and give the add-on's compute pass the camera offset in its
  block. That repeats an upload of the drawn rows in every frame where the camera moves.

## Consequences

- The public API is experimental. Its planned first user, the splats add-on (M3-F2), cannot take
  it: splats draw through the engine's transparent instance batch, whose rows the job workers sort
  back to front, and a GPU-written count would skip that sort; their count also changes only when
  the camera or the budget crosses a threshold, not every frame. The first-user outcome stays unmet
  until an add-on whose count a compute shader writes each frame takes the hook.
- The proof is a picture: `tests/pages/sketches/feature-instances-compute-sketch.ts` fills no
  instance row on the CPU, its compute shader writes 42 rows and the count word, and the draw shows
  exactly 42 quads. The count in that picture is what the shader wrote.
- The docs hold `docs/api/feature-instances.md`, and `docs/api/features.md` and
  `docs/api/feature-draws.md` name it.
- `InstanceBatch.setFrustumCulled` works on both paths, so a page can keep a batch that its own
  cull decides.
- The compute pass's `buffers` option takes the draw's two handles in binding order, as the fixed
  storage-buffer bindings of its group; the storage buffer's layout is E8's surface to extend, not
  a second surface.

## The rows are converted on the GPU

The owner chose to convert the rows on the GPU. The conversion is one compute dispatch for each draw
in each frame, so a camera that moves costs no upload of the page's rows.

### Why the rows need a conversion

The vertex shaders read an instance matrix in **camera-relative** space. This is the engine's
instance format. The frame that culls a scene adds the camera-to-cell offset to each object's world
matrix, so `relative_position` needs no further subtraction. A page writes the rows that
`setInstances` takes as **world** matrices, as the API page says. Unconverted, a page row at the
world origin reads as a position on the camera's own plane. Its clip `w` is zero, and the triangle
draws nothing. Rows that carry `-camera` in their translation draw the expected picture on WebGPU:
4002 bright pixels against none.

The WebGL2 path needs no conversion. Its adapter splits each row into an instance batch, whose
positions the engine treats as world. So a page's world rows draw there as they are.

Letting the add-on write camera-relative rows is not enough on its own. The add-on's compute pass
block carries no camera, and a page's camera moves after it has written its rows.

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
  frame before had converted, unless the page re-uploaded its rows or the add-on's compute rewrote
  every live row every frame. The second buffer makes the conversion a function of the world rows
  alone, so both update paths serve it.
- The bind group of a draw is `layout::FEATURE_ROWS` (59): the camera's block, the count word, the
  world rows and the rows it writes. The pipeline is `template::FEATURE_ROWS` (83). The camera's
  block is the conversion's own 16-byte uniform buffer, not the add-on compute block: the second
  buffer needs a fourth binding, so the conversion cannot share the add-on's group, and the compute
  block's 256-byte stride and 8 slots do not fit a scene's 64 draws.
- The conversion runs at the render graph's `after_all_compute` step, before the count copy.
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
  shadows draws them from the main camera's rows. The draw runs in the main view alone; a
  conversion for each view would serve shadows if they are needed.
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
