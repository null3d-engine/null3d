# api-reference-readability-11

## Finding as given

- Page: api/reference/materials, api/reference/post, api/reference/scene, api/reference/particles, api/reference/engine
- Anchor: materials `AlphaMode` line 19, `Blending` line 27; post `ToneMapping` line 220; scene `FogCurve` line 151; particles `ParticleFacing` line 154; engine `DepthMode` line 62
- Category: wall-of-text. Severity: medium.
- Claim: Value types explain each value in a prose walk ("The `opaque` mode ... The `mask` mode ..."). A reader looking for one value must read every sentence. Six of these are long paragraphs in stats.json.
- Evidence: AlphaMode 96 words/7 sentences; Blending 83/6; ToneMapping 92/6; FogCurve 67/5; ParticleFacing 57/5; DepthMode 96/7.
- Proposed edit: Write values as a TSDoc list ("- `mask`: draws nothing where the alpha falls below `alphaCutoff`, and draws the rest opaque.") with a one-sentence lead. After the flattening fix it renders as a list; or have the generator turn a "`value`: text" list on a literal union into a Value | Meaning table.
- Generated source: packages/engine/src/scene/resources.ts

Verdict: partly

## Evidence

- The six paragraphs are as described. Each walks the union's values in turn, one or more sentences per value ("The `opaque` mode ...", "With `camera`, ...", "In `reversed` depth, ..."). stats.json lists all six as long paragraphs with the counts the finding gives (FogCurve and ParticleFacing are flagged on sentence count only).
- The page lines in the anchor are right for the generated pages (materials.md: AlphaMode body at 19, Blending at 27). stats.json gives earlier line numbers (12 and 20) for the same paragraphs; the content matches.
- The claim that a TSDoc list renders as a list only after a generator fix is true. tools/lib/api-docs.ts:74 defines `flat`, which joins all lines with spaces, and lines 123 and 324 pass every doc comment through it. The proof is on the same engine page: `DrawPathReason` (engine.md about line 78, stats.json "140 words, 10 sentences") and `RenderFallback` are already written as "- `value`: text" lists in source (packages/engine/src/page/engine.ts:655-660, packages/engine/src/gpu/webgpu/draw-path-probe.ts:54) and render as one run-on paragraph with inline " - " marks. So editing the TSDoc alone, without the generator change, makes these six paragraphs worse, not better.
- The "Generated source" field is incomplete. Only AlphaMode and Blending live in packages/engine/src/scene/resources.ts (lines 1811-1833). The others are ToneMapping in packages/engine/src/scene/post.ts:50, FogCurve in packages/engine/src/scene/fog.ts:28, ParticleFacing in packages/engine/src/scene/particles.ts:79, and DepthMode in packages/engine/src/page/switches.ts:74.
- Benefit is uneven. AlphaMode, Blending, ToneMapping and DepthMode carry 83 to 96 words with long per-value text, and a list clearly helps lookup. FogCurve (67 words, formulas per value) and ParticleFacing (57 words, one short sentence per value) are short enough to scan; a list there is polish, but it keeps the six types consistent, so including them is reasonable.
- No writing rule blocks the edit: lists are allowed, the sentences stay under 25 words, and no dashes as connectors are needed ("`value`: text" uses a colon).

## Corrected claim

Six value-type paragraphs on five reference pages walk each union value in prose, so a reader looking for one value reads them all. A TSDoc list fixes this only together with a generator change: tools/lib/api-docs.ts flattens every doc comment to one line, which is why the existing lists for `DrawPathReason` and `RenderFallback` on the engine page already render as run-on paragraphs. The sources are resources.ts (AlphaMode, Blending), post.ts (ToneMapping), fog.ts (FogCurve), particles.ts (ParticleFacing) and page/switches.ts (DepthMode). The gain is clear for four of the six; for FogCurve and ParticleFacing it is polish.

## Corrected edit

1. In tools/lib/api-docs.ts, stop `flat` from joining doc comment text for reference pages (keep it for table cells and one-line summaries). Keep paragraph breaks and "- " list lines, and join only the wrapped continuation lines of each paragraph or list item. This also fixes `DrawPathReason` and `RenderFallback`.
2. In the same change, rewrite the six comments as a one-sentence lead plus one "- `value`: text" item per value, in packages/engine/src/scene/resources.ts, scene/post.ts, scene/fog.ts, scene/particles.ts and page/switches.ts. Example for AlphaMode:
   "How a material uses its alpha: its opacity, times its base color map's alpha, and times its mesh's vertex alpha with `vertexColors`.
   - `opaque`: ignores the alpha.
   - `mask`: draws nothing where the alpha falls below `alphaCutoff`, and draws the rest opaque.
   - `hash`: draws each point of the surface opaque or not at all, by a pattern that stays on the mesh. The alpha sets how much of the surface draws.
   - `blend`: blends the surface over what lies behind it. Blended objects draw after the opaque ones, farthest first."
3. Optional: in DepthMode, the `EXT_clip_control` sentence under `reversed` can move into a collapsible "Technical details" block after the list, so the list items stay short.
Do not land step 2 without step 1.
