# concepts-1-readability-08

## Finding as given

- page: concepts/lighting
- anchor: lines 76, 92, 94, 112, 114, 142, 146, 154, 168, 176, 178, 254, 329, 331, 335, 377, 417, 500, 518
- category: long-paragraph, severity: medium
- claim: Nineteen long paragraphs mix the user rule with how the engine computes it.
- evidence: stats.json concepts/lighting longParagraphs
- proposedEdit: 94: keep 2 sentences (exposure at the source; same picture, colors fit 16-bit floats), and move the 65,504 example into a block. 114: move the fitted slices into a block 'Technical details: how slices fit the depth in view'. 142: make the limits a list (1,024 lights, 128 per cluster, areaLights cap). 154: move the hemisphere math into a block. 176/178: split height fog and sun glow, and split 'where fog mixes in' from 'background share and fog: false'. 254: make the setEnvironment options a list. 331: move the L1 coefficients and the reads into a block. 335: make the bake numbered steps. 377: split 'when the background draws' from 'how each kind draws'. 417: end after 'The fog then blends the edge.' 500: move into a block 'Technical details: aerial perspective'. 518: keep 2 sentences, and move the fog-color reasoning into a block. Split 76, 92, 146, 168 and 329.

Verdict: partly

## Evidence

- stats.json lists 19 long paragraphs for concepts/lighting. Its line numbers (69, 85, 87, ... 511) are the finding's lines minus 7, because stats count from after the front matter. Each anchor line in docs/concepts/lighting.md is the matching paragraph, so the count and anchors hold.
- Most proposals hold. Lines 94, 114, 154, 331 and 500 do mix a user rule with engine internals, such as the 65,504 half-float limit, the depth-fit compute pass, the hemisphere cosine term and the L1 coefficients. Collapsible blocks suit them. The splits and lists for 142, 176/178, 254 and 377 are sound.
- 417 (Where the land ends): the paragraph's last sentence, "Where that is not wanted, hide the edge with geometry, and keep the camera where the geometry hides it:", is the lead-in to the four-item list at lines 419-422. If the paragraph ends after "The fog then blends the edge.", that sentence is lost and the list has no lead-in. The sentence must stay as its own short paragraph before the list.
- 335 (bakeProbes): this text tells what the bake does with each ray, not steps the reader takes. Numbered steps would suggest a procedure. A bullet list of the three ray outcomes (reaches the sky, meets a back face, hits a front face) fits better. `step` and `finish` then go in a separate short paragraph.
- 331: two of its facts are already in "Limits and cost" (lines 352-359). That section gives "12 half floats of its coefficients" and "Each lit pixel of a standard material reads the grid four times". These can be cut from 331, not moved into a block. Only the meaning of the L1 coefficients and of the masks needs a block. The last two sentences say the grid replaces the environment's diffuse light and that `environmentWeight` sets the share. They are user rules and stay in the main text.
- 518 (Time of day): the "fog-color reasoning" warns that a fog in the horizon's color washes out shaded surfaces. A user who overrides the fog color needs that warning, so it is not only engine detail. Keep it as one sentence in the main text. Only "Each comes from the same sky model as the sky background" and the mean-light detail can go into a block.
- 500: the last sentence gives a real limit: past a few tens of kilometres the aerial perspective goes wrong. Leave that sentence and "It costs about what fog costs" outside the block, so the closed page still shows the limit.
- 76, 92, 146, 168 and 329 have 59 to 92 words each. Splitting them is a light change and fine, but it matters less than the other edits.

## Corrected claim

The 19 long paragraphs are real, and most of them mix user rules with engine internals. Most of the proposed edits are right. Four are wrong or need a change: the edit for 417 would lose the lead-in to the list, the edit for 335 uses the wrong list type, the edit for 331 moves facts that the page already gives elsewhere, and the edits for 518 and 500 would hide user guidance in blocks.

## Corrected edit

- 417: Split it, and cut nothing. End the first paragraph after "The fog then blends the edge." Keep "Where that is not wanted, hide the edge with geometry, and keep the camera where the geometry hides it:" as its own paragraph directly before the list.
- 335: First give one sentence: `bakeProbes` casts rays from each probe with `scene.raycastBatch`. Then give a bullet list of the three ray outcomes, then one sentence on what the grid holds (one bounce, no lamps). End with a short paragraph on `step` and `finish`.
- 331: Remove "12 numbers" and "with four filtered reads", because "Limits and cost" already gives them. Put the L1 and mask meanings in a "Technical details: what a probe holds" block. Keep the diffuse-replacement and `environmentWeight` sentences in the main text.
- 518: Keep the first two sentences and one warning sentence: a fog in the horizon's color washes out shaded surfaces, so `timeOfDay` uses the sky's mean light. Move the sky-model and mean-light reasoning into a block.
- 500: Keep "It costs about what fog costs" and the tens-of-kilometres limit outside the block. Move the integration detail inside it.
- All other parts of the proposed edit stand as given.
