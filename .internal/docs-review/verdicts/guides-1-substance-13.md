# guides-1-substance-13

## Finding as given

- Page: guides/custom-passes
- Anchor: ### Cost (lines 213-224)
- Category: technical-details-block
- Severity: medium
- Claim: Ten bullets of joining, folding, background compiles and precision detail. 'The render scale cannot drop below the whole canvas' is never explained. A reader who wants the cost of one effect must read all of it.
- Evidence: docs/guides/custom-passes.md:215-224; docs/concepts/post-processing.md#below-the-whole-canvass-render-scale.
- Proposed edit: Keep three bullets: per-pass cost with device figures; effects that read only their own pixel join into one pass; add effects before the first frame. Put the rest in a 'Technical details: how the engine joins and folds effects' block, with one sentence on dynamic render scale and a link.
- Generated source: none (hand-written page)

Verdict: partly

## Evidence

- docs/guides/custom-passes.md:213-224 holds ten bullets under "Cost". Lines 216-221 are dense detail about joining, folding, background builds, browsers without background WebGL2 compiles and 32-bit precision. That detail suits a collapsible block. This part of the finding holds.
- "Never explained" is too strong. The page does not explain the phrase, and it never names the setting `minRenderScale` (a search of the page finds neither "minRenderScale" nor "dynamic"). But the same bullet (line 216) links to docs/concepts/post-processing.md#below-the-whole-canvass-render-scale. That section (post-processing.md:58-72) explains the two-step final pass and gives `quality.set({ minRenderScale: 1 })` as the way to keep the scale at the whole canvas.
- The proposed edit would mislead. Effects join, and the last one folds into the final pass, only while the render scale cannot drop below 1 (custom-passes.md:216, 218; post-processing.md:217). The default presets let it drop: packages/engine/src/quality/presets.ts:78-82 sets the lowest render scale per preset to 0.5, 0.6, 0.75 and 1, so only the top preset keeps 1. post-processing.md:60 says "which the default presets allow". So with the default settings, each effect draws a pass of its own. A kept main-text bullet that says "effects that read only their own pixel join into one pass", with the condition moved into the block, is false for most sketches. This breaks the block rule that the main text must make sense with every block closed.
- The kept "add effects before the first frame" bullet applies only to browsers that cannot compile WebGL2 shaders in the background (line 220). As a bare main-text rule it loses that scope.

## Corrected claim

The Cost section is dense, and most of the joining and folding detail can go into a block. The page does not explain what "the render scale cannot drop below the whole canvas" means for the reader or name the setting, but it links to the explanation. The condition is not a side detail: with the default presets the scale can drop, so effects do not join or fold. The main text must say this.

## Corrected edit

Keep these in the main text:

1. The per-pass cost bullet with the device figures (line 215).
2. One bullet with the condition stated: "The engine can join effects that read only their own pixel into one pass, and fold the last into the final pass. It does this only while the render scale stays at the whole canvas, which `quality.set({ minRenderScale: 1 })` keeps. The default presets below the top one let the scale drop, so there each effect draws a pass of its own ([The post-processing chain](../concepts/post-processing.md#below-the-whole-canvass-render-scale))."
3. The bullet that a new effect shows a few frames after `addEffect` (line 224). It changes what a reader sees.

Move lines 216-223 (pixel reads that start a pass, the fold rule with bloom and FXAA, background builds, the WebGL2 browsers and the advice to add effects before the first frame there, 32-bit precision, the two shared targets, depth reads) into:

<details>
<summary>Technical details: how the engine joins and folds effects</summary>

(bullets from lines 216-223, without the scale condition that is now in the main text)

</details>
