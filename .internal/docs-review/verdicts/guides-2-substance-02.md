# guides-2-substance-02

Finding as given:

- page: guides/phones
- anchor: ## Render scale, line 57: 'The scaling also takes the place of FXAA, which Low uses to smooth edges.'
- category: wrong-claim
- severity: high
- claim: A lower render scale does not replace FXAA. Below the whole canvas's scale, the final pass's first step still smooths edges with FXAA at the render size, then a second step upscales.
- evidence: crates/null3d-shaders/wgsl/final.wgsl:9-11; crates/null3d-render/src/final_pass.rs:1-8; docs/concepts/quality-presets.md:287
- proposedEdit: Replace the sentence with: 'Below a scale of 1, the final pass still smooths edges with FXAA at the render size, then scales the image up to the canvas.'

Verdict: survives

Evidence:

- docs/guides/phones.md:57 says the scaling "takes the place of FXAA". That tells a reader that FXAA stops on Low when the scale drops.
- crates/null3d-render/src/frame_graph.rs:1608 builds the first step as `FinalPass::new(ids.output_pass, scene_color, antialias).resolve()`. It takes the same anti-aliasing mode as the full-scale pass, so on Low it is the FXAA build.
- crates/null3d-shaders/wgsl/final.wgsl:9-11 says the RESOLVE build draws at the render size "with FXAA". At lines 723-752, `size` is the render size when the pass resolves, so `whole` is true and the `#ifdef FXAA` branch runs.
- crates/null3d-render/src/final_pass.rs:800-806 tests the first step with `Antialias::Fxaa` and `.resolve()`.
- docs/concepts/quality-presets.md:287 and docs/concepts/post-processing.md:62 both say the first step smooths edges with FXAA. So the phones page contradicts two linked concept pages.
- No code path drops FXAA because the scale drops. The only documented skip is while a still view blends (post-processing.md:396), which is a different case.

Severity high is fair: a reader could add their own edge smoothing or expect jagged edges, and the two pages disagree.

Suggested edit (a small change to the proposed one, to keep the link to Low and say how the image is scaled up):
"On Low, the final pass still smooths edges with FXAA at the render size, and then scales the image up to the canvas with an edge-aware upscaler."
