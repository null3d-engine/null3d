# D-240: Compute passes with a storage output that the same frame reads

Status: decided by the helper of M3-E8 on 23 October 2026, for the owner's review. Built: the
pass, both GPU paths and the tests, as the consequences list. Date: 2026-10-23. Task: M3-E8.

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

The engine before this change:

- **Public passes.** `render.addPass` takes a scene, a reflection or a full-screen pass. Each
  publishes a texture that `textures.fromPass` gives to materials, effects and sprites.
- **The graph.** `null3d-render`'s render graph takes a pass's reads and writes, orders the passes,
  culls one that nothing running reads, and plans each target's usage and memory. A pass of
  `PassKind::Compute` that writes a resource gets `STORAGE_BINDING` on that target
  (`graph/compile.rs`, `kept_usage`), and the frame opens one compute step for it. The engine's own
  compute passes, the light clusters, the skinning pass, the culling passes, the depth pyramid and
  the exposure histogram, all write buffers.
- **Bindings.** A compute pipeline takes a bind group layout of the engine's. The exposure meter's
  layout is the only one with a storage texture, of `rgba32float`.
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
does, and refuses scene resource reads, because the adapter binds no scene resource yet. Both
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
displacement map's array and sampler. The maps layout's entries now name the compute stage too.

The block is the engine's effect block, which a full-screen pass already gives its WGSL. The
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
- **An adapter of its own, `scene.addFeatureCompute`.** The pass already has a handle that
  `textures.fromPass`, `render.setPassEnabled` and `render.removePass` take. A second handle type
  would repeat all four calls and the graph naming.
- **One description per path.** The description names one kind. The fallback is an option of the
  pass, not a second feature, because both forms publish one output for one user.
- **Running compute inside a render pass.** WGSL forbids it, and the engine's step planner already
  opens a compute step of its own.
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

## Addendum: every pass that draws a reader waits for the pass (M3-V3, 24 October 2026)

M3-V3 needed a custom material's vertex offset to read a compute pass's output in every build that
draws the material, the shadow caster, motion and pick builds among them. The graph ordered the
pass before the camera's passes, because their opaque and prepass passes read the target of every
view that a texture shows. The shadow, motion and pick passes read no view target at all, so the
pass could run after them: a shadow then drew the frame before's data, and a pick or motion pass
that ran first drew the target's initial zeros.

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
