# D-140: Per-object motion vectors

Status: decided. The owner put per-object motion vectors before 1.0 ([D-129](D-129-temporal-anti-aliasing.md)). Built: the motion pass and its debug view are on main. Task: M2-EX25, and M3-V3 for the last frame's flag.

Summary: The engine records how far each pixel's surface moved on the screen since the last frame, for passes such as motion blur and screen-space reflections that reuse the last frame. A motion pass draws only the objects that moved, into a two-channel half-float target that holds each surface's motion beyond the camera's. Nothing runs, downloads or takes memory while no pass reads it.

## Question

D-129's prototype of temporal anti-aliasing smeared the Creek's swaying grass and its water two to three times as much as MSAA. It knew only how the camera moved, and read each pixel's history from where a still surface would have been. Every engine that ships temporal anti-aliasing or motion blur records per-object motion first. How should null3D record it on WebGPU, in compatibility mode and on WebGL2, and what does it cost?

## Rule

- Every moving surface records its motion: objects that a setter or their parent moves, instance batch rows, skinned and morphed meshes, and custom materials whose vertex offset sways them, such as grass in the wind.
- The camera's own move counts too: a reader must get each pixel's whole motion.
- All three GPU paths, with the same meaning and units.
- Zero cost while no pass reads the motion: no pass, no target, no buffer, no shader download ([AGENTS.md](../../AGENTS.md#design-principles), principle 8).
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1).
- The WebGPU main pass gains no binding: with parallax maps its fragment stage already reads 16 sampled textures, the most that every device allows.

## Options

### Where the motion is drawn

| Option | Who does it | Verdict |
| --- | --- | --- |
| A: a second color target of the camera's opaque pass (multiple render targets) | three.js's `WebGPURenderer` with `mrt({ output, velocity })`, Unreal with its velocity in the base pass | Rejected |
| B: a pass of its own after the scene passes, which draws only the objects that moved, tested against the scene's depth | Unity's motion vector pass, Unreal's default velocity pass | Chosen |
| C: the depth prepass draws the motion beside the depth | Unreal with an early velocity pass | Rejected |

Option A changes every pipeline that draws in the camera's render pass: lit and unlit meshes, the background, sprites, lines, the debug lines and every custom material. WebGPU requires each pipeline to list every attachment of its render pass. The draw list holds one color target per render pass and per pipeline, so the change reaches both backends, the bundles and the graph. Each pipeline's vertex stage would also read the last frame's transforms, joints and weights, which adds bindings to the main pass that parallax materials have no room for. And every opaque pixel would write the target in every frame, moving or not.

Option C needs the depth prepass, which most presets leave off ([quality presets](../../docs/concepts/quality-presets.md#the-depth-prepass)).

Option B leaves the main pass alone. Its pipelines bind only what motion needs, so the texture limit holds. A still scene draws nothing in it but a clear. It costs a second vertex pass over the moving objects. That is the trade that Unity and Unreal make by default. The outline mask is the same kind of pass already: its own view, its own culling and layout, and the scene's depth as its depth target, read but never written.

A custom material whose fragment stage tests its own coverage reads its row of custom values there, so its motion build declares that texture in the fragment stage. The motion pass's frame group gives that texture to both stages, as the depth group does. A vertex-only entry there stops every such material's motion pipeline from building on WebGPU, with E1408, and the motion view of a custom material shows it.

### What the target holds

The motion target holds two 16-bit floats per pixel (`rg16float`, a new format code), in units of the image: the change of texture coordinates across the render size, x right and y down, from the top left as effects count them.

It does not hold the whole motion of each pixel. It holds the surface's own motion beyond what the camera's move explains:

- Let `P` be the surface's point in this frame and `P'` the same point in the last frame, both relative to this frame's camera.
- The camera's last view-projection matrix, moved to this frame's camera, gives `uv'(P)`: where the point would have been seen if it had not moved, and `uv'(P')`: where it was seen.
- The target holds `uv'(P) - uv'(P')`.

The target clears to 0, so a pixel of a still surface needs no draw. A reader finds the whole motion of any pixel from its depth: it rebuilds `P` from the depth, projects it with the last view to get the camera's part, and adds the target's value. Temporal anti-aliasing, motion blur and reflections all read the depth already. A character that the camera follows moves with the camera: its own part cancels the camera's, and its whole motion comes out near 0, as it should.

Two other layouts were weighed. The whole motion of each pixel would need every still pixel drawn, by a full-screen step that reads the depth: one more pass and one more read of the depth in every frame. The whole motion only for moving pixels, with a mark for the others, breaks at edges with MSAA: the resolve averages a real value with the mark. Averages of the chosen values are still right, since a still sample adds 0.

Half floats keep a relative precision of 1 / 2,048: a motion of half a pixel at 1,920 pixels across keeps about 0.0003 pixels, and one of 500 pixels about 0.25 pixels.

### Which objects draw

Every opaque mesh and material pair that writes depth draws, with a motion pipeline of its own. Masked pairs keep their material's base color map and cutoff, as masked casters do, so they cut the same holes. Unmasked pairs share one pipeline for each mesh layout. Blended pairs, sprites and lines do not draw: they write no depth, and their pixels get the camera's part alone.

Each frame picks the instances that moved:

- On WebGPU a fourth layout, the motion layout, holds the pairs, grouped as the casters' layout is, and a build of the culling shader culls it with the camera's view. It compares each instance's world matrix with the last frame's, bit for bit. It keeps the instances that moved, and every instance of a bucket that moves by itself: skinned and morphed meshes, and custom materials with a vertex offset. It writes both matrices into the view's compacted instances, 112 bytes each.
- On WebGL2 the job workers cull nothing more. The motion pass replays the camera view's opaque calls, from the same index list, draw records and instance textures, with each draw's motion program. It leaves out each call whose buckets hold nothing that moved: a scene object counts as moved in a frame whose upload list holds its row, a static batch in a frame that uploads any of its rows, and a dynamic batch with rows in every frame. Still instances in a call that draws draw a motion of 0, which costs a little but is right.

An object that changes grid cells keeps its motion: the culling shader moves the last matrix by whole cells of 1,024 m, the step that brings it nearest to the new one.

A bucket of skinned copies names no first joint of its own. It holds the sentinel that sends each copy to its own skin in the skin firsts texture, and every pass that reads the joint texture resolves it. The motion culling resolves it as the scene's culling does. A record left with the sentinel sends the shader past the texture's rows, where every texel reads as zero, and the object shows no motion at all. The motion spec's skinned case catches this on WebGPU, where the motion culling runs.

### The last frame's data

The core keeps two world buffers, one per frame parity, but the sketch worker may already write the next frame into the older one while the thread that draws records. So the last frame's data lives on the GPU, and only while a pass reads the motion. The GPU copies it there:

| Data | WebGPU | WebGL2 |
| --- | --- | --- |
| World matrices | Copies of the matrix buffer | Copies of the resident data texture. The streamed ring of dynamic batches already keeps the last frame in its previous slot |
| Joints of meshes skinned in the vertex shader | Copies of the joint texture | The same |
| Meshes that the skinning pass skins or morphs | Copies of the skinned vertex buffers, which the motion pipelines read as a second vertex buffer | The vertex shader morphs, so copies of the morph weights texture |

On WebGL2 the copies of the joints also hold the morph weights, in the rows after the joints. The motion block gives the first row of the weights. In its vertex stage, a skinned and morphed draw that reads its draw records from a texture reads 12 textures, the last frame's joints, resident rows and streamed rows among them. A separate texture for the last weights made 13, above the 12 that each stage may take: 16, less 4 kept for later features. The shared texture costs no extra copy.

Each kind of data has two copies, one for each frame parity. A frame reads the copy of the parity before its own. After its last pass it copies its own data into its own parity's copy, for the next frame. A capture draws the last frame again from its recorded commands, so a frame must leave the copy that it reads as it found it: with one copy, a capture would read the frame's own data and draw no motion.

The copy of a parity last took the frame before the last one. So a frame copies the matrix rows that it or the last frame uploaded, which the renderer tracks as byte ranges in memory reserved up front, and the joints, weights and skinned vertices whole. A frame copies after its passes, not before them: WebGPU's buffer writes reach the queue before the commands of their own submission, so a copy at the start of a frame would already see that frame's uploads.

A frame that rebuilds the draw tables, makes a copy, or is the first after a reader asks for motion fills both copies with its own data. Its objects draw no motion of their own in that frame: readers get the camera's part alone.

### Vertex offsets

A custom material with a vertex offset gets builds of its template that draw motion, beside its shadow caster builds ([D-127](D-127-row-values.md)). Their vertex shader calls `vertexOffset` twice: with this frame's built-in values, and again with `frame.time` and `frame.deltaTime` of the last frame. So grass that sways by `sin(frame.time)` records its sway. Uniforms and row values count as unchanged since the last frame. As with shadows, a custom material's alpha does not cut holes in its motion.

### The camera

The motion uniform holds the last frame's view-projection matrix, moved from the last camera's place to this one, as the TAA prototype's reprojection does. It lives in the motion pass's own group, not in the frame uniform that every pipeline reads. Projections carry no jitter, and the motion lies between projections without one.

### The pass

The render graph declares two optional passes after the camera's transparent pass, and on WebGPU a culling pass before them:

- `MotionCulling` (WebGPU): the motion view's culling.
- `Motion`: draws the moving objects into `motionVectors`, at the scene's samples, with the scene's depth as its depth target. It tests the depth as near or equal, with the outline mask's small bias toward the camera, and writes none. The motion pipelines compute the clip position with the same math as the main pass, marked invariant, so the bias covers only the differences between programs that WebGL2 allows. With MSAA the target resolves into one sample for its readers.
- A reader, such as the motion debug view.

An optional pass runs only while a running pass reads what it writes, so neither costs anything while nothing reads the motion. The debug view, or a feature that declares `motionVectors` among its reads, turns it on.

### Texture slots

The motion pass's pipelines bind their own frame group: the depth template's group with the motion uniform, the last frame's joints and, on WebGL2, the last frame's data textures. On WebGPU a motion pipeline's vertex stage reads at most 5 sampled textures, and its fragment stage 1, a masked material's base color map. The main pass gains none. On WebGL2 the motion programs stay within the 16 units that every device gives a stage, with room to spare.

### Devices

The target must draw with the scene's samples. WebGPU draws `rg16float` with MSAA, and so does compatibility mode: it cannot multisample `rgba16float` or `r32float`, but `rg16float` keeps its MSAA and resolve there. WebGL2 tests at the start that it can draw `rg16f`, with and without MSAA, and that it can copy `rgba32f` textures, which hold the last frame's data. The page tells the renderer what the device can do, and where the target cannot draw, no motion pass runs and the readers bind a blank texture in its place. Readers then get the camera's part alone, which is what D-129's prototype had.

### Hold mode

A held frame is the first frame that the thread that draws draws, so it has no last frame. While a pass reads the motion, the sketch thread publishes the frame before the held one too, and the thread that draws draws both in turn. The held frame then has a last frame one step of 1/60 s before it. This is the frame slot that screen-space reflections use for the same purpose (`HeldFrom`).

### The debug view

`debug.view('motion')` shows each pixel's whole motion over the last frame: its direction as the hue, from red to the right through yellow-green downward, cyan to the left and violet upward, and its length as the brightness, full at 16 pixels. A still pixel is black. A full-screen step reads the motion target and the depth, and draws over the scene color. As in the other debug views, the frame draws no effects, bloom or tone mapping.

## Cost

Download size, after Brotli, measured with `bun run build:check-size` against main:

- The largest start, pipelined WebGPU, grows by 0.8 KB, to 144,177 bytes after Brotli, within the start budget ([D-14](D-14-js-budget.md)). The page's WebGL2 shader combos file holds most of the 0.8 KB, and grows 10.8%.
- The core's WebAssembly files grow by about 2% each. They hold the motion pass in both frame builders, with its layouts, its culling, the copies of the last frame's data and the debug view.
- The motion shaders load on first use. Each file holds the motion builds beside the features that a page loads with. A page that never reads the motion never downloads them.
- Loading the WebGPU motion pipelines on first use as well makes the start bigger, not smaller, so they stay in the start code.

GPU time, measured in Chrome 155 on the Mac's M5 Max at 120 Hz, in a parked window:

- The GPU check follows the rule of [D-109](D-109-gpu-time-guard.md) and passed. On S4 and S6, whose scenes read no motion, this build against main's merge base: S4 medium 3.98 to 4.04 ms, S6 medium 4.61 to 4.60 ms, S4 high 4.31 to 4.26 ms, S6 high 4.82 to 4.79 ms. Every page is within its rule's noise, so nothing reads the motion and the engine pays nothing.
- The motion pass's own cost, from the cost page at render scales 1 and 0.5, with the effect off and then on: WebGPU 1.33 to 1.34 ms and 1.71 to 1.83 ms; compatibility mode 1.28 to 1.45 ms and 1.14 to 1.26 ms; WebGL2 2.70 to 4.53 ms and 2.77 to 4.14 ms. The WebGPU paths draw the moving objects once more in a pass with few bindings, so it stays under 0.2 ms. WebGL2 replays the camera's draws, which costs more.

## Decision

Option B: a motion pass of the moving objects, into a two-channel half float target, holding each surface's own motion beyond the camera's.

## Consequences

- Code: `crates/null3d-render/src/motion.rs` (the uniform, the reprojection and the debug view's step), the motion layout and view in both frame builders, the culling shader's motion build, `motion.wgsl` and the motion builds of `lit.wgsl`, the new format, and both backends' templates.
- Docs: the debug view in `api/debug`, the motion pass in `concepts/render-graph` and `concepts/post-processing`.
- Later: motion blur, and a function that lets custom effects read the motion. Temporal anti-aliasing will not read it: [D-206](D-206-temporal-resolve.md) drops TAA.

## Tables while the motion pipelines load

The builder uploads the motion layout's tables when it rebuilds the requested motion layout. It still waits for the pipelines before drawing motion.

Tables that uploaded only while the motion view could draw would stay unmade when the layout rebuilds while the motion pipelines load. Once the pipelines finish, no scene change asks for another upload. The first motion frame would then read a table that was never made, and the drawing worker would stop on a buffer that does not exist. A mock-backend test covers motion requested at the start and enabled after ordinary frames.

## The last frame's call says which it is

`FrameValues` holds `lastFrame`, a boolean that is false everywhere and true only for the motion
build's second call, which runs with the frame before's time, step and index (M3-V3). Without it, a
vertex offset that reads data a compute pass wrote for this frame and the frame before cannot tell
the two calls apart. Both calls see the same uniform value and row value, and the texture holds
whichever image the pass last wrote. A vertex offset that
reads a texture holding both frames' data then takes the row for the call it makes:

```wgsl
var poses: texture_2d<f32>;

fn vertexOffset(input: VertexInput) -> vec3f {
    let row = select(0, 1, frame.lastFrame);
    return vec3f(textureLoad(poses, vec2i(0, row), 0).r, 0.0, 0.0);
}
```

The main, shadow caster and pick builds set nothing, so they read the frame's own row. The motion
build draws the difference of the two calls.

The `compute-vertex-offset` motion test proves it. Without the value both calls read the same row,
the plane shows no motion, and the test fails on every tier.
