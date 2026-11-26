# guides-1-readability-16

## Finding as given

- page: guides/custom-passes
- anchor: lines 25, 306, 312, 314, 336; ### Cost (lines 215-224)
- category: long-paragraph, severity: medium
- claim: The intro defines four kinds of pass in one 106-word paragraph. Lines 306, 312 and 314 pack several rules each. '### Cost' has ten bullets, several of 4-5 sentences, on how effects join and fold; a user needs two rules from it.
- evidence: stats.json lines 18 (106 words, 6 sentences), 299 (111, 5), 305 (77, 6), 307 (89, 7), 329 (74, 5).
- proposedEdit: Line 25: one sentence plus a four-row table (kind, reads, writes, link). Cost: keep the memory and GPU-time bullet and 'effects that read only their own pixel join; one that reads other pixels starts a new pass'; move folding, background joined shaders, WebGL2 compile note, precision, targets and pipeline timing into <details><summary>Technical details: how the engine joins effects</summary>; keep 'add effects before the first frame' as an action. Line 306: split cadence from on/off. Line 312: list what a scene pass draws. Line 314: keep the no-shadow rule, move the light-list memory into details. Line 316: a table by device kind or a details block.

Verdict: partly

## Evidence

- stats.json line numbers skip the 7-line front matter, so stats line 18 = file line 25, 299 = 306, 305 = 312, 307 = 314, 329 = 336. The counts are facts.
- Line 25 does define four kinds (custom effect, custom tone curve, scene pass, full-screen pass) in 6 sentences. But the page has six kinds of pass under its headings: it also covers reflection passes (## Reflections, line 318) and compute passes (## Compute passes, line 505). A four-row table copies the gap in the intro. The table needs six rows.
- ### Cost has ten bullets (lines 215-224). Line 216 has 4 sentences, line 220 has 6, line 224 has 4. The claim holds.
- "A user needs two rules" is overstated. The proposal itself keeps three. Line 224 (a new effect shows a few frames after addEffect; add it a little before to show it at a set moment) is an action for users, and the underwater example at line 208 relies on it. It must stay in the main text, not move into the block. The fold rule at line 218 (with bloom and FXAA off and the scale held at the whole canvas, one per-pixel effect costs no pass) is also a cost rule a user can act on; keep its one-line result in the main text and move the conditions into the block. Line 223 (a depth read keeps scene depth in memory) is a real cost, also main text.
- Line 306 is the strongest part. It says "the switch" and "switching it on" with no API name. The page first names `render.setPassEnabled` at line 342, and only for full-screen passes. docs/api/render.md lines 449-450 already say the same plan and compile rules. Splitting cadence from on/off is right, and the on/off sentence must name `render.setPassEnabled` and link to the API page instead of repeating its rules.
- Line 312 (77 words, 6 sentences) is a list of what a scene pass draws. A bullet list fits. Line 314: the no-shadow rule is user-facing; the light-list memory (under 1 MB) is fit for a block.
- Line 316 is not in the stats list (83 words, 4 sentences; the limit is over 4). Its edit is optional polish, not a long-paragraph fact.
- Line 336 is in the anchor, but the edit gives nothing for it. It is a 5-sentence lead-in to the code. Splitting off the last three sentences (what the bed height needs) into their own paragraph is enough.

## Corrected claim

The intro packs six sentences on four kinds of pass, while the page covers six kinds. Lines 306, 312 and 314 pack several rules each; line 306 also refers to an on/off switch that the page names only later, for another kind of pass. ### Cost has ten bullets, several of 4-6 sentences; most are engine detail, but four rules are user-facing.

## Corrected edit

- Line 25: one sentence, then a six-row table (kind, reads, writes, section link): custom effect, custom tone curve, scene pass, reflection pass, full-screen pass, compute pass.
- Cost: keep in the main text (1) the memory and GPU-time bullet, (2) "an effect that reads only its own pixel joins the pass before it; one that calls effectPixel or effectColor starts a new pass", (3) "with bloom and FXAA off, one per-pixel effect can cost no pass", (4) "a depth read keeps scene depth in memory", (5) "a new effect shows a few frames after addEffect; add it a little before", (6) "add your effects before the first frame". Move into `<details><summary>Technical details: how the engine joins effects</summary>`: the render-scale conditions for joining and folding, background building of joined shaders, the WebGL2 compile note and its console message, 32-bit precision between joined effects, the two shared targets.
- Line 306: one paragraph on the cadence (`render.setPassEvery`, cheap to change every frame, texture keeps its last image). One sentence on on/off that names `render.setPassEnabled` and links to [Render graph API](../api/render.md) for the compile rules, in place of repeating them.
- Line 312: a bullet list of what a scene pass draws, then the clearColor and no-AO notes.
- Line 314: keep the no-shadow rule; move the light-list memory into a details block or drop it, since the API page can hold it.
- Line 316: optional; a three-row table by device kind is fine.
- Line 336: split the bed-height sentences into a second paragraph.
