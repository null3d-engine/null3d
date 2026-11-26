# concepts-2-substance-05

## Finding as given

- Page: concepts/post-processing
- Anchor: Diagram line 27 ("then the vignette, FXAA and tone mapping"); line 219 ("after bloom and before FXAA and dithering")
- Category: contradiction. Severity: medium.
- Claim: The text at lines 37 and 164, the API page and the shader run FXAA first, then the vignette and the tone curve. The diagram puts FXAA after the vignette. Line 219 says a custom tone curve runs before FXAA, which is wrong.
- Evidence: crates/null3d-shaders/wgsl/final.wgsl:1-3, 753-771; docs/api/post.md:109.
- Proposed edit: Diagram node: "Final pass: FXAA, then bloom and the adapted exposure, the vignette and tone mapping". Line 219: "The final pass calls it in place of the built-in curve, after FXAA, bloom and the vignette, and before the outline, the grading table and the dither."

Verdict: partly

## Evidence

- Page line 27 (diagram): "blends in bloom, applies the adapted exposure, then the vignette, FXAA and tone mapping". FXAA is placed after the vignette.
- Page line 37: "It smooths edges with FXAA, adds the effects' results, darkens the edges with the vignette and applies the tone mapping curve". Page line 164: exposure multiplies the color "before FXAA, the vignette and the tone curve". docs/api/post.md:109 says the same.
- Page line 219: the custom curve runs "after bloom and before FXAA and dithering". Wrong about FXAA.
- Shader, final.wgsl:755-771: `display(shaded(with_glow(pixel_color(...), light), shade), ...)`. So the order is: `pixel_color` (FXAA in the FXAA build, :529-555) -> `with_glow` (bloom, :248-257) -> `shaded` (vignette, :443-445) -> `display` (tone curve, custom curve at :581-582, then sRGB) -> `finish` (grading table, dither, :594-621). The outline line is drawn on display color after the tone curve (comment :38-42; page line 37).
- The adapted exposure is applied before FXAA: `scene_texel` multiplies each texel by the exposure factor (:451-454), and `glow` multiplies bloom's glow by it (:242). Header comment :61-63: "FXAA, the vignette and the tone mapping then see the adapted color."
- The two-step path (below the whole canvas's scale) runs FXAA in the first step too (header :9-11), so the tone curve still follows FXAA there.

So the contradiction is real on both lines. The line 219 edit is correct. The proposed diagram text is partly wrong: "FXAA, then bloom and the adapted exposure" says the exposure comes after FXAA. That contradicts line 164, the API page and the shader, where the exposure scales the scene color before FXAA.

## Corrected claim

The diagram (line 27) puts FXAA after the vignette, and line 219 puts the custom tone curve before FXAA. The shader runs: adapted exposure on the scene color, FXAA, bloom's glow (also scaled by the exposure), the vignette, the tone curve, sRGB, then the outline's line, the grading table and the dither. Both lines contradict the page's own text at 37 and 164 and the API page.

## Corrected edit

- Diagram node (line 27): `final["Final pass: applies the adapted exposure,<br/>smooths edges with FXAA,<br/>blends in bloom, then<br/>the vignette and tone mapping"]`
- Line 219: "The final pass calls it in place of the built-in curve, after FXAA, bloom and the vignette, and before the outline, the grading table and the dither." (as proposed)
