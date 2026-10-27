# D-104: Scene passes and render-to-texture

Status: decided and built, with the full-screen passes of part 2. Task: M2-F6.

Summary: `render.addPass` adds scene passes, which draw the scene from a sketch's camera into a texture that `textures.fromPass` gives to materials, and full-screen passes of an effect's WGSL. A pass runs only while something shows or reads its texture, at a fixed size or a half or quarter of the render size. Each camera view has its own light grid, graph errors throw from the call that caused them, and WebGPU copies each image upright.

## Question

How does a sketch draw the scene from a second camera into a texture that materials show, as three.js's `WebGLRenderTarget` with `renderer.setRenderTarget` does, on all three tiers? The plan (section 6.6, idea 3 of 13.2, task M2-F6) asks for passes as declarations, with the graph's errors reaching the sketch with codes, a check of the color attachment limits, culling of passes whose output nothing reads, and `render.dumpGraph()`.

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

### The pieces that passes build on

- The core holds views beyond the camera's (`SceneSettings::add_view`, up to 32), culled on both paths.
- Materials bind every texture as a layer of a `texture_2d_array` (D-47), through bind groups that the texture store makes. A graph target can be a one-layer array, so it fits a map slot.
- On WebGPU, every view's bundle sets the map group of every bucket, even a bucket with no instance in that view. The backend replays bundles as render pass commands, so each group joins the render pass's usage scope. A material that samples view N's texture would therefore make view N's render pass sample its own attachment. That is a validation error on WebGPU, and a feedback loop on WebGL2 if the object draws.
- A graph error found inside a frame can reach the sketch only through `console.error`, and that frame draws nothing.

### Image orientation

Images upload with their first row at v = 0, the bottom of a plane (`textures.fromImageBitmap`). three.js's render target textures, sampled on a plane, stand upright too: WebGL draws the bottom row first. WebGL2 draws a view's rows in that order, so its texture needs nothing. WebGPU draws the top row first, so a texture straight from a WebGPU view stands upside down.

## Decision

1. **Target.** A scene pass's color is a kept target of the graph: a texture array of one layer at the pass's fixed size, in the scene color's format. Kept targets come first in the plan and keep their place, and they hold the last image, which `render.setPassEnabled(pass, false)` relies on. The texture store holds "pass arrays", whose GPU id the frame builder gives each frame from the plan (`set_pass_target`). Their bind groups are made again whenever the graph makes its textures again. A pass texture samples as no texture until the pass first draws, as an image samples until it uploads.
2. **Orientation.** On WebGL2 the view draws into its target directly. With MSAA the target is multisampled and resolves into its sampled texture, whose samples need no store. On WebGPU the view draws into an image of its own, and a full-screen copy pass (`view_copy.wgsl`, template 39, layout 25) reads each texel from the mirrored row into the target. The copy loads on first use, as the `views` shader set, and the texture samples as no texture until its pipeline is built.
   Options rejected:
   - Turning v around in every shader that samples a map, as three.js's `TextureNode` does for render targets on WebGPU. It adds a test to every map sample of every material, sprite and custom material, and custom materials' `textureLoad` and `textureGather` calls would need their coordinates rewritten.
   - Drawing the WebGPU view upside down in clip space. That reverses the triangles' winding, and WebGPU fixes the front face per pipeline, so each material drawn in a pass would need a second pipeline.
   The copy costs one texel read and write per texel of the target, only on WebGPU and only while a pass runs: about 0.5 MB of memory traffic per frame for a 256 x 256 minimap.
3. **No sampling of its own target.** Each view other than the camera's has a mask of the views whose targets it reads (its `reads`). A bind group knows the views whose targets it binds (`group_pass_views`). A view leaves out every bucket, transparent draw and WebGL2 draw whose maps' group binds a target that it does not read, its own included. The camera's view reads every shown target. So a mirror never draws itself, and a minimap's screen never appears in the minimap, without layers.
4. **When a pass runs.** Passes of views other than the camera's are optional. The graph culls an optional pass that no running pass uses, then the optional passes that only fed it, until nothing changes. A kept target that only culled passes use takes no texture. The camera's passes read every target that a live texture shows, which also orders the pass before them. So a pass without a shown texture costs nothing. A switched-off pass that something shows keeps its texture and last image; one that nothing shows is culled and frees it. The WebGL2 builder culls on the CPU only the views that can draw (`view_draws`), and the WebGPU builder uploads values only for them.
5. **Errors.** `render.addPass`, `render.removePass` and `textures.fromPass` compile the graph at once in the core, outside a frame (`check_graph`). On failure the core restores the graph as it was, and the call throws E1502 to E1505 with the graph's own message, which names the passes and targets (`renderGraphMessage`). A frame that fails to compile reports the same message. The fix texts of E1502 to E1505 tell a sketch what to change. Invalid options throw E1220. A pass that names its own texture in `reads` throws E1504 in TypeScript, because the graph keeps only the larger use of a resource that one pass names twice. The graph checks the uses of every declared pass, culled ones too, so a pass that reads a texture no pass writes fails at `render.addPass`, even while nothing shows its texture. Without that check, such a pass is culled, and its error comes only from the later `textures.fromPass` that makes it run. A pass reads only the textures of passes added before it, so scene passes cannot read each other in a loop.
6. **Limits.** The graph checks each pass's color targets against the portable budget: at most 4, of at most 32 bytes per sample in all, with WebGPU's byte cost and alignment of each format (`Limit::ColorAttachments` and `Limit::ColorAttachmentBytesPerSample`). A render pass holds the targets of one of its passes, so a pass that fits always shares a render pass that fits. Rather than the device's own limits (8 on core WebGPU), the check uses the budget that compatibility mode and WebGL2 also meet, so a pass that works on one device works on all. A failure is a kind of E1505.
7. **Sizes and views.** A pass has a fixed size in pixels, and its camera's lens takes the target's aspect. A texel counts as a pixel for sizes given in pixels, such as wide lines and sprites of constant size. A scene pass culls in one phase: two-phase occlusion culling builds its depth pyramid at the render size, so only views at the render size use it. A removed pass leaves its place free for the next one, so the other views keep their GPU objects.
8. **Dump.** `render.dumpGraph()` returns the core's DOT text of the whole graph, with culled passes dashed and marked.

### What scene passes draw

Scene passes draw the sun, its shadows, the ambient light, the point and spot lights that their cameras see, the environment's light, fog and the scene's background. No pass draws ambient occlusion ([below](#full-screen-passes-half-and-quarter-sizes-and-the-outline-mask)). Reflection passes, another kind of pass, draw the scene's background too ([D-120](D-120-planar-reflections.md)). On the 8-bit path, WebGL2 devices without float targets keep display color in a pass texture, as [Display color on the 8-bit path](#display-color-on-the-8-bit-path) says.

### Point and spot lights in scene passes

A scene pass draws the point and spot lights that its camera sees. If only the camera's view had a light grid, a minimap of a lit street at night would show the street dark.

Options:

- A. Reuse the camera's light list in the passes. It drops every lamp outside the camera's view, and a minimap or a rear-view mirror shows mostly such places. The grid's clusters belong to one view, so the pass would still need a grid of its own.
- B. Each camera view picks its own lamps and has its own light grid, buffers and bind groups. Chosen.
- C. B, with every view's lists packed into one buffer and one data texture, and each view's start in its uniform block. It saves the per-view objects. But it changes how every lit shader finds its lists, on both paths, for no gain in what draws.

How B works:

- The core's `LightTable::gather_view` picks the point and spot lights that a view sees. It tests them against the view's layers and frustum, and gives their positions relative to its camera. It shares its code with the camera's gather. The frame builder calls it for each view other than the camera's that draws in the frame, with the values that the view draws with. So a culled pass costs nothing (`LightGrids::assign` in `light_grid.rs`, through the light table in `FrameInput`).
- A view gets its grid on the first frame that it sees a light, with the camera's limits. It keeps the grid from then on, also for the next view in its place. A pass that sees no lamp makes no grid and no GPU object. With the default limits a grid takes about 0.5 MB of memory on WebGPU. On WebGL2 it also keeps the words it uploaded, for about 0.8 MB. On WebGPU its buffers take 0.34 MB more.
- WebGPU: each camera view has three buffer ids (grid, light records, parameters) and a bind group of the light clustering layout. The graph's one light clustering pass dispatches its three steps for each view with lights, so the graph keeps its shape. A view's frame group binds its own buffers once they exist. Before then it binds the camera's, which it never reads, as its grid's slices are 0. The fragment stage binds no more storage buffers than the camera's view does.
- WebGL2: each camera view has its own ring of three light data textures, sized to its lists, and its frame groups bind them. Before the view has a grid, its groups bind the camera's ring, which it never reads. The fragment stage binds no more textures than the camera's view does.
- The light clustering pass runs only for views that draw in the frame and have lights.

Shadows: the shadow maps' matrices, of the cascades and of the atlas's tiles, take positions relative to the camera of the camera's view. A pass that passed positions relative to its own camera would read every shadow at the offset between the two cameras. So the frame uniform holds that offset (`shadow_origin`, 16 bytes more), and the shadow lookups add it. The builder computes it from the cameras' cells in 64-bit floats. It is 0 in the camera's view. The `minimap-lamps` image test shows it. Its map camera stands 13 m above the main camera and 13 m further along its view. With the offset left out of the shadow lookups, 0.88% of the image's pixels change on the Mac's GPU in WebGPU, 0.91% in WebGL2 and 0.95% in compatibility mode, all inside the minimap. The spot light's pool in the map then lies mostly in a shadow that belongs elsewhere, and the boxes' shadows fall in the wrong places. The main view does not change.

The atlas's tiles go to the lamps that the camera sees, the largest first (`shadow_tiles.rs`). A lamp that the camera gave a tile casts its shadow in a pass from the same tile. A lamp that only a pass sees lights the pass without a shadow. Tiles of the passes' own would split the atlas's few tiles between the views. A tile would also draw again for each view that wants it. `api/render` and `guides/custom-passes` state the limit.

A reflection's view ([D-120](D-120-planar-reflections.md)) is a camera view like a scene pass's, so it gets the same pick of lamps and its own grid. Its grid's tiles come from its own matrix, which is the mirrored, oblique one that its shaders find their clusters with, so the clusters match. Its camera stands where the main camera stands, so its shadow offset is 0.

Tests:

- The core's `another_view_gathers_the_lights_it_sees_and_leaves_the_camera_s_lists_alone`.
- The render crate's scene pass tests on both paths. A lamp that only the pass sees lights the pass alone, and both paths list the same lights. Each WebGPU view with lamps fills its own grid. A pass that sees no lamp makes no grid. A pass reads the camera's tiles from its own camera.
- The no-allocation test with a moving lamp and a pass, on both paths.
- The `minimap-lamps` image test on all three tiers, in both reference sets, and `reflection-lamps`: a dark scene whose point light and spot light light the boxes and their reflections alike.

### Full-screen passes, half and quarter sizes, and the outline mask

Part 2 of M2-F6 holds full-screen passes of the sketch's WGSL, targets at half and a quarter of the size, the outline mask as a pass input, and effects that read pass textures (the open item of [D-71](D-71-custom-effects.md)). three.js ports need them for `EffectComposer` chains with render targets of their own, such as `OutlinePass`'s soft glow, which [D-36](D-36-outlines.md) puts in the `three-compat` add-on.

Questions and choices:

1. **What WGSL does a full-screen pass run?** The WGSL of a custom effect: `fn effect(input: EffectInput) -> vec4f`. One compiled shader serves both, so an author learns one function, and three.js's `ShaderPass` maps to both. The effect template has a last vector in its block, the output's size, which tells it that it draws a pass texture. Rejected: a function of its own, such as `fn pass(...)`. It would need a template, a plugin kind and types of its own, for the same shader.
2. **What does a pass read?** An input image (`input`): the scene color as the camera's passes leave it, before effects and bloom, or the outline mask, or nothing. `input.color`, `effectColor` and `effectPixel` read it, and `effectInputSize()` gives its size, which can differ from the pass's own. The scene's depth through the depth functions, as an effect reads it. And textures of its own: `var name: texture_2d<f32>;` and the `textures` option, as a custom material declares them ([D-47](D-47-custom-material-textures.md)). The build binds them in group 1, of the material maps' layout, on both paths, and their layers take the last floats of the 32 uniform floats. Effects take textures the same way. An effect with textures draws in a pass of its own: it never joins a group, and nothing folds it into the final pass, since the joined hosts have no group for textures.
3. **Where does a pass run?** A pass is a view without a camera (`View::fullscreen`), so it shares the views' names, kept target, pass textures, switching, `every`, removal and checks. Its graph pass is a full-screen pass that writes the view's kept target and reads the targets that its textures show. A pass that reads nothing of the camera's view runs while something shows or reads its texture, before the passes that do. A pass that reads the scene color, the outline mask or the depth runs after the camera's passes. Effects that bind its texture read it in the same frame. A material that shows it draws the frame before: the camera's passes do not read it, which would close a loop. While a texture shows such a pass and nothing reads it, the pass still runs, so that image stays one frame old. On the 8-bit path with MSAA a pass that reads the scene color switches the resolve pass for the final pass, since the resolve pass must be the scene color's only reader.
4. **Which way up?** A pass texture holds the image's bottom row first on both paths, as every pass texture does, so materials sample it as they sample a scene pass's. The shader writes it so: its place from the top is the texture's height minus the fragment's row, on both paths, with no copy. `input.uv` keeps the effects' convention, from 0 at the top left. `effectPassUv(uv)` turns a place into a pass texture's coordinates, for an effect or a pass that samples one.
5. **Sizes.** A pass takes a fixed `size` in pixels or a `scale` of 1, 0.5 or 0.25. Scene passes take `scale` too. A share follows the render size, and the pass fills its whole texture (`Size::Scaled`). The frame makes the texture again when the render scale changes, as it does for a reflection's texture ([D-120](D-120-planar-reflections.md)), and the pass draws into the new texture in the same frame. So a material samples the texture from 0 to 1 across, with no corner of the render scale, and the pass costs less when the engine lowers the render scale to keep up. Rejected: a share of the render size drawn into the top-left corner of a texture of the canvas's size, as the scene's own targets are. Every material and effect that samples such a texture would then need the render scale's corner, and the texels outside it would bleed into a linear filter: with that layout the floor of `reflection-scale-50` shows black at a render scale of 0.5. Rejected too: a share of the canvas's size. It never makes a texture again, but a pass keeps its full cost while the render scale drops. The coordinator chose the render size for reflections, to keep that saving, and passes follow the same rule.
6. **The outline mask.** `input: 'outlineMask'` reads the mask that [D-36](D-36-outlines.md) draws: red holds the outlined objects' coverage, green the parts that nothing hides. The mask draws only while outlines are on and some object is outlined; otherwise the pass reads transparent black. `post.set({ outline: { width: 0 } })` draws the mask without the crisp line, for a glow of the sketch's own.
7. **Background and ambient occlusion in scene passes.** A scene pass draws the scene's background, sky included, unless it has a `clearColor` of its own, as a three.js render target shows `scene.background`. The security camera demo's monitor shows the night sky. Ambient occlusion stays out of every pass, by design: three.js draws ambient occlusion as a post pass of the composer, over the canvas, so a render target of another camera has none. A pass would need its own depth prepass and three more passes at half size.

Costs and limits:

- A pass costs one triangle over its texture, plus what its WGSL reads: the same work as an effect's pass of that size. [D-71](D-71-custom-effects.md) measured one effect pass over the whole canvas at about 0.05 ms of GPU time on the Mac and 0.1 ms on the owner's iPad. A pass at half the size each way shades a quarter of the pixels.
- A pass's uniforms change with `render.setPassUniform`, which allocates nothing. Its textures are fixed when it is added.
- Full-screen passes count toward the 31 passes that draw at once.

Tests:

- The shader build: an effect with textures builds for both paths, loads its layers, draws alone and has no pieces; a full row of uniforms leaves no room for a texture.
- The render crate: a pass fills a share of the render size at a lower render scale, culls nothing, runs before the camera that shows it, and is culled while nothing shows it; a pass that reads the scene color runs after the camera's passes and before the effect that reads it, and the 8-bit path's final pass takes the resolve pass's place.
- TypeScript: `render.addPass` sends a pass's template, size, input, uniforms and textures, and refuses options that it does not take; an effect with textures draws alone and folds nothing.
- The image tests `fullscreen-passes`, `fullscreen-glow` and `fullscreen-echo` on all three tiers, in both reference sets.

### Display color on the 8-bit path

The 8-bit path serves compatibility mode with MSAA, and WebGL2 devices whose float targets fail. There each scene shader tone maps its own color and encodes it as sRGB, so a view draws display color. Stored in the pass texture as it is, that color reaches a material as encoded values. The material takes them for linear color, then tone maps and encodes them again. On Chrome on the Mac's GPU, the minimap's gray ground then shows at about 207 to 210 of 255 in compatibility mode, against 157 to 168 on core WebGPU. Its red box shows at (228, 167, 163) against (218, 72, 70). The map looks pale and washed out, far from what the author drew.

Options:

- A. Keep it as a documented limit.
- B. On WebGPU, decode the color back in the copy that already turns each image upright, into an sRGB texture. The copy's TONE_MAP build writes the decoded color, and the sRGB texture encodes it again as it stores it, so the texture keeps the image's bytes, and materials that sample it read linear color. This costs no new pass and no new texture. WebGL2 has no copy, so its 8-bit devices keep the limit.
- C. Draw the views of the 8-bit path without the tone curve: a second pipeline for each material that a pass draws. It is exact, but every such material builds an extra shader on first use, on the weakest devices that take this path.

The coordinator chose B, and the owner confirmed it. With B, the same picture gives the ground at 173 to 183 and the red box at (227, 78, 72). The remaining difference is the tone curve, which the material that shows the texture applies a second time to color that is already tone mapped. With the default ACES curve, a mid gray of 0.5 comes out at about 0.62; with `toneMapping: 'none'`, nothing changes. WebGL2 devices without float targets store display color, which a material shows washed out, as above. Those devices are rare, since nearly every WebGL2 device passes the engine's float target test.

## Consequences

- Code: `crates/null3d-render/src/graph.rs` and `graph/compile.rs` (culling, the color budget, kept targets that resolve without storing their samples), `frame_graph.rs` (views' targets, copies, reads, clear colors), `view.rs`, `view_copy.rs`, `textures.rs` (pass arrays), both builders (hidden buckets), `crates/null3d-wasm/src/lib.rs` (`addPass`, `removeScenePass`, `setScenePassEnabled`, `createPassTexture`, `renderGraphMessage`, `renderGraphDot`), `packages/engine/src/scene/render.ts` and `textures.ts` (`fromPass`), and the WebGPU backend's layout and template.
- The 8-bit copy: `view_copy.wgsl` has a TONE_MAP build, and the pass targets that WebGPU's copies fill are `rgba8unorm-srgb` on the 8-bit path (`view_target_format` in `frame_graph.rs`).
- Docs: `api/render`, `guides/custom-passes` (render to a texture), `concepts/render-graph`, `api/textures`, the mapping entry `render-target`, E1220 and the fixes of E1502 to E1505.
- Skills: the develop skill's quick reference, recipes, shaders and `SKILL.md`, and the port skill's post-processing notes.
- Lights in passes: `null3d-core/src/lights.rs` (`gather_view`), `light_grid.rs` (`LightGrids`, `ViewLights`), both builders and their `lights.rs`, `frame_data.rs` and `globals.wgsl` (`shadow_origin`), and `lit.wgsl` and `lib/lights.wgsl` (shadow lookups).
- Demo: `examples/security-camera` shows a scene pass on a monitor, and its held frame checks option B's colors in compatibility mode against the tone curve applied twice ([image tests](../image-tests.md#the-feature-demos)).
