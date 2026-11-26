# porting-shaders-readability-18

## Finding as given

- Page: porting/threejs-postprocessing
- Anchor: ## Passes that become settings, rows OutlinePass (line 63), ShaderPass(VignetteShader) (line 65), SharpenNode (line 68), BokehPass (line 69)
- Category: technical-details-block
- Severity: medium
- Claim: These Notes cells run 60 to 110 words and mix the mapping (which option becomes which) with derivations (FSR 1's RCAS, the 2^-sharpness formula, why corners darken). The table becomes hard to scan.
- Evidence: threejs-postprocessing.md lines 63, 65, 68, 69.
- Proposed edit: Keep in each cell only the renames and the one number to set, such as "`sharpen: 0.87` for three.js's default of 0.2". Move the explanations under the table into a technical details block, "Technical details: matching outlines, vignettes, sharpening and depth of field", one bullet per pass.

Verdict: partly

## Evidence

- The word counts are wrong. The Notes cells hold about 63 words (OutlinePass, line 63), 42 (VignetteShader, line 65), 72 (SharpenNode, line 68) and 57 (BokehPass, line 69). None is near 110, and the vignette cell is short.
- Most of what the finding calls a derivation is the mapping itself:
  - Line 68: the `2^-sharpness` rule is how a reader turns three.js's value into `sharpen`. Without it the cell gives one example value and no way to convert any other value.
  - Line 69: "`maxblur` is a share of the canvas's width, and `maxBlur` of its height: multiply by the aspect ratio" is a conversion step. "null3D's `aperture` is an f-number ... pick one by eye, such as 2.8" tells the reader what value to set.
  - Line 65: "bright corners darken instead of turning gray" and "three.js also lifts dark corners toward a gray, and null3D does not" are visible differences that a porter checks side by side. They are not internal detail. The vignette cell is already short and should stay as it is.
- Some sentences really are background a porter can skip:
  - Line 68: "Both sharpen display color with FSR 1's RCAS in the final pass, so the port needs no render target and no pass of its own", and the note that null3D damps sharpening on noise.
  - Line 69: "null3D blurs the near and far fields apart, so sharp objects spread no halo."
- Line 63 says the same thing twice: "`visibleEdgeColor` becomes `color`, `hiddenEdgeColor` becomes `hiddenColor`" and then "The visible and hidden colors become `color` and `hiddenColor`." That repeat is the clearest cost in the cell.
- The full detail already lives in the linked mapping page: docs/porting/threejs-mapping.md lines 258 (SharpenNode), 259 (OutlinePass), 260 (BokehPass) and 265 (VignetteShader). That page is generated from docs/data/threejs-mapping.json. Line 89 of this page links to it, but it names only "bloom, ambient occlusion and outlines".

## Corrected claim

The OutlinePass, SharpenNode and BokehPass Notes cells (about 57 to 72 words) mix the steps a porter must follow with some background on how null3D draws the effect. The OutlinePass cell also says the color renames twice. The VignetteShader cell (42 words) is short, and everything in it is a mapping or a visible difference, so it can stay as it is.

## Corrected edit

- Line 63 (OutlinePass): delete the repeated last sentence, "The visible and hidden colors become `color` and `hiddenColor`."
- Line 68 (SharpenNode): keep the `2^-sharpness` rule and the example (`sharpen: 0.87` for three.js's 0.2), because the reader needs them to convert values. Move the RCAS and final-pass sentence and the noise-damping sentence out of the cell.
- Line 69 (BokehPass): keep the renames, the f-number advice and the aspect-ratio step. Move the near and far fields sentence out of the cell.
- Line 65 (VignetteShader): no change.
- Put the moved sentences in one block directly under the table, one bullet per pass:

  <details>
  <summary>Technical details: sharpening and depth of field</summary>

  - Sharpening: both engines sharpen display color with FSR 1's RCAS in the final pass, so the port needs no render target and no pass of its own. null3D softens the sharpening where the ring around a pixel is noise. three.js does this only with `denoise: true`.
  - Depth of field: null3D blurs the near and far fields apart, so sharp objects spread no halo into a blurred background.

  </details>

- On line 89, make the link to the mapping page name sharpening, vignettes and depth of field as well as bloom, ambient occlusion and outlines, so readers know where the full notes are.
- The page is hand-written. It has no generated source.
