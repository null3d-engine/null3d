# concepts-2-readability-13

## Finding as given

- page: concepts/quality-presets
- anchor: ### The depth prepass (lines 218-226)
- category: structure
- severity: medium
- claim: Line 220 (151 words, 12 sentences) mixes four topics: which objects skip the prepass, the default on each path, which effects force it, and the overrides. It ends with 'So High and Ultra draw it on WebGPU', but the preset table says depthPrepass is 'no (WebGL2: yes)' on High and Ultra. Line 224 is implementer detail on exact depth equality.
- evidence: stats.json lines 211-219 (file 218-226). quality-preset-tables line 85.
- proposedEdit: Add a table 'When the prepass draws' with rows WebGL2, WebGPU and compatibility mode, and columns Preset default, Turned on by (AO, contact shadows, SSR, bounce light), Turned off by (lowest tier, depthPrepass: false). Say that High and Ultra on WebGPU draw it because bounce light is on there. Move 224 into <details><summary>Technical details: why both passes compute the same depth</summary>. Keep the decal depth-bias advice from 226 in the main text.

Verdict: partly

## Evidence

- The page, file line 220, mixes the four topics the finding names. stats.json gives 151 words and 12 sentences. That part holds.
- The "So High and Ultra draw it on WebGPU" sentence is in the middle of line 220, not at its end. It is correct, and the page already gives the reason ("where the bounce light runs"). The table cell "no (WebGL2: yes)" is the preset's own choice, and the effects add the prepass on top of it. Code:
  - crates/null3d-render/src/frame_graph.rs:1732-1741: the prepass draws when `prepass || screen_steps() || ssr`, and the screen steps run while ambient occlusion, contact shadows or bounce light draw.
  - packages/engine/src/quality/presets.ts:246-251: bounce light has 4 rays on High and 8 on Ultra, so it runs by default there.
  - packages/engine/src/quality/presets.ts:826-828: the setting's docs say that these effects still draw the prepass while they run.
  So the two statements do not conflict. A reader who compares them can still be confused, so a clearer split is worth doing. But "say that High and Ultra draw it because bounce light is on" adds nothing the page does not already say.
- The proposed table has two faults:
  - Its "Turned off by: depthPrepass: false" column is wrong. The option sets the base value only (presets.ts:826-828, frame_graph.rs:1733). Ambient occlusion, contact shadows, bounce light and screen-space reflections still draw the prepass with `depthPrepass: false`. The same is true for the lowest quality tier on WebGL2, which only sets `depthPrepass: false` (presets.ts:948). A table that lists these as "turned off by" would mislead a reader.
  - Its "Turned on by" column has the same four effects on every row. Three rows of the same text add no information.
- Moving all of line 224 into a closed block breaks line 226. Line 226 says "One case differs" and "both pass the test for equal depth". Those phrases depend on the first two sentences of 224: the prepass gives the same image, and the opaque pass shades a pixel only where its depth equals the prepass's depth. The main text must make sense with every block closed, so these two sentences must stay in the main text. The rest of 224 (the position-only shader on WebGPU, own vertex shaders for custom materials and sprites, matching programs on WebGL2) is correct implementer detail. It fits a block.

## Corrected claim

Line 220 is too long and mixes four topics. Readers can be confused by the preset table's "no" next to the page's "High and Ultra draw it on WebGPU". The page is correct, though: the table gives the preset's own default, and bounce light adds the prepass on top of it. The second half of line 224 is implementer detail. Its first two sentences are needed by line 226.

## Corrected edit

Split line 220 into three short paragraphs:
1. Which objects stay out of the prepass (blended objects, line batches, alpha cutoff, no depth writes or no depth test).
2. Defaults and effects: "On WebGL2, every preset turns the prepass on, except on the lowest quality tier. On WebGPU and in its compatibility mode, every preset leaves it off. The preset table shows this default. Ambient occlusion, contact shadows, screen-space bounce light and screen-space reflections read the prepass's depth, so they draw the prepass while they run, whatever the preset or the option says. Bounce light runs on High and Ultra on WebGPU outside compatibility mode, so those presets draw the prepass there."
3. Overrides and cost: the `depthPrepass` option sets the base value, the `?prepass=on|off` switch, `quality.set({ depthPrepass })`, and the extra depth pipeline per opaque object that the first frame and warm-up build.

If a table is used, give it one column only: the preset's default on each path. Do not add a "turned off by" column, because no setting turns the prepass off while those effects run.

On line 224, keep in the main text: "Both GPU paths draw the prepass so that it gives the same image as a frame without it. The opaque pass shades a pixel only where its depth equals the prepass's depth." Move the rest into:

<details>
<summary>Technical details: why both passes compute the same depth</summary>

(the exact-depth requirement, the position-only shader on WebGPU, own vertex shaders for custom materials and sprites, and same-material programs on WebGL2)

</details>

Keep line 226 (ties between surfaces at the same depth, and the depth-bias advice for decals) in the main text.
