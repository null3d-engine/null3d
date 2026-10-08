# D-104: Scene passes and render-to-texture

Status: decided. Date: 2026-10-08. Task: M2-F6 (part 1).

Summary: `render.addPass({ kind: 'scene' })` adds a view that draws the scene from a sketch's camera into a texture of a fixed size, which `textures.fromPass` gives to materials. The texture is a kept, one-layer array target of the render graph, so its id stays put and it holds its last image. A pass runs only while something shows its texture: the graph culls optional passes that feed nothing. A view never draws an object that shows a pass texture it does not read. On WebGPU a copy pass turns each image upright, since materials sample v = 0 at the bottom row as three.js's render targets hold it. Graph errors throw from the call that caused them, with names.

## Question

How does a sketch draw the scene from a second camera into a texture that materials show, as three.js's `WebGLRenderTarget` with `renderer.setRenderTarget` does, on all three tiers? The plan (section 6.6, idea 3 of 13.2, task M2-F6) asks for passes as declarations, with the graph's errors reaching the sketch with codes, a check of the colour attachment limits, culling of passes whose output nothing reads, and `render.dumpGraph()`.

1. What target does a pass draw into, and how do materials bind it?
2. Which way up is the image, on each GPU path?
3. How does a view avoid sampling the texture that it draws into?
4. When does a pass run, and what does an unused pass cost?
5. How do the graph's errors reach the sketch?
6. What limits does the graph check?

## Rule

- One API and one look on WebGPU, compatibility mode and WebGL2. A port of a three.js render target shows the same image the same way up (D-52, intent parity).
- No cost for scenes without passes, and none for a pass whose texture nothing shows (design principle 8).
- No per-frame allocation, also when a sketch switches a pass on and off every few frames.
- The portable budget of limits (hard rule 6).
- Each new layout, template, error code and shader set takes a number from the coordinator's claims: layout 25, template 39, E1220, first-use set `views`, camera targets from 2.

## Data

### Existing pieces and what they lacked

Research of the code on 8 October 2026, on `feat/m2-f5-fused-effects`:

- The core already had views beyond the camera's (`SceneSettings::add_view`, up to 32), culled on both paths. No call reached them from the sketch. Their targets were canvas-sized frame targets that no pass read, and their aspect was the canvas's.
- Materials bind every texture as a layer of a `texture_2d_array` (D-47), through bind groups that the texture store makes. A graph target can be a one-layer array, so it fits a map slot.
- On WebGPU, every view's bundle sets the map group of every bucket, even a bucket with no instance in that view. The backend replays bundles as render pass commands, so each group joins the render pass's usage scope. A material that samples view N's texture therefore made view N's render pass sample its own attachment: a validation error on WebGPU, and a feedback loop on WebGL2 if the object drew.
- Graph errors in a frame only reached `console.error`, as numbers without names, and the frame drew nothing. The fix text of E1502 to E1505 said "engine bug".
- The graph checked no colour attachment count and no bytes per sample (review new issue 13).

### Image orientation

Images upload with their first row at v = 0, the bottom of a plane (`textures.fromImageBitmap`). three.js's render target textures, sampled on a plane, stand upright too: WebGL draws the bottom row first. WebGL2 draws a view's rows in that order, so its texture needs nothing. WebGPU draws the top row first, so a texture straight from a WebGPU view stands upside down.

## Decision

1. **Target.** A scene pass's colour is a kept target of the graph: a texture array of one layer at the pass's fixed size, in the scene colour's format. Kept targets come first in the plan and keep their place, and they hold the last image, which `render.setPassEnabled(pass, false)` relies on. The texture store gains "pass arrays", whose GPU id the frame builder gives each frame from the plan (`set_pass_target`). Their bind groups are made again whenever the graph makes its textures again. A pass texture samples as no texture until the pass first draws, as an image samples until it uploads.
2. **Orientation.** On WebGL2 the view draws into its target directly. With MSAA the target is multisampled and resolves into its sampled texture, whose samples need no store. On WebGPU the view draws into an image of its own, and a full-screen copy pass (`view_copy.wgsl`, template 39, layout 25) reads each texel from the mirrored row into the target. The copy loads on first use, as the `views` shader set, and the texture samples as no texture until its pipeline is built.
   Options rejected:
   - Turning v around in every shader that samples a map, as three.js's `TextureNode` does for render targets on WebGPU. It adds a test to every map sample of every material, sprite and custom material, and custom materials' `textureLoad` and `textureGather` calls would need their coordinates rewritten.
   - Drawing the WebGPU view upside down in clip space. That reverses the triangles' winding, and WebGPU fixes the front face per pipeline, so each material drawn in a pass would need a second pipeline.
   The copy costs one texel read and write per texel of the target, only on WebGPU and only while a pass runs: about 0.5 MB of memory traffic per frame for a 256 x 256 minimap.
3. **No sampling of its own target.** Each view other than the camera's has a mask of the views whose targets it reads (its `reads`). A bind group knows the views whose targets it binds (`group_pass_views`). A view leaves out every bucket, transparent draw and WebGL2 draw whose maps' group binds a target that it does not read, its own included. The camera's view reads every shown target. So a mirror never draws itself, and a minimap's screen never appears in the minimap, without layers.
4. **When a pass runs.** Passes of views other than the camera's are optional. The graph culls an optional pass that no running pass uses, then the optional passes that only fed it, until nothing changes. A kept target that only culled passes use takes no texture. The camera's passes read every target that a live texture shows, which also orders the pass before them. So a pass without a shown texture costs nothing. A switched-off pass that something shows keeps its texture and last image; one that nothing shows is culled and frees it. The WebGL2 builder culls on the CPU only the views that can draw (`view_draws`), and the WebGPU builder uploads values only for them.
5. **Errors.** `render.addPass`, `render.removePass` and `textures.fromPass` compile the graph at once in the core, outside a frame (`check_graph`). On failure the core restores the graph as it was, and the call throws E1502 to E1505 with the graph's own message, which names the passes and targets (`renderGraphMessage`). A frame that fails to compile now reports the same message. The fix texts of E1502 to E1505 now tell a sketch what to change. Invalid options throw the new E1220. A pass that names its own texture in `reads` throws E1504 in TypeScript, because the graph keeps only the larger use of a resource that one pass names twice. The graph checks the uses of every declared pass, culled ones too, so a pass that reads a texture no pass writes fails at `render.addPass`, even while nothing shows its texture. Before that check, such a pass was culled and its error came only from the later `textures.fromPass` that made it run: the browser test of in-sketch errors found this. A pass reads only the textures of passes added before it, so scene passes cannot read each other in a loop.
6. **Limits.** The graph checks each pass's colour targets against the portable budget: at most 4, of at most 32 bytes per sample in all, with WebGPU's byte cost and alignment of each format (`Limit::ColorAttachments` and `Limit::ColorAttachmentBytesPerSample`). A render pass holds the targets of one of its passes, so a pass that fits always shares a render pass that fits. Rather than the device's own limits (8 on core WebGPU), the check uses the budget that compatibility mode and WebGL2 also meet, so a pass that works on one device works on all. A failure is a new kind of E1505.
7. **Sizes and views.** A pass has a fixed size in pixels, and its camera's lens takes the target's aspect. A texel counts as a pixel for sizes given in pixels, such as wide lines and sprites of constant size. A scene pass culls in one phase: two-phase occlusion culling builds its depth pyramid at the render size, so only views at the render size use it. A removed pass leaves its place free for the next one, so the other views keep their GPU objects.
8. **Dump.** `render.dumpGraph()` returns the core's DOT text of the whole graph, with culled passes dashed and marked.

### M2 limits, and the follow-up task

Scene passes draw the sun, its shadows where the camera's cascades reach, the ambient light, the environment's light and fog. They draw no point or spot lights, because the light grid is the camera's alone, no ambient occlusion and no sky background. Development builds warn once when a scene pass draws a scene that has point or spot lights, so an author is not surprised by a mirror or minimap without its lamps. Point and spot lights in scene passes would take about two days on both GPU paths: each view needs its own pick of lamps, its own light grid, its own buffers or data textures and bind groups. Reusing the main camera's lamp list would still drop the lamps behind the main camera, which a minimap shows, so it would not meet intent parity either. The coordinator ruled on 8 October 2026 that part 1 ships without them, and that they come as their own task right after part 1, before part 2. Ambient occlusion and the sky in scene passes wait for a later task. On the 8-bit path, WebGL2 devices without float targets keep display color in a pass texture, as the next section says. Part 2 of M2-F6 adds full-screen passes of the sketch's WGSL, targets at half and quarter size, and the outline mask as an input.

### Display color on the 8-bit path (coordinator's call, 8 October 2026, pending the owner's review)

The 8-bit path serves compatibility mode with MSAA, and WebGL2 devices whose float targets fail. There each scene shader tone maps its own color and encodes it as sRGB, so a view draws display color. The first build stored that color in the pass texture as it was. A material that showed it took the encoded values for linear color, then tone mapped and encoded them again. On Chrome on the Mac's GPU, the minimap's grey ground showed at about 207 to 210 of 255 in compatibility mode, against 157 to 168 on core WebGPU. Its red box showed at (228, 167, 163) against (218, 72, 70). The map looked pale and washed out, far from what the author drew.

Options:

- A. Keep it as a documented limit.
- B. On WebGPU, decode the color back in the copy that already turns each image upright, into an sRGB texture. The copy's TONE_MAP build writes the decoded color, and the sRGB texture encodes it again as it stores it, so the texture keeps the image's bytes, and materials that sample it read linear color. This costs no new pass and no new texture. WebGL2 has no copy, so its 8-bit devices keep the limit.
- C. Draw the views of the 8-bit path without the tone curve: a second pipeline for each material that a pass draws. It is exact, but every such material builds an extra shader on first use, on the weakest devices that take this path.

The coordinator chose B on 8 October 2026, at the helper's recommendation, and flagged it for the owner's review. With B, the same picture gave the ground at 173 to 183 and the red box at (227, 78, 72). The remaining difference is the tone curve, which the material that shows the texture applies a second time to color that was already tone mapped. With the default ACES curve, a mid grey of 0.5 comes out at about 0.62; with `toneMapping: 'none'`, nothing changes. WebGL2 devices without float targets still store display color, which a material shows washed out, as above. Those devices are rare, since nearly every WebGL2 device passes the engine's float target test.

## Consequences

- Code: `crates/null3d-render/src/graph.rs` and `graph/compile.rs` (culling, the colour budget, kept targets that resolve without storing their samples), `frame_graph.rs` (views' targets, copies, reads, clear colours), `view.rs`, `view_copy.rs`, `textures.rs` (pass arrays), both builders (hidden buckets), `crates/null3d-wasm/src/lib.rs` (`addScenePass`, `removeScenePass`, `setScenePassEnabled`, `createPassTexture`, `renderGraphMessage`, `renderGraphDot`), `packages/engine/src/scene/render.ts` and `textures.ts` (`fromPass`), and the WebGPU backend's layout and template.
- The 8-bit copy: `view_copy.wgsl` has a TONE_MAP build, and the pass targets that WebGPU's copies fill are `rgba8unorm-srgb` on the 8-bit path (`view_target_format` in `frame_graph.rs`).
- Docs: `api/render` (written), `guides/custom-passes` (render to a texture), `concepts/render-graph`, `api/textures`, the mapping entry `render-target`, E1220 and the fixes of E1502 to E1505.
- Skills: the develop skill's quick reference, recipes, shaders and `SKILL.md`, and the port skill's post-processing notes.
- Demo: `examples/security-camera` shows a scene pass on a monitor, and its held frame checks option B's colours in compatibility mode against the tone curve applied twice ([image tests](../image-tests.md#the-feature-demos)).
