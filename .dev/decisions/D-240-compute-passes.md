# D-240: Compute passes with a storage output that the same frame reads

Status: decided by the helper of M3-E8, for the owner's review. Built: the pass, both GPU paths
and the tests, as the consequences list, and the wait of every pass that draws a reader (M3-V3).
Pending: the compute path's GPU time on the Mac, the iPad and the S24. Tasks: M3-E8, M3-V3.

Summary: A compute pass is a render pass of the graph whose target is a storage texture that
materials, effects and other passes sample in the same frame. The add-on gives a compiled compute
shader, its workgroup size, its dispatch, up to 32 numbers of values and up to 6 textures, and a
feature description names its frame point and publishes its output. WebGL2 has no compute shaders,
so it runs a fragment form that the add-on gives, or refuses the pass with E1220.

## Question

D-173's hook H1 asks for a compute pass whose storage output materials, effects and passes read in
the same frame. What does an add-on write, what binds that output, how does the render graph order
the pass before its readers, and what happens on WebGL2?

## Rule

- The pass is one of the render graph's passes, so `textures.fromPass` gives its target to
  materials, effects and passes, as it gives a scene or full-screen pass's target.
- The render graph orders passes by the resources they read and write. A pass that writes a target
  that another pass samples runs before it. The same frame therefore reads the output, with no
  copy and no wait.
- The output is a texture, because a material samples a texture. H2's count word, which the
  engine reads to draw, is a different surface, and it comes with M3-E9.
- Both GPU paths work, or the docs state the fallback (D-173). WebGL2 runs the add-on's fragment
  form where the work fits a fragment shader, and the call throws otherwise.

## Data

The engine parts that the pass builds on:

- **Public passes.** Besides a compute pass, `render.addPass` takes a scene, a reflection or a
  full-screen pass. Each publishes a texture that `textures.fromPass` gives to materials, effects and sprites.
- **The graph.** `null3d-render`'s render graph takes a pass's reads and writes, orders the passes,
  culls one that nothing running reads, and plans each target's usage and memory. A pass of
  `PassKind::Compute` that writes a resource gets `STORAGE_BINDING` on that target
  (`graph/compile.rs`, `kept_usage`), and the frame opens one compute step for it. The engine's own
  compute passes, the light clusters, the skinning pass, the culling passes, the depth pyramid and
  the exposure histogram, all write buffers.
- **Bindings.** A compute pipeline takes a bind group layout of the engine's. Among the engine's
  own compute passes, the exposure meter's layout is the only one with a storage texture, of
  `rgba32float`.
- **The drawing thread.** A sketch's compiled WGSL reaches it as a `CustomShader` under a render
  pipeline template. The WebGPU backend builds compute pipelines from templates the engine knows,
  and parks one whose shader has not arrived.
- **WebGL2.** The draw list has compute operations, but only WebGPU records them. WebGL2 runs the
  exposure's downsample step in place of its histogram.

## Decision

### The public shape

`render.addPass` takes a fourth kind, `'compute'`:

```ts
const field = render.addPass({
  kind: 'compute',
  description: defineFeature({
    name: 'waves',
    frame: 'background',
    kind: 'compute',
    outputs: { waves: { default: 'black' } },
  }),
  wgsl: spectrum,            // a compiled whole shader with a @compute entry point
  format: 'rgba16float',     // or 'r32float' or 'rgba8unorm'
  workgroupSize: [8, 8, 1],  // the default is the shader's @workgroup_size
  dispatch: 'writes',        // or workgroup counts along each axis
  values: [time, 0, 0, 0],   // up to 32 numbers
  textures: [heightMap],     // up to 6, other passes' textures included
  fallback: { wgsl: spectrumFragments }, // the fragment form, for WebGL2
});
const map = textures.fromPass(field); // materials, effects and passes sample it
```

The description's one output names the pass's target. Its frame point says when the pass belongs
in the frame, and its output's default says what a reader shows before the pass first runs. WebGPU
starts a texture at zero, so `'black'` and `'transparent'` hold; `'white'` is refused, because it
would need the texture filled first. The adapter places the main view alone, as the draw adapter
does, and refuses scene resource reads, because the adapter binds no scene resource. Both
refusals are E1223.

### The bindings

The add-on's WGSL declares its own group 0:

```wgsl
struct ComputeBlock {
    size: vec4f,        // xy: the render size, zw: the canvas size
    clock: vec4f,       // the sketch time, the seconds since the frame before, then two spares
    inverseProjection: mat4x4f,
    u0: vec4f,          // the eight vectors of the pass's values, in order
    // ...
    u7: vec4f,
    drawn: vec4f,       // the target's width and height in texels, its texture height, then 1
    bloom: vec4f,       // zeros
}
@group(0) @binding(0) var<uniform> block: ComputeBlock;
@group(0) @binding(1) var output: texture_storage_2d_array<rgba16float, write>;
```

The storage texture is read as an array of one layer, as every pass target is sampled, so the
shader writes layer 0. Group 1 binds the `textures` array in the order it gives them, with the
materials' maps layout: a texture array at bindings 0 to 7, its samplers at 8 to 15, then the
displacement map's array and sampler. The maps layout's entries name the compute stage too.

The block is the engine's effect block, which a full-screen pass also gives its WGSL. The
compute pass shares it rather than adding a second layout.

### The order

The graph orders the pass from its reads and writes. A pass whose target a material shows runs
before the camera's pass, because that pass reads the target. A pass whose target an effect or
another pass names in its textures runs before that pass. A pass whose target nothing reads is
culled and costs nothing.

The description's frame point adds one ordering edge: a pass at `'resolve'` or `'post'` reads the
scene color, so the graph runs it after the camera's passes. A pass at `'background'`, `'opaque'`
or `'transparent'` needs no edge, because its readers order it.

The band and order do not reorder two compute passes that share no resource. The description
checks them, and the graph keeps its order from reads and writes, which is the graph's own rule.
A pair of passes whose order matters names a texture between them.

`values` arrive packed, one workgroup axis to a byte, for the core's call. Its arguments are whole
numbers, as `core-arguments.test.ts` requires, and `addComputePass` makes content, so its `scale`
may be a fraction.

A pass texture reports the scene color's format, as every pass texture does, even when the compute
target writes another format. The GPU binding uses the target's own format, so the picture is
right; only the `format` that the texture reports differs from the target.

### WebGL2

A WebGL2 page runs the `fallback` WGSL as a full-screen pass with the same values, textures, size,
scale and pace. Where the work cannot be done for each pixel, as with atomics, shared memory or a
scatter, the add-on gives no fallback, and the call throws E1220 on WebGL2. The docs say both.

The values keep their positions on both paths: a fragment shader's `Uniforms` fields start at the
same floats that the compute block's eight vectors hold.

## Options rejected

- **A storage buffer output.** Materials sample textures, not buffers. H2's count word goes into
  the engine's indirect buffer, which is H2's own surface (M3-E9), and a general public buffer
  would be a second promise before its user exists.
- **An adapter of its own, `scene.addFeatureCompute`.** The pass has a handle that
  `textures.fromPass`, `render.setPassEnabled` and `render.removePass` take. A second handle type
  would repeat all four calls and the graph naming.
- **One description per path.** The description names one kind. The fallback is an option of the
  pass, not a second feature, because both forms publish one output for one user.
- **Running compute inside a render pass.** WGSL forbids it, and the engine's step planner opens a
  compute step of its own.
- **A uniform block of the add-on's own layout.** The shader compiler reflects a custom material's
  uniforms, but not a whole shader's. The effect block needs no reflection, and 32 numbers cover
  what the first users need.
- **A white output default.** A texture starts at zero. Filling it white costs a pass before the
  first frame, for a default that no first user asked for.

## Consequences

- **Rust:**
  - `view.rs`: `Compute`, a view whose target is a storage texture, and its workgroup counts.
  - `compute.rs`: the pass's buffer, bind group and pipeline, and its dispatch.
  - `frame_graph.rs`: the pass declaration, its role, its upload, and the compute-view mask that
    keeps the scene passes off a compute view.
  - `frame.rs`: the compute view's values and map layers, and no background behind it.
  - `drawlist.rs`: the three compute layouts, by target format.
  - Both frame builders' id tables, and the WebAssembly calls `addComputePass` and
    `setComputeValues`.
- **The engine package:** `render.addPass` takes `'compute'`, and `render.setPassUniforms` changes
  its values. A compiled whole shader goes to the drawing thread as a compute template, which the
  WebGPU backend builds when the shader arrives. The three compute layouts are made at first use.
- **Tests:**
  - `render.test.ts` covers the call's arguments, the dispatch, the refusals and the WebGL2 form.
  - A render graph test covers a compute pass's step, its target, and its order before a reader.
  - The `compute-pass` image test draws four colored quadrants that the pass writes and a material
    samples, on WebGPU, and the same picture from the fragment form on WebGL2.
- **Docs:** [Render passes](../../docs/api/render.md#compute-passes) gains the call, the binding
  contract and both paths. The feature page's adapter table names it. E1223's cause names it.
- **Skills:** the develop skill's render reference names the call.
- **Size:** the pass costs nothing on a page that does not add one. The three bind group layouts
  wait for first use. The start's growth is the option checks and the call, and the size check
  reports it.

## Every pass that draws a reader waits for the pass

A custom material's vertex offset reads a compute pass's output in every build that draws the
material, the shadow caster, motion and pick builds among them (M3-V3). The camera's opaque and
prepass passes read the target of every view that a texture shows, so the graph orders the pass
before them. The shadow, motion and pick passes read no view target at all. Without an edge, the
pass could run after them. A shadow would then draw the frame before's data, and a pick or motion
pass that ran first would draw the target's initial zeros.

**The rule.** Each of those three passes reads, and so runs after, every early pass's target that
the materials it draws sample:

- `DrawnViews` holds a mask of view places for each of the shadow, motion and pick passes. The
  builders fill it from their layouts: the maps group of every bucket's draw, through
  `TextureStore::group_pass_views`. A layout rebuilds only when the scene changes, so the frame
  reads masks that the layout already worked out.
- `FrameGraph::declare` keeps a mask of the views that fill their texture before the scene draws:
  compute passes, and the fragment forms that run in their place on WebGL2. A pass at `'resolve'`
  or `'post'` reads the scene color, and a pass whose textures show a camera's target reads that
  target, so neither is left in: a scene pass cannot run after it without a cycle.
- Each shadow cascade and tile, the motion pass and the pick pass reads the intersection of its
  layout's mask and that mask.

**Why this is right.** The edge follows the data, not the kind of pass: a material that samples a
pass's texture is drawn with it in every pass, so every such pass waits. The masks are exact for
the layouts the engine draws, so a material that samples no pass texture adds no edge, and the
shadows of a scene without compute passes keep their order.

**Tests.** A render graph test holds a compute pass and a shadow cascade whose caster samples it,
and checks the cascade's step comes after the pass. The `compute-vertex-offset` image test draws a
box that a vertex offset moves by the pass's output, in the main view and its shadow, on both
paths, and the motion spec reads the plane's motion back from the debug view.

## The compute path's cost and memory

M3-V3 asks for the GPU time and the memory of the compute path on the Mac, an iPad and a
phone-class device.

**How it is measured.** The effect cost page, `tests/pages/effect-cost.ts`, has a `compute` case.
Its sketch, `tests/pages/sketches/compute-cost-sketch.ts`, draws a field of quads whose vertex
offset reads a 512 by 512 texture that a compute pass writes in the same frame, so the pass and the
vertex reads belong to the feature. The page times the scene with the pass off and on in turns: off
shows the same quads with the standard material and runs no pass, and on shows the material whose
offset reads the pass. Both sides fix the render scale with the governor off. After the timing, the
page shows the engine's stats overlay and reads the memory of each side from it: the GPU textures,
the GPU buffers, the engine's tables and the wasm file. The spec `tests/image/compute-cost.spec.ts`
runs the page on each GPU path and scale when `NULL3D_COMPUTE_COST` is set, and the device plan
`compute` runs it on a device.

**The figures.** The memory figures are structural: the overlay reads the GPU textures' and buffers'
bytes, the engine's tables and the wasm, and the machine's load changes none of them. They come
from the Mac's run of the page at render scale 1, at the preset that the engine chose for each path,
with a 1920 by 1080 canvas. The on side holds the pass and the quads that read it; the off side
holds the same quads with the standard material. The pass's target stays allocated on both sides, so
the useful figure is the on side's total.

| GPU path | Textures | Buffers | wasm | Total |
| --- | --- | --- | --- | --- |
| WebGPU | 75.4 MiB | 2.2 MiB | 6.8 MiB | 92.4 MiB |
| compatibility mode | 67.5 MiB | 2.2 MiB | 6.6 MiB | 85.5 MiB |
| WebGL2 | 115.4 MiB | 0.6 MiB | 7.6 MiB | 133.4 MiB |

The GPU time is not measured yet. The cost harness measures only while the machine's 1-minute load
is under 8. The Mac's load stood between 100 and 200 in every attempt, so none recorded a figure.
Take it in a quiet window with
`NULL3D_COMPUTE_COST=1 bun run test:browser -- compute-cost.spec.ts`, which prints each path's GPU
time with the pass off and on, and the load beside it.

The iPad and the S24 run the same page through the `compute` device plan:
`bun run devices:cloud --only bsipadpro13-safari --plan compute`, and the same with
`--only bsgalaxys24-chrome`. Each runs six pages: the three GPU paths at scales 1 and 0.5.



## Compute passes that keep their state

The fluid wind of M3-V15 needs a pass that reads its own output from the run before: advection and
each Jacobi step of the pressure solve read the state that the step before wrote. D-240 refused a
pass that reads its own texture, because the render graph would make a cycle. This addendum keeps
that refusal for every other loop and adds one option that closes the loop legally.

**The two states.** `history: true` gives a pass two states. Two textures of `layers` array layers
hold them, so a run writes one and samples the other through whole-texture views. Compatibility
mode binds a whole array texture and nothing less, so the states cannot share one texture there. A
run writes the state that the run before read, and the frame swaps the two textures between runs.
Once the frame's runs have finished, the frame copies both states into the pass's target: the first
state into the first `layers` layers, and the second into the layers after them. Readers sample the
state that the last run wrote. A reader that wants both declares the target as
`texture_2d_array<f32>`. A one-layer shader writes layer 0 as before, so the option changes nothing
for a pass that does not use it.

**The runs.** `steps` is the number of dispatches that a frame records: 40 runs of a pressure solve
are one pass, not 40. `render.setPassSteps` changes it in a frame without an allocation. A pass
that keeps no history runs once, and a call past one throws E1220. The state that the last run
wrote is the one a reader samples; each run writes the state that the one before read, so an odd
count leaves the state that the frame started from.

**The layers.** `layers` is the array layers of each state, from 1 to 256, and 128 at most with
history. A `'writes'` dispatch runs one workgroup along z for each layer, and the shader writes
layer `id.z`. The pass texture has the states' layers, and its first layer in each state is the one
a material or an effect samples.

**The graph.** The pass's target is a kept target, as D-240 made it. The pass reads its own
previous state through its own bind group, not through `Pass::reads`, so the graph adds no edge and
finds no cycle. A page that names the pass's own texture in `textures` still throws E1504, and so
does every other loop.

**The order.** The states need no barrier of their own: each frame's commands are submitted in
order, and a history pass's copies into the target are recorded between compute passes, before any
pass that samples it. A reader in the same step therefore sees the state this frame wrote, and the
frame before's writes finish before this frame's reads. The page's forty-runs-in-one-frame case
reading the same as forty frames is the proof; a read that saw stale state would not count to forty.
Keep that case: a change that adds a graph edge must keep it passing.

**Readers.** A material or an effect that declares the pass's texture as `texture_2d<f32>` samples
the state that the last run wrote: the engine writes that state's first layer into the map's layer
each frame. A reader that declares `texture_2d_array<f32>` sees both states and names the layers
itself. `texture.layer` gives the first layer of the state that the last run wrote. A reader of the
array then names the newest state without counting its own runs.

**A stopped pass.** A pass that does not run keeps the state that its last run wrote, because the
graph keeps the target and does not clear it. A device loss or a target shape change makes the
plan's textures again. The state then starts empty at the first one.

**Reset.** `render.resetPass(pass)` asks the next frame to clear every layer of the target. The pass
then starts again from the first, empty state. A lost device starts every texture empty, so the
pass starts again from its seed as well.

**A region read.** `render.readPass(pass, { x, y, width, height, layer })` resolves with four numbers
for each texel of at most 64 by 64, row by row from the top left. It also gives the frames that the
read took. A frame copies the region into one buffer of a four-buffer ring after the pass's runs. It
then reads the buffer into engine memory. The GPU's read raises a control slot, and the sketch's
frame loop answers the promise. No thread waits, so hard rule 4 holds. The layer defaults to the
state that the pass wrote last, which a history pass needs because the state alternates. A stopped
pass reads its kept image. The page checks answer a 2 by 2 region three frames after the call on
WebGPU and compatibility mode, and four to five on WebGL2. A region that reaches past the pass's
texture is refused with E1220 before a frame records it, because a copy past the end would reject
the frame's commands. A canvas that shrinks between the call and that frame skips the copy and the
call times out, so no copy past the edge reaches the GPU. The caller waits for the timeout and sees
the same E1220 as a read that never lands; this shape is the trade for never copying past an edge.

**WebGL2.** No compute shader runs there, so the fragment form keeps the same two states. Each run
copies the state before from the target into a scratch texture. It then draws the pass into a layer
view of the other state. Both states stay in the target's layers, so a reader sees the same two
layers on both paths. The fragment form reads the state before as `input.color`.

WebGL2 binds a texture array whole. It cannot sample one of its layers in a fragment shader, so the
fragment form draws one layer at a time. A run of a pass of several layers copies the state
before's layer into the scratch, then draws that layer. `input.layer` names the layer that the draw
writes. Each layer has a block of its own in a buffer of the fragment forms, because the block
carries the layer. Up to 32 layers work on WebGL2, and the call throws E1220 past them. The WebGPU
paths draw 128 with history and 256 without. This is a limit of the path, not a dropped feature.

**Cost and memory.** The target holds both states as `layers * 2` layers, and the two state
textures hold them once more, so a history pass takes four times the texels of one state on the
WebGPU paths. On WebGL2 the target holds both states and the fallback adds one scratch, so it takes
three times. A frame
that runs the pass copies both states into the target, `layers * 2` layer copies, and records one
dispatch for each step. A WebGL2 history pass adds a scratch texture of one state and one copy for
each run.

**The figures.** The cost page runs a 256 by 256 history pass of 40 steps in one frame with an 8 by
8 workgroup, and measures the same scene with the pass switched off, on every GPU path. A workgroup
of one invocation and a measurement with no pass-off baseline are rejected: the first dispatches
65,536 workgroups for a 256 by 256 pass, and the second cannot separate the pass's cost from the
frame's. The frame's pass list names the engine's own compute pass, one for each compute step, not
this pass; the graph runs a pass only while it is enabled and not culled, so the switched-off side
dispatches nothing for it, and each figure is the whole frame's difference.

The figures are in. On the Mac, in a quiet window at a load of 2.1 to 2.7, the pass costs 0.066 ms
on WebGPU, one step of Chrome's 0.065536 ms timestamp and below its resolution, 0.197 ms in
compatibility mode, and 10.74 ms in the WebGL2 fragment form, where each of the 40 steps is a state
copy and a full-screen pass. The cloud iPad reads 0.49 ms on WebGPU and 0.46 in compatibility mode,
and the cloud Galaxy S25 4.0 ms on both. WebGL2 has no timer on either device: its fallback shows on
the busiest thread, 0.74 to 4.27 ms on the iPad and 0.48 to 0.79 on the phone. The pass holds 2 MiB
of texels on the compute paths and 1.5 MiB on WebGL2. The runs are
[the Mac's](../tested-devices/macbook-pro-m3-max-chrome/20261027-013423-history-cost.md),
[the iPad's](../tested-devices/ipad-pro-13-safari/20261027-010154-history-cost.md) and
[the S25's](../tested-devices/galaxy-s25-sm-s931b-chrome/20261027-010335-history-cost.md).
