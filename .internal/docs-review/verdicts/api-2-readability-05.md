# api-2-readability-05

## Finding as given

```json
{
 "page": "api/impostors",
 "anchor": "## Make a card read as its mesh (133-169) and ## Bake several views, not one side (171-220)",
 "category": "duplication",
 "severity": "medium",
 "claim": "Both sections give the same worst view angles and the same texels per cell. The first one also tells the past-tense story of 'the island's trees', a scene the reader does not know, which hides the rules. These lines are hard-wrapped, unlike the rest of the page.",
 "evidence": "line 153 'a four by four grid holds 53 degrees at worst and five by five holds 42.5'; line 182 '53 degrees apart at worst on four by four, 42.5 on five by five'; line 136 'The island's trees once baked a card as one unlit side view'; lines 163-165 and 189-191.",
 "proposedEdit": "Merge them into one section, '## Bake a card that matches its mesh': a numbered checklist (bake the replaced level, bake unlit, store normals, choose views, choose texels, use the bake's size, check the card beside its mesh), a table of grid size and worst angle, a table of card size on screen and texels, and the code at line 196. Move the measured comparison and the atlas memory figures into <details><summary>Technical details: what a mismatched card looks like</summary>, in present tense. Unwrap the lines.",
 "generatedSource": "",
 "id": "api-2-readability-05",
 "slice": "api-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- Duplication holds. docs/api/impostors.md:152-155 and :182-184 give the same worst angles (53, 42.5, 23 degrees). :156-157 and :185-186 give the same "80 pixels wants 32 to 64 texels". :160-162 and :175-178 both say the baker draws a real grid, stores a normal per texel and lights from every side.
- Past tense holds. :136-141 "The island's trees once baked ... that card was 34 to 79 per cent brighter". :164-165 "reached ... read as stacked plates there".
- "A scene the reader does not know" is only partly true. The island is a published demo (examples/demos.ts:183-190, code 'showcase/island/'), and other pages name it (guides/loading-screens.md:147, guides/phones.md:111). But this page never links it, so here the reader has no way to see it.
- Hard wrap holds: lines 135-191 wrap near 100 characters; the rest of the page uses one line per paragraph (only :229 elsewhere is near that length). Rendered Markdown joins the lines, so this costs editors, not readers.
- The edit as proposed breaks two inbound links. docs/concepts/lod.md:233 links impostors.md#bake-several-views-not-one-side, and docs/api/geometry.md:282 links impostors.md#make-a-card-read-as-its-mesh. A merged heading "Bake a card that matches its mesh" removes both anchors.
- The proposed checklist drops a rule: "Bake the views with the engine's baker unless the card stays tiny" (:159-165), the hand-bake limit. lod.md:233 repeats that rule and points here for it.
- The acceptance limits (:166-169: mean color per channel and silhouette area within 10 per cent, shading spread within 25 per cent) are rules a reader acts on, so they belong in the main text, not in the block. The rule "the atlas grows with the square of the texels, and each object takes two atlases" (:186-187) also belongs in the main text. Only the island's example figures (:189-191) and the measured mismatch (:136-141) are detail.

## Corrected claim

The two sections repeat the view angles, the texels per cell and the baker's description. The first opens with a past-tense measurement of the island demo's old cards, which the page does not link, before it gives the rules. Lines 135-191 are hard-wrapped, unlike the rest of the page; that has no cost in the rendered page.

## Corrected edit

Merge the two sections under one heading, and update docs/concepts/lod.md:233 and docs/api/geometry.md:282 to the new anchor (or keep "## Make a card read as its mesh" as the merged heading so geometry.md's link holds, and change only lod.md's). Open with one present-tense sentence: a card with a different picture from its mesh reads as another species, and the light shows it most. Then a numbered checklist: bake the replaced level; bake color unlit, sRGB, no sun; store a normal per texel; choose views (table: 4x4 = 53 degrees, 5x5 = 42.5, 10x10 = 23, with the far-crown and landmark advice); choose texels (table: about 80 px = 32-64, about 215 px = 128-256, and the square-growth and two-atlas rule); use the engine's baker unless the card stays under a few tens of pixels; take the bake's `size` and foot; check the card beside its mesh with the stated limits. Keep the code block and the paragraph about the baker and the three-view blend (:174-178) once. Put the measured mismatch (:136-141), the island's stacked-plate result (:164-165) and its atlas figures (:189-191) in one present-tense <details><summary>Technical details: what a mismatched card looks like</summary> block, and link the island demo there (https://github.com/null3d-engine/null3d/tree/main/examples/showcase/island/). Unwrap the lines.
