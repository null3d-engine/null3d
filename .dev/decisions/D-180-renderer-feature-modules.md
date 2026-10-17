# D-180: One module per renderer feature

Status: decided. Proposed on 15 October 2026, and approved by the owner the same day ("approved"). Nothing is built yet. Step 1, the safety-net tests, may start at once. The other steps start after the open feature branches EX22, EX25, EX32, EX36, F11 and J4 have landed. Task: code review findings M-9, R-16, R-17 and GPU-8 of 15 October 2026.

Summary: A renderer feature today touches 10 to 15 Rust files, 20 to 30 places in `frame_graph.rs`, two hand-chained id tables and two hand-written template lists. In 117 merges with hand resolutions, 200 of the 305 conflict hunks in renderer files (66%) fell in those places. The proposal gives each frame-graph step one module behind one internal trait. GPU ids come from one table with an overlap test, and both GPU backends read one template descriptor with a parity test. Twelve small landings, each with unchanged draw lists and image references, take about 14 helper-days.

## Question

How should the renderer hold its features, so that a new feature lives in one place, the way D-173's ruling of one place per feature asks? How do we get there without breaking the image references or blocking the open feature branches?

## Rule

The design and each step of the migration must meet all of these:

1. One place per feature ([D-173](D-173-addon-hooks.md)). A new frame-graph step adds one module, one line in the step list and one row per template. It adds no field, branch or match arm to `frame_graph.rs` or to either builder.
2. No change in what the GPU draws. Each landing keeps every draw list the same, after the GPU object ids are renamed in order of first use. Every image reference stays unchanged on both reference sets.
3. No per-frame allocation (hard rule 1) and no dynamic dispatch in the frame loop. The step list is fixed when the code compiles.
4. Both GPU paths stay first-class (design principle 9). A template on one path only names its fallback.
5. Each step lands alone by direct push ([D-157](D-157-direct-pushes-to-main.md)), passes the local checks, and stays within the size check's 2% rule.

## Data

The figures come from `origin/main` at `dcd0b8e2b`, 15 October 2026.

### What a feature touches today

Two recent features serve as worked examples: the lit volumetric fog (`bf57a945b`, [D-133](D-133-volumetric-fog.md)) and weighted blending (`21ac1bf03`, [D-150](D-150-weighted-blended-transparency.md)).

| Place | Lit fog | Weighted blending |
| --- | --- | --- |
| Rust files changed | 10 in `null3d-render`, `null3d-gpu` and `null3d-wasm` | 15 |
| The feature's own module | `fog_volume.rs`, 772 lines | `weighted.rs`, 281 lines |
| `frame_graph.rs` | +219 lines in 23 places | +334 lines in 22 places |
| Each builder's id table (`mod ids`) | 3 new ids, and the next 3 ids chained again by hand | 1 new group range, and the next id chained again |
| Each builder's `GraphIds` wiring | 1 block | 1 block |
| Each builder's per-frame setters | 1 call | 2 calls |
| Each builder's role arm in `record_into` | 1 arm, to bind the camera's frame group | 1 arm, to draw the sorted rows |
| `drawlist.rs` | 4 template numbers, picked by hand, and 4 lines in the TypeScript constant list | 2 template numbers, 2 layout numbers, a format and a permutation bit, with their constant-list lines |
| `generated/gpu.ts` (kept in git) | 4 lines | 10 changed lines |
| WebGPU template list (`webgpu/pipelines.ts`) | 4 rows | 2 rows and a blend state |
| WebGL2 template list (`webgl2/programs.ts`) | 3 rows | 2 rows |
| Feature tables in TypeScript | `HDR_FEATURES` in `device-shaders.ts` | none |
| Shader manifest | 3 shaders and a first-use entry | 2 shaders and a first-use entry |

The 23 places of the fog in `frame_graph.rs` repeat one shape. Every step of the graph has the same pieces:

- an import and a field in `GraphIds`;
- names for its passes and textures, and one `Role` variant per pass;
- six fields in `FrameGraph`: the pass object, its ids, its frame, and the `built`, `declared` and texture-cache fields;
- their start values in `new`, and a reset in `set_canvas`;
- a term in `upload_bound`;
- a setter, a `*_draws()` test, and getters of the pass object;
- a call in `declare` and a `declare_*` function;
- a branch in `request_pipelines`;
- a call in `upload` and an `upload_*` function with its own texture cache;
- one arm per pass in `record`, and one in `draws`;
- a line in `reset_gpu`;
- an entry in the test fixture's ids.

The fog also changed two lines of the effects' code, because the effects now read the fog's output. So the order of the post chain is spread over `scene_output`, `effects_output` and `color_output`.

The pass modules already have one shape: `new(ids, ...)`, `request_pipelines`, `pipeline_ids`, `prepare`, `record(list, step)`, `reset_gpu`, `UPLOAD_BYTES` and `GROUPS`. Only the code around them repeats.

### The hub files

| File | Size | What each feature adds |
| --- | --- | --- |
| `frame_graph.rs` | 6,035 lines; `FrameGraph` has 116 fields | 20 to 30 places, as above |
| `cpu_culled/mod.rs` | 2,259 lines; `mod ids` is 213 lines with 87 constants | ids, wiring, setters, role arms |
| `gpu_driven/mod.rs` | 2,211 lines; `mod ids` is 302 lines with 130 constants | the same again |
| `webgpu/pipelines.ts` | 1,426 lines; the template list is about 580 lines | one row per template |
| `webgl2/programs.ts` | 548 lines; the template list is about 70 lines | one row per template |

The two builders share 335 distinct lines of more than 25 characters. They call the graph's per-frame setters in two orders: bloom, depth of field, fog, exposure, effects in one; bloom, effects, depth of field, exposure, fog in the other.

### Merge conflicts

`git merge-tree` ran each of the 117 merges with hand resolutions again. These are the merges that reached main between 7 and 15 October 2026, which the code review of 15 October listed. 111 of them conflicted, with 617 file conflicts in all. 41 merges conflicted in the renderer's registration files, with 305 conflict hunks. Each hunk was sorted by the item that holds it.

| Where the hunk was | Hunks | Removed by this plan |
| --- | --- | --- |
| The two builders' `mod ids` | 77 | yes, step 3 |
| `frame_graph.rs` | 40 | yes, steps 5 to 9 |
| `drawlist.rs`: the template and layout numbers and the TypeScript constant list | 24 | yes, step 4 |
| The builders' role arms (`record_into`) | 24 | yes, steps 5 to 9 |
| The builders' `GraphIds` wiring, `new`, `upload_bound`, `reset_gpu` | 15 | yes, steps 3 and 5 |
| `generated/gpu.ts`: template and layout numbers | 16 | they become regenerate-only, step 4 |
| The backends' template lists | 4 | yes, step 4 |
| Other builder lines (fields, module lines) | 15 | no |
| `drawlist.rs`: permutation bits and sizes | 14 | no ([D-156](D-156-template-scoped-permutation-bits.md) owns the bits) |
| Shader manifest, `frame.rs` settings, `materials.rs` feature bits, the WebAssembly setters, `generated/core.ts`, backend details | 76 | `frame.rs` partly, step 10 |

So 200 of the 305 hunks (66%) fell in places that this plan removes or makes regenerate-only. The id tables alone conflicted in 27 merges. The review also names eight merges that chained `SAMPLERS`, `FOG_GROUPS`, `EXPOSURE_*` or `SKY_*` again by hand. And `9130ce783` fixed two objects under one id (E1305 on the GPU). On 15 October two more branches added ids to the same tables: a present group for the two-step pass and a decal frame group.

### Repeated setup

- Seven copies of the per-compile texture cache in `frame_graph.rs` (`match cache { Some((at, v)) if at == compiles => v, _ => ... }`).
- The wanted, built and declared flags of the transmission copy, the weighted layer and the particle depth copy, each with the same update in `request_pipelines`. Depth of field and the fog repeat the built and declared half.
- Seven linear, clamp-to-edge samplers written out in full: in `bloom.rs`, `dof.rs`, `effects.rs`, `environment.rs`, `exposure.rs`, `final_pass.rs` and `fog_volume.rs`.
- The same `GraphIds` block and the same per-frame setter calls in both builders.

### The test fixture's ids clash

The frame graph's own tests build it from a hand-written `GraphIds`. In it, buffer 14 belongs to three steps, and textures 905 and 906 to two steps each. Group 60 belongs to the fog and the transmission copy, and group 70 to the exposure meter and the weighted layer. The tests check the order of passes, so they pass. But they can never catch an id clash, and the next feature copies the habit.

## Proposal

### 1. A step interface

Each step that the frame graph records itself implements one internal trait. The trait formalizes the shape that the pass modules already have.

```rust
pub(crate) trait FrameStep: Sized {
    /// What the step draws with in a frame, from the scene's settings.
    type Frame: Copy + PartialEq;
    /// The textures that the step reads, found by name once per compile of the graph.
    type Sources: Copy;
    /// The GPU objects that the step owns, which the id table lays out.
    const IDS: IdNeeds;
    /// The most bytes that the step uploads in one frame.
    const UPLOAD_BYTES: usize;

    fn new(ids: IdRange, device: &StepDevice) -> Self;
    fn frame(settings: &SceneSettings, view: &FrameView) -> Option<Self::Frame>;
    fn declare(&self, frame: &Self::Frame, graph: &mut Declare<'_>);
    fn request_pipelines(&mut self, frame: &Self::Frame, cache: &mut PipelineCache, built: u32) -> bool;
    fn sources(planned: &Planned<'_>) -> Self::Sources;
    fn upload(&mut self, frame: &Self::Frame, sources: &Self::Sources, cx: &mut Upload<'_>) -> Result<(), RecordError>;
    fn record(&self, pass: u8, cx: &mut Record<'_>) -> Result<(), RecordError>;
    fn draws(&self, _pass: u8) -> bool { true }
    fn reset_gpu(&mut self);
}
```

A generic holder keeps what `FrameGraph` now holds six times over:

```rust
pub(crate) struct Step<T: FrameStep> {
    pass: Option<T>,                   // made when the step is first wanted
    frame: Option<T::Frame>,
    state: StepState,                  // wanted, built, declared
    sources: CompileCache<T::Sources>,
}
```

One macro list in `frame_graph.rs` names every step, in the order the frame uploads them today:

```rust
frame_steps! {
    ao: AoPass,
    dof: DofPass,
    exposure: ExposurePass,
    fog: FogVolumePass,
    transmission: TransmissionCopy,
    weighted: WeightedComposite,
    particle_depth: ParticleDepthCopy,
}
```

The macro writes the `Steps` struct, a `StepId` enum, and the loops in `request_pipelines`, `upload`, `record`, `reset_gpu` and `upload_bound`. The dispatch is a `match` over `StepId`, so the compiler inlines each call as it does now. `Role` keeps the passes of the scene and gains one variant, `Role::Step(StepId, u8)`, in place of `Bloom(u8)`, `Ao(u8)`, `Dof(u8)`, the four fog roles and the copies.

The post chain gets one place too. One ordered list names the steps that read and write the scene's color: the fog, the effects, depth of field, then bloom and the final pass. `declare` walks it, and each step reads the output of the step before it. A new post step adds one line to the chain.

Some passes need the builder: the fog's light step binds the camera's frame group, and the weighted pass draws sorted rows. The builder's record callback then gets a hook named by its kind, such as `Hook::FrameGroup(ViewId)` or `Hook::SortedDraws(Rows)`. A builder gains an arm only for a new kind of hook.

### 2. One module per feature

A step's module holds its trait impl, its ids, its settings, its frame from the scene's settings, its pass and texture names, and its tests. `SceneSettings` keeps one field per feature, of the module's settings type. Both builders call one shared function, `FrameGraph::set_frames(&settings, &view)`, in place of their own setter calls in two orders.

After the migration a post step like the lit fog touches:

| Place | Lines |
| --- | --- |
| Its module | all of its code |
| `frame_steps!` | 1 |
| The post chain, when it reads the scene's color | 1 |
| `lib.rs` | 1 |
| The template table in Rust and the descriptor table in TypeScript | 1 row per template in each |
| The shader manifest | its shaders and first-use entry, as now |
| The public API (`null3d-wasm`, the engine's TypeScript) | as now |

The builders, the id tables and `frame_graph.rs`'s hub functions take no lines. A feature that draws scene objects, like weighted blending, still changes the builders' draw code, because that is builder work. Its ids, wiring and role arms go away.

### 3. Ids from one table

Each step declares what it owns:

```rust
#[derive(Clone, Copy)]
pub(crate) struct IdNeeds { pub buffers: u32, pub textures: u32, pub samplers: u32, pub groups: u32, pub pipelines: u32 }
```

A `const fn` lays out a list of needs from a first id of each kind, and returns one `IdRange` per entry. The step list supplies the steps' needs, so a new step needs no line in an id table. Each builder keeps one table of its own objects, such as its views' buffers and groups, its blank textures and its compute pipelines. The table is one list of needs, one entry per line. `GraphIds` comes from one shared function that both builders call with their layout.

A unit test in each builder walks the whole layout for each kind of id. It fails when two ranges overlap, when a range is empty, or when a range passes a fixed limit such as `TEXTURE_ARRAYS`. The frame graph's test fixture uses the same layout, so its tests run with ids that do not clash.

The ids stay numbers that the compiler works out. Nothing allocates at run time, and the GPU sees the same kinds of objects in the same order. Only the numbers change, once, in step 3.

### 4. One template descriptor for both GPU paths

The Rust template numbers move into one macro in `drawlist.rs`, one template per line. The macro writes the constants and the TypeScript constant list together, so `typescript_constants()` no longer repeats every name.

A new file, `packages/engine/src/gpu/templates.ts`, holds one row per engine template:

```ts
export interface TemplateRow {
	readonly id: number; // a TEMPLATE_ constant
	readonly label: string;
	readonly shader: keyof DeviceShaders;
	readonly pipeline: string;
	readonly kind: 'mesh' | 'fullscreen' | 'particles' | 'lines';
	readonly layouts: readonly number[]; // WebGPU bind group layouts
	readonly meshLocations?: readonly number[];
	readonly flags?: number; // own prepass, depth fragment, development only
	/** Where WebGL2 has no such template, the reason and its fallback. */
	readonly webgl2Fallback?: string;
}
```

`webgpu/pipelines.ts` defines its templates from the rows, and `webgl2/programs.ts` builds its programs from the same rows. Details that only one backend has, such as a blend state for two targets, stay in that backend. The `HDR_FEATURES` set moves into the shader manifest as an `hdr = true` flag on the first-use entry.

A unit test compares the two paths. Every `TEMPLATE_` constant, apart from the compute templates and `CUSTOM_FIRST`, has exactly one row. Each row's shader exists in both paths' device shaders, or the row names its WebGL2 fallback, as the multisampled `_MS` templates do. Each layout id exists. So the unit tests find a template on one path only, before any image test runs.

`generated/gpu.ts` stays in git, as [D-105](D-105-generated-files-out-of-git.md) decided. Its conflicts become regenerate-only: take main's copy and run the Rust tests that write it, as the merge rule for generated files already says.

### 5. Shared helpers

- `CompileCache<T>` with `get_or(compiles, f)`, for the seven per-compile caches.
- `StepState` with one `settle(built)` method that returns true when the graph must declare again, for the wanted, built and declared flags.
- `linear_clamp_sampler(list, id)` in `frame.rs`, for the seven samplers.
- One `graph_ids(layout)` function and one `set_frames` function that both builders call.

### 6. A safety net first

The migration moves code without changing behaviour, so it needs a check that sees any change. A new integration test in `null3d-render` records frames through the mock GPU for both builders. It runs a set of scenes with each step on and off, on the HDR and 8-bit paths, at the whole scale and below it. It renames GPU ids in order of first use and keeps a hash of each draw list in a small fixture file. Each later step must keep every hash. Pipeline ids come from the order of requests, so the renaming covers them too.

## Options rejected

- **Trait objects in a list (`Vec<Box<dyn FrameStep>>`).** It blocks inlining in the frame loop and splits borrows of the graph. A list fixed at compile time costs nothing at run time.
- **A link-time registry, such as the `inventory` crate.** It adds a dependency and start-up code, and its order is not fixed. The frame's step order matters.
- **Ids from `IdAllocator` at run time.** The numbers would then depend on which feature a sketch turns on first. Draw lists would be harder to compare and debug.
- **Template numbers and descriptors from the shader manifest.** It would move the source of Rust's template numbers out of Rust. The Rust template macro and a TypeScript table read by both backends reach the same goal with a smaller change.
- **Splitting `frame_graph.rs` into files only.** Each feature would still live in 20 to 30 places, now across several files.
- **One large change.** It would conflict with every open branch and could not keep the draw lists checked step by step.

## Migration plan

Each step lands alone, by direct push, with the full local checks of D-157. These are the build, `cargo nextest run -p null3d-render -p null3d-gpu --no-fail-fast`, the unit tests, the image tests of both sets, the size check and the GPU check. No step changes an image reference. Steps 2 and 4 can run beside the others; the rest touch `frame_graph.rs` and go one after another.

| Step | Change | Main files | Effort (helper-days) | What it removes |
| --- | --- | --- | --- | --- |
| 1 | The frame fingerprint test (section 6), and the overlap test over today's hand tables | `null3d-render/tests`, both builders' tests | 1 | nothing yet; it guards the rest |
| 2 | `CompileCache<T>`, `StepState`, `linear_clamp_sampler` | `frame_graph.rs`, seven pass modules | 0.5 | R-17's copies |
| 3 | `IdNeeds`, the `const fn` layout, one table per builder, shared `graph_ids`, the fixture from the layout | both builders, `frame_graph.rs`, a new `id_layout.rs` | 1.5 | the hand-chained ids, 77 hunks |
| 4 | The template macro, `templates.ts`, both backends read it, the parity test, `hdr` in the manifest | `drawlist.rs`, both backends, `device-shaders.ts`, `shaders.toml` | 1.5 | GPU-8, 28 hunks and the regenerate-only ones |
| 5 | The `FrameStep` trait, `Step<T>`, `frame_steps!`, `Role::Step`, builder hooks, `set_frames`; the fog moves first | `frame_graph.rs`, `fog_volume.rs`, both builders | 2 | the hub-function pattern |
| 6 | Depth of field, the exposure meter | `dof.rs`, `exposure.rs`, `frame_graph.rs` | 1 | |
| 7 | The transmission copy, the particle depth copy, the weighted composite | three modules, `frame_graph.rs` | 1 | the three wanted, built and declared copies |
| 8 | Ambient occlusion, then bloom | `ao.rs`, `bloom.rs`, `frame_graph.rs` | 1.5 | |
| 9 | The custom effects, the full-screen passes, the view copies, then the final pass and its two steps | `effects.rs`, `fullscreen.rs`, `view_copy.rs`, `final_pass.rs`, `frame_graph.rs` | 2 | the last hub branches; R-02's two decisions in one place |
| 10 | Each step's settings into its module; `SceneSettings` keeps one field per feature | `frame.rs`, the modules | 1 | part of `frame.rs`'s 16 hunks |
| 11 | The frame graph's tests move beside their steps; `frame_graph.rs` keeps the views, the order and the record loop | `frame_graph.rs`, the modules | 0.5 | |
| 12 | The checklist "Add a renderer feature" in the implementation notes, and this record set to decided | `.dev/implementation-notes.md`, this record | 0.5 | |

Total: about 14 helper-days. With steps 2 and 4 run by a second helper beside the chain, about 12 working days.

The fingerprint test comes first, because every later step relies on it. The id layout comes before the trait, because it removes the largest class of conflicts and the trait's `IdRange` needs it. The fog moves first because it is the newest and most self-contained step. The final pass moves last because it holds the two-step pass, where R-02 and R-04 come from.

## Expected merge-clash reduction

After step 5, a new post step changes no hub function. Two branches then conflict only when they add lines next to each other in one list: the step list, the post chain, the template macro or the descriptor table. Lists of one item per line make such conflicts small and easy to merge.

- The id table conflicts (77 hunks in 27 merges) stop, because steps take no id table line.
- The `frame_graph.rs`, role arm and wiring conflicts (79 hunks) fall to the one-line lists.
- The template list conflicts (28 hunks) fall to adjacent rows, and the generated constants become regenerate-only.

Over the measured merges, that would remove 55% to 60% of the renderer's conflict hunks. That is the 184 hunks of the first three classes, less some conflicts of adjacent list lines. The 16 generated ones still conflict, but need no hand merge. The remaining 105 hunks belong to the permutation bits, the shader manifest, the materials' feature bits and the public setters. D-156 and D-173's hooks cover those.

## Not covered

- A quality feature also spreads over the engine's TypeScript: the presets, the governor's steps, the runner, `shared/core.ts` and the `Scene` fields. The same review lists this beside GPU-8. It needs its own record.
- The WebGPU fragment stage now reads 16 of its 16 sampled textures. The descriptor could later carry each template's texture count for a budget test, as review findings R-07 and H-6 ask.

## Rulings

The owner approved items 1 and 2 on 15 October 2026, and step 1 started at once.

1. Approve the design: the step trait and one module per feature. Ids come from one table with an overlap test, and both GPU paths read one template descriptor with a parity test.
2. Approve the plan: twelve landings in the order above, each with unchanged draw lists and image references, starting after the open feature branches land.
3. Whether step 1, the fingerprint and overlap tests, may land at once. It adds only tests, and it catches id clashes from today.

## Addendum, 17 October 2026: the owner defers the plan

The owner deferred this plan on 17 October 2026. The renderer is in a good place, and he does not
want a change that would drastically alter how the engine works. This record's twelve landings move
every step behind one trait. They replace both builders' hand-chained id tables, give both backends
one template descriptor, and move the frame graph's tests into the step modules. That is such a
change, so none of it starts now. The plan stays here as the record of the debt and of the work it
needs.

My reading of why it is deferred:

- The figures in this record measure merge cost, not correctness. 200 of 305 conflict hunks fell in
  places that the plan removes, but the engine draws correctly today. A conflict is paid once by a
  maintainer. A regression in the step trait or in the id layout would reach every step at once.
  Both builders and the graph's tests would change with it, and only the image tests would see it.
- The plan's own precondition has not changed: it starts after the open feature branches land. The
  renderer's file is contested by several branches today. That is the state the plan is meant to
  end, and it is also what makes a large landing risky now.
- Each landing promised unchanged draw lists, and a fingerprint test would guard them. That test
  does not exist yet, so a landing would be checked by the image tests alone.
- Nothing in the plan is a promise to a page today. The renderer has no public shape that depends
  on its internal step structure.

Two things would make it worth revisiting. Renderer conflicts could rise again across parallel
work. Or a feature might again need 20 to 30 places in `frame_graph.rs` and both id tables. Until
then the debt stays recorded here and in review findings M-9, R-16 and R-17, with no code changes.
