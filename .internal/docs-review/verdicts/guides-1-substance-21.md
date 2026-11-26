# guides-1-substance-21

## Finding as given

- page: guides/custom-passes
- anchor: long paragraphs at lines 25, 306, 312, 314, 336, and the bullet at line 421
- category: long-paragraph, severity: medium
- claim: Line 25 defines four kinds of pass in one block. Lines 312 and 314 list what a scene pass draws and point-light shadow rules. Line 421 introduces sceneInputs, engine_frame.camera_range and sceneDistance(uv) with no example, and a blank line at 422 breaks the list.
- evidence: .internal/docs-review/stats.json guides/custom-passes (statistics 18, 299, 305, 307, 329); docs/guides/custom-passes.md:421-423.
- proposedEdit: Line 25: a table of pass kinds with one line and a link each. Lines 312-314: a short list, shadow rules in 'Technical details: lights and shadows in a scene pass'. Line 421: its own subsection with a WGSL example, or a details block. Remove the blank line 422.

Verdict: partly

## Evidence

- The five long paragraphs are facts from stats.json (stats lines 18, 299, 305, 307, 329 are page lines 25, 306, 312, 314, 336; the stats count skips the front matter).
- Line 25 (106 words, 6 sentences) names four kinds: custom effect, custom tone curve, scene pass, full-screen pass. The page also has "Reflections" and "Compute passes" sections that the intro leaves out. A short list, one line and a link per kind, is right; it should name all six kinds.
- Line 306 (111 words) and line 336 (74 words) are in the anchor, but the claim and the edit say nothing about them. Line 306 holds render-graph detail (when a switch compiles the graph, what stays in the plan) that fits a details block. Line 336 is borderline and can stay, or lose its last two sentences into the recipe bullets.
- Lines 312 and 314: the claim holds. Line 314 opens with a fact every reader needs: a light that only the pass sees lights it without a shadow. That sentence must stay in the main text. The per-pass light list and its memory cost ("under 1 MB") are the implementer detail for the block.
- Line 421: "with no example" is wrong in effect. The bullet links to docs/api/materials.md#the-scene-behind-a-surface (materials.md:769-796), which has a full WGSL example using sceneInputs, engine_frame.camera_range and sceneDistance(uv). A new subsection with its own WGSL example would copy that one. The real problem is length: the bullet is about 130 words in a list of one-line notes.
- Line 422: a blank line between list items makes the list loose (every item gets paragraph spacing). It does not split the list. Removing it is polish.

## Corrected claim

Five paragraphs are long (lines 25, 306, 312, 314, 336). Line 25 lists four kinds of pass and misses reflection and compute passes. Line 306 packs render-graph detail into the cadence text. Line 314 mixes a reader-facing shadow rule with memory detail. The bullet at line 421 is far longer than its neighbours. It explains in prose a depth-fade method that the linked Materials section already shows in code. The blank line at 422 makes the list loose.

## Corrected edit

- Line 25: a short list (or table) of all six kinds (effect, tone curve, scene pass, reflection pass, full-screen pass, compute pass), one line and an anchor link each.
- Line 306: keep "The call compiles nothing, so the cadence may change as often as once a frame" and the sentence that a skipped frame shows the last image. Move the switch and plan sentences into "Technical details: cadence, the switch and the render graph".
- Lines 312-314: a short list of what a scene pass draws. Keep in the main text: "A point or spot light that only the pass sees lights the pass without a shadow." Move the per-pass light list and its memory cost into "Technical details: lights and shadows in a scene pass".
- Line 421: cut the bullet to two sentences: "Without a height map of the bed, a blended sheet can read the scene's depth with `sceneInputs: ['sceneDepth']` and fade its alpha near the bank for a soft shore. [Materials](../api/materials.md#the-scene-behind-a-surface) shows the WGSL." Put the texture-limit sentences in a details block, or drop them, since the Materials page covers them. Do not add a second WGSL example.
- Remove the blank line at 422.
