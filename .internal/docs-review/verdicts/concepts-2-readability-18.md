# concepts-2-readability-18

## Finding as given

- page: concepts/post-processing
- anchor: "## Below the whole canvas's render scale (lines 58-72)"
- category: scan-order, severity: medium
- claim: The second H2, before any effect is introduced, explains an 8-bit intermediate target, GSR 1's green-channel edge vote with twelve-texel weights, and an 8-bit rounding difference. It is an edge case of the final pass. Line 60 'exactly as before the split' reads like a change log.
- evidence: Lines 60, 62, 63, 72.
- proposedEdit: Move it to just before 'Effects on devices without HDR color'. Main text: 'While the render scale can drop below 1, the final pass runs in two steps: tone map at render size, then upscale with GSR 1. This costs one 8-bit canvas-size target and stops custom effects joining passes. quality.set({ minRenderScale: 1 }) avoids both.' Put list items 1-2 and line 72 in <details><summary>Technical details: the two steps and the upscaler</summary>. Remove 'exactly as before the split'.

Verdict: partly

## Evidence

- The page matches the description. Line 58 is the second H2, before Bloom (line 74). Line 63 gives the green-channel vote, the twelve texels and the bounded correction. Line 72 gives the 8-bit rounding difference. Line 60 ends with "one pass does that work, exactly as before the split". The phrase reads like a history note, so removing it is right.
- "Edge case" is wrong. In packages/engine/src/quality/presets.ts:78-81, `minRenderScale` has the preset values [0.5, 0.6, 0.75, 1] (Low, Medium, High, Ultra). Only Ultra keeps the scale at 1. On Low, Medium and High, the two-step final pass is the default path. Line 60 says this too ("which the default presets allow"). Phones run Low.
- The move is not needed and makes things worse. The overview at line 37 explains the one-pass final pass and then links to this section. The section also explains why custom effects stop joining into fewer passes. Line 217 (custom effects cost) and lines 377-378 (sharpening) point back to it. The behavior is the default on most presets, so it belongs near the start. Moving it to the end of the page puts it after every section that depends on it. The scan-order cost comes from the dense upscaler detail, and a collapsible block fixes that.
- Problems with the proposed main text: (1) It drops the link to Dynamic resolution and the fact that the default presets allow the lower scale. (2) It puts "GSR 1" in the main text without saying what it is, which is jargon for a newcomer. (3) It does not say whether line 65 (`sharpen` also starts the two steps) stays. Line 65 must stay in the main text, because the Sharpening section (line 378) depends on it.
- Keeping list items 1-2 and line 72 in a `<details>` block is right. The block has no headings and no nested blocks, and the main text still makes sense with the block closed.

## Corrected claim

The section puts dense upscaler internals (the edge vote, the twelve texels, the 8-bit rounding) near the top of the page, and "exactly as before the split" reads like a change log. But the section describes the default final pass on the Low, Medium and High presets, so it is not an edge case. Its position after the overview, which links to it, is right.

## Corrected edit

Keep the H2 where it is. Replace line 60 with:

"The engine can draw the scene at a lower scale than the canvas, then scale the image up, to hold a frame rate on a slow GPU ([Dynamic resolution](quality-presets.md#dynamic-resolution)). While the render scale can drop below 1, as it can on the Low, Medium and High presets, the final pass runs in two steps. The first step tone maps the image at the render size into an 8-bit target. The second step scales that target up to the canvas with an upscaler that keeps edges sharp, then draws the outline's line, applies the color grading table and dithers. While the scale cannot drop below 1, one pass does all of this work."

Keep line 65 (`sharpen`) and lines 67-70 (the two costs and `quality.set({ minRenderScale: 1 })`) in the main text. Move list items 1-2 (lines 62-63) and line 72 into:

<details>
<summary>Technical details: the two steps and the upscaler</summary>

(lines 62-63 as a numbered list, then line 72)

</details>
