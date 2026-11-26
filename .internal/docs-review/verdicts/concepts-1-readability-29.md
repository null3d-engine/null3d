# concepts-1-readability-29

## Finding as given

- page: concepts/color-management
- anchor: lines 25, 63, 67, 77, 104, 110
- category: long-paragraph, severity: medium
- claim: Six long paragraphs. Line 63 (125 words) describes the final pass as a sequence in prose. Line 67 (152 words) lists about 12 effects that force the final pass inside sentences. Lines 110 and 112 give the same advice twice.
- evidence: stats.json concepts/color-management longParagraphs
- proposedEdit: 63: numbered steps (FXAA in that mode; vignette; exposure and tone mapping; color grading; sRGB encode; dither), then one sentence on the two-step split with its link. 67: keep 3 sentences, then 'These effects need the final pass:' as a bullet list. 77: keep 2 sentences, and move the mask and blended-surface rule into a block 'Technical details: how each path keeps the display color'. Split 25 and 104. Give the toneMapping 'none' at exposure 1 advice once, after both kinds of background.

Verdict: partly

## Evidence

- The six long paragraphs are facts from stats.json (stats lines 18, 56, 60, 70, 97, 103 are file lines 25, 63, 67, 77, 104, 110 after the front matter). The problem is real.
- Line 67 lists 10 effects, not about 12: color grading, sharpening, outlines, transmission, screen-space reflections, bounce light, soft particles, a material that reads depth, the moment transparency layer, and a full-screen pass that reads the scene color. A bullet list is still right.
- Lines 110 and 112 do repeat "use toneMapping 'none' at an exposure of 1". Merging is fine, but line 110 also offers a transparent canvas over a CSS background. That option fits only a plain color, not a background texture, so the merged text must keep it tied to the color case.
- The proposed step order for line 63 is wrong in two places. Checked in crates/null3d-shaders/wgsl/final.wgsl:
  - Color grading runs after the sRGB encode, on display color, then the dither. See the header comment at lines 66-71 ("grades each pixel's display color ... as three.js's LUTPass does after its OutputPass, then dithers it"), `display()` at lines 570-595 (tone map, then `linear_to_srgb`), and `finish()` at lines 600-625 (grading table, then dither). The page text (line 63) gets this right: "It then encodes the result as sRGB. Last, after any color grading table, it adds ... dithering." The proposed list puts grading before the encode.
  - Exposure is not a final-pass step. The scene color already holds exposed color (final.wgsl line 2, "which holds exposed color"), and page line 104 says the engine applies exposure as each light and color enter the scene. Only automatic exposure multiplies in the final pass (final.wgsl lines 61-64). A step named "exposure and tone mapping" contradicts line 104.
- Line 77: if only the first 2 sentences stay, the main text says the HDR path tone maps the whole image once and then stops. A reader with the block closed would think `toneMapped: false` does nothing on the HDR path. The blended-surface limit and its fix (`createEngine({ hdr: false })`) is a user-facing gotcha, not implementation detail. It belongs in the main text. Only the mechanism (the mask, and why it cannot mark a blended pixel) fits a block.
- Splits for lines 25 and 104 are fine. Line 104 has a clean break after "one stop darker."

## Corrected claim

Six long paragraphs. Line 63 describes the final pass as a sequence in prose. Line 67 lists 10 effects that need the final pass inside sentences. Lines 110 and 112 give the same advice twice.

## Corrected edit

- 63: numbered steps in the order the shader runs them:
  1. In the FXAA mode, smooth the edges.
  2. Darken the edges by the vignette, when the sketch sets one.
  3. Apply the tone mapping to the exposed color (with automatic exposure, the adapted exposure first).
  4. Encode as sRGB.
  5. Apply any color grading table.
  6. Add the dither, so smooth gradients show no bands.
  Then one sentence on the one triangle, and one on the two-step split below the whole canvas's scale, with its link.
- 67: keep the first 3 sentences, then "With MSAA that target can resolve straight into the canvas, with no final pass, while the render scale cannot drop below 1 and no effect needs the final pass. These effects need it:" and a bullet list of the 10 effects. Then the vignette, Low/Medium and FXAA sentences.
- 77: main text: "The 8-bit path honours it in each material's own shader. The HDR path honours it in its final pass, for surfaces that do not blend. A blended surface still takes the tone curve on the HDR path. If it needs the exact color, use the 8-bit path with `createEngine({ hdr: false })`." Then the link. Block "Technical details: how each path keeps the display color": the 8-bit shader encodes the color without the curve; the final pass reads a mask of the marked surfaces and skips the curve there; a blended pixel mixes two surfaces, so the mask cannot say which one owns it.
- 25 and 104: split as proposed.
- 110/112: describe both backgrounds (color and texture) first, then give "use toneMapping 'none' at an exposure of 1" once. Keep the transparent canvas over a CSS background as the other option for a plain page color only.
