# concepts-2-substance-04

## Finding as given

```json
{
 "page": "concepts/post-processing",
 "anchor": "## Below the whole canvas's render scale, lines 62-63",
 "category": "contradiction",
 "severity": "medium",
 "claim": "Step 1 and step 2 both darken the edges with the vignette. Line 364 says the vignette works on HDR color before the tone curve, which only step 1 holds. A reader cannot tell whether the picture is darkened once or twice below scale 1. The code sets the vignette flag for both steps, and the upscale build darkens display color as well. So either the step 2 text is wrong or the code darkens twice.",
 "evidence": "docs/concepts/post-processing.md:62, 63, 364; crates/null3d-render/src/final_pass.rs:459-476 (settings() adds VIGNETTE for any flags), 406-411 and 438 (both steps call it); crates/null3d-shaders/wgsl/final.wgsl:638-647, 740 (shade applied in corner_display).",
 "proposedEdit": "Check with the lut-vignette-scale-50 image test and a strong vignette. If the vignette applies once, delete \"darkens the edges with the vignette\" from step 2. If it applies twice, clear the flag in the second step's settings and keep step 1's text.",
 "generatedSource": "",
 "id": "concepts-2-substance-04",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page contradiction is real. docs/concepts/post-processing.md:62 (step 1) and :63 (step 2) both say the step "darkens the edges with the vignette". Line 364 says the vignette multiplies HDR color before the tone mapping, which only step 1 holds.
- The claim about the code is wrong. final_pass.rs:473-476 sets the vignette flag only when the inputs carry a vignette; it does not add it "for any flags". The two steps get different inputs. crates/null3d-render/src/frame_graph.rs:5471-5477 gives the first step `grading.vignette.filter(|_| hdr)`, and :5492-5498 gives the second step `grading.vignette.filter(|_| !hdr)`. At most one step gets it.
- In practice the second step never gets it. The `grading` value comes from frame.rs:2576-2589 (`grading()`), whose vignette is `final_vignette()`, and frame.rs:2554-2556 returns `None` on the 8-bit path. So on the HDR path only step 1 darkens. On the 8-bit path neither step does: the scene shaders apply it before their tone mapping (frame.rs:2560-2563, `scene_vignette`). final.wgsl:432-440 confirms this: the factor is 1 while the flag is clear.
- The picture is darkened once, never twice. No image test is needed to decide this, and the code needs no change.

## Corrected claim

Lines 62 and 63 both say the step darkens the edges with the vignette, but the engine darkens them only once. On the HDR path the first step does it, before the tone curve (frame_graph.rs:5471-5498). The second step never gets the vignette. On the 8-bit path the scene shaders apply it. Step 2's text is wrong; the code is right.

## Corrected edit

On line 63, delete ", darkens the edges with the vignette". The sentence becomes: "Then the pass sharpens the display color while the sketch asks for it ([Sharpening](#sharpening)), draws the outline's line, applies the color grading table, when the sketch sets one, and dithers." Make no code change and run no image test. (An internal comment at frame_graph.rs:5466-5469 says the second step darkens display color. That is wrong too, but it is not part of the docs.)
