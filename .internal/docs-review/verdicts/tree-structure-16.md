# tree-structure-16

## The finding as given

```json
{
 "page": "concepts/post-processing,api/post",
 "anchor": "## Bloom",
 "category": "duplication",
 "severity": "medium",
 "claim": "Each post effect is explained on both pages, which are 7,853 and 6,764 words.",
 "evidence": "Both outlines hold Bloom, Ambient occlusion, Screen-space reflections, Depth of field, Outlines, Color grading, Vignette, Sharpening, Automatic exposure.",
 "proposedEdit": "api/post holds each effect's settings and example. concepts/post-processing keeps the chain (HDR target, order, render scale, single final pass, devices without HDR) and links to each effect. Each effect's inner workings go into a <details> block under its api/post section.",
 "generatedSource": "",
 "id": "tree-structure-16",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

Both pages are hand-written (docs/concepts/post-processing.md, docs/api/post.md). No generated source.

The duplication is real for three effects only:

- Bloom: concept page lines 74-97 hold a full settings table (line 83) and bullets on blend modes, threshold, level spread, weights and turning it off. api/post lines 115-144 repeat the same table and nearly the same bullets.
- Ambient occlusion: concept page table at line 235 and the "turn off / keep values" bullet repeat api/post lines 146-176.
- Screen-space reflections: concept page table at line 284 and the bullets on Fresnel weighing, fading at the screen edge, the frame-before lag and planar passes repeat api/post lines 177-221.

For the other effects the split the finding asks for already exists:

- Depth of field: concept page line 134 says "The post-processing API lists the settings". No table.
- Automatic exposure: line 170, same link, no table.
- Outlines: line 348, same link, no table.
- Color grading and the vignette: line 362, one short section that links to the API for settings.
- Sharpening: line 373, links to the API for its setting.

So "each post effect is explained on both pages" is overstated. The outline match is real (both pages have a heading per effect), but five of the eight effects on the concept page already explain only how they work and link out for settings. Vignette has no heading of its own on the concept page.

The proposed edit goes the wrong way:

- AGENTS.md "Writing docs": "A concept page opens with a Mermaid diagram and a plain explanation". The concept page's diagram (lines 11-35) names each effect's steps (bloom's steps down and up, the DoF three steps, the AO three steps, the SSR pyramid and trace). Moving every effect's inner workings to api/post would leave that diagram with no text that explains it.
- api/post line 13 and its Related pages line 482 already say the concept page "explains how bloom, ambient occlusion, screen-space reflections, depth of field and sharpening" work and "what they cost". api/post links to concept anchors at lines 143, 304, 390, 414, 456 and 466. The edit would break that agreed split and these anchors.
- Moving the step lists and the Cost subsections into api/post would make the API page longer, not shorter. The API page is where a reader looks up a setting.
- The concept page also holds sections with no API counterpart that the edit does not mention: Screen-space bounce light, Dithering, Still-camera accumulation.

## Corrected claim

Bloom, ambient occlusion and screen-space reflections each have their settings table and most of their behavior bullets on both pages. Depth of field, automatic exposure, outlines, color grading, the vignette and sharpening already keep settings on api/post and inner workings on the concept page.

## Corrected edit

Keep the split the pages already state: api/post owns settings, defaults and examples; concepts/post-processing owns how each effect works and what it costs.

1. On concepts/post-processing, in "Bloom", "Ambient occlusion" and "Screen-space reflections", delete the settings table. Put in its place the line the other sections use, for example "[The post-processing API](../api/post.md#bloom) lists the settings." Keep the code example short or drop it, as the Depth of field section does.
2. In the same three sections, delete the bullets that only restate a setting (blend modes, threshold 0 and 1, "turn off and keep the values", the AO intensity range). Keep the bullets that explain behavior the API page does not give (Karis average, level sizes as a share of the screen, blended objects taking no AO, the prepass leaving out masked surfaces, the mip blur with no noise).
3. Keep each effect's step list, its "Where ... draws" and its "Cost" sections on the concept page. Where a section is dense (for example Bloom's Cost bullets or the GSR 1 detail under "Below the whole canvas's render scale"), wrap it in a `<details>` block with a `<summary>Technical details: ...</summary>` on the concept page. The main text must still read with every block closed.
4. Make no change to api/post apart from checking that each concept anchor it links to still exists.
