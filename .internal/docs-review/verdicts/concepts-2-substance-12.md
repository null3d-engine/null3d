# concepts-2-substance-12

## Finding as given

- page: concepts/render-graph, concepts/post-processing, concepts/quality-presets
- anchor: render-graph lines 37, 65-66, 80; post-processing lines 58-72; quality-presets line 287
- category: duplication; severity: medium
- claim: Three pages each explain when the final pass runs, when the resolve pass replaces it, and when the final pass splits in two. The render-graph table row lists the final pass's conditions as if all must hold, but they are alternatives. Line 37 ("So it does in the FXAA and no anti-aliasing modes") is hard to parse. quality-presets 287 packs hold mode, the 8-bit paths, the two steps and sharpening into 176 words.
- proposedEdit: Keep the full rule in post-processing "Below the whole canvas's render scale". Render-graph row: "Runs when any of these holds: the scene draws HDR color; the anti-aliasing is FXAA or none; the render scale can drop below 1; an effect needs it." Line 37: "The final pass takes the scene color to the canvas, except on the 8-bit path with MSAA, where the resolve pass does it." Cut quality-presets 287 to two sentences and a link.

Verdict: partly

## Evidence

- The table-row bug is real. render-graph.md:66 reads "on the HDR path, with FXAA or no anti-aliasing, while the render scale can drop below 1, and while an effect needs it", which reads as AND. The code is an OR: crates/null3d-render/src/frame_graph.rs:2176-2186, `final_runs()` returns `!self.resolves || self.scales || self.grades || self.sharpen.is_some() || self.fullscreen_reads_color || self.mask_draws() || self.transmission_declared || self.moment_smaa_declared || self.particle_depth_declared`. The resolve row (line 65) is a correct AND and needs no change.
- Line 37 is hard to parse, as claimed ("So it does in the FXAA and no anti-aliasing modes").
- The proposed line-37 rewrite is wrong. "except on the 8-bit path with MSAA, where the resolve pass does it" says the resolve pass always runs there. Per frame_graph.rs:2176 and color-management.md:67, the final pass still runs on that path while the scale can drop below 1 (Low and Medium allow it) or an effect needs it.
- The duplication claim is partly wrong. post-processing.md:58-72 explains only the two-step split. It never says when the resolve pass replaces the final pass. The full resolve rule, with the list of effects that need the final pass, is in color-management.md:67, a fourth page the finding does not name. render-graph.md:80 already links there for the list. So post-processing is not the right home for "the full rule". The split belongs in post-processing, and the resolve rule belongs in color-management.
- quality-presets.md:287 (176 words) does repeat the split and the 8-bit rule. But its first two sentences (minRenderScale 1 keeps the whole canvas; hold mode draws at maxRenderScale) are unique to that page and on topic. A cut to "two sentences and a link" must keep them, and it must keep the cost note that a low scale on the 8-bit MSAA path adds a pass, because that note helps the reader choose minRenderScale.

## Corrected claim

The final pass's run rule is spread over four pages: render-graph (37, 65-66, 80), color-management (67), post-processing (58-72, the split only) and quality-presets (287). The render-graph table row states OR conditions as AND. Line 37 is hard to parse. quality-presets 287 repeats detail that post-processing and color-management own.

## Corrected edit

- render-graph.md:66 (Final pass row, "Kind" cell): "Fullscreen. Runs when any of these holds: the scene draws HDR color; the anti-aliasing is FXAA or none; the render scale can drop below 1; an effect needs it."
- render-graph.md:37: replace the last three sentences with "The final pass takes the scene color to the canvas. On the 8-bit path with MSAA, the resolve pass can take its place, along the dotted arrows, and shares the opaque and transparent passes' render pass. The last paragraph of this section says when."
- render-graph.md:80: keep it, and keep its link to color-management for the effect list. Treat color-management.md:67 as the home of the resolve rule, and post-processing "Below the whole canvas's render scale" as the home of the split.
- quality-presets.md:287: keep the first two sentences (minRenderScale 1, hold mode). Then: "On the 8-bit path with MSAA, a lowest scale below 1 also adds the final pass, and below scale 1 that pass runs in two steps. [The post-processing chain](post-processing.md#below-the-whole-canvass-render-scale) describes both steps, their two costs, and why `sharpen` keeps them at every scale." That drops the FXAA, GSR 1 and sharpening detail, which post-processing already covers.
