# concepts-2-readability-03

## Finding as given

- page: concepts/post-processing
- anchor: line 37 'Ambient occlusion and screen-space reflections run before the scene's opaque objects shade.'
- category: wall-of-text
- severity: high
- claim: The first paragraph after the diagram is 226 words and 12 sentences. It walks the whole chain in prose, from prepass to dither, with three links. A newcomer cannot hold the order, and the diagram already shows it.
- evidence: stats.json concepts/post-processing longParagraphs line 30: 226 words, 12 sentences.
- proposedEdit: Replace it with two short sentences ('Each frame draws the scene into an HDR target, runs the effects on it, then one final pass turns it into the canvas's colors.') and a 5-item numbered list: 1 before shading (prepass, AO, SSR); 2 scene passes into exposed linear HDR; 3 HDR effects in order (fog, custom effects, DOF, bloom); 4 final pass (FXAA, bloom blend, vignette, AgX tone curve, sRGB); 5 same pass (outline, grading table, dither). Keep line 39 after the list.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- The paragraph is docs/concepts/post-processing.md line 37 (stats.json counts body lines without the 7-line front matter, so its line 30 is the same paragraph). 226 words and 12 sentences are facts. It does walk the chain from the prepass to the dither, with three links (lighting.md#volumetric-fog, color-management.md#exposure-and-tone-mapping, #below-the-whole-canvass-render-scale). The wall-of-text claim holds, and a numbered list is the right shape.
- "The diagram already shows it" is only partly true. The paragraph holds facts the diagram does not: the opaque pass darkens its ambient light with the occlusion and reflects the frame before's colors; the exposure scales each light as it enters the scene, so the scene color holds exposed color (the diagram's final node says the final pass "applies the adapted exposure", which reads differently); AgX punchy is the default and keeps the hues of bright colors. These must stay, in the list or in a details block.
- The proposed opening sentence is wrong for most presets. It says "one final pass turns it into the canvas's colors". The page itself (line 60) says the final pass runs in two steps while the render scale can drop below 1, "which the default presets allow". packages/engine/src/quality/presets.ts:78-81 sets minRenderScale presets to [0.5, 0.6, 0.75, 1], so three of four presets use the two-step path. The original paragraph scopes "one pass" with "while the render scale cannot drop below the whole canvas" and links to the split section. The proposal drops that scope and does not say to keep the link.
- The proposal does not say where the three links go. Dropping them would lose the routes to fog, tone curves and the split.

## Corrected claim

The paragraph is a 226-word, 12-sentence wall that a list would make easier to follow. The diagram shows the order, but not every fact in the paragraph, and the one-pass description holds only while the render scale cannot drop below 1, which is not the default for most presets.

## Corrected edit

Replace line 37 with:

Each frame draws the scene into a linear HDR target, runs the effects that need that range, then turns the result into the canvas's colors in a final pass. The steps, in order:

1. Before the opaque objects shade, the depth prepass draws depth. Ambient occlusion and screen-space reflections read it.
2. The scene passes draw linear color with no upper limit into a float target, the scene color. The exposure scales each light and color as it enters, so the scene color holds exposed color. The opaque pass darkens its ambient light with the occlusion and reflects the frame before's colors where the reflections' rays hit.
3. The HDR effects read the scene color in this order: the volumetric fog's light ([Lighting and environment](lighting.md#volumetric-fog)), custom effects, depth of field, then bloom.
4. The final pass smooths edges with FXAA, adds the effects' results, darkens the edges with the vignette and applies the tone curve: AgX with a punchy look by default, which keeps the hues of bright colors ([Color management](color-management.md#exposure-and-tone-mapping)). Then it encodes sRGB.
5. In the same pass, it draws the outline's line, applies the color grading table when the sketch sets one, and dithers last.

Steps 4 and 5 run as one pass only while the render scale cannot drop below the whole canvas. The default presets let it drop, and then the work splits in two ([Below the whole canvas's render scale](#below-the-whole-canvass-render-scale)).

Keep line 39 after this. Optional: move the sentence about the opaque pass in item 2 into a "Technical details" block if the list still reads long.
