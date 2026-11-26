# concepts-1-readability-28

## The finding as given

- Page: concepts/assets, concepts/lighting, concepts/lod
- Anchor: the blockquote banner, line 11
- Category: scan-order. Severity: medium.
- Claim: The banner under the title carries limits and status before the diagram and the explanation. Assets lists what is "built". Lighting gives the four-light and area-light caps. LOD gives four exceptions (morphs, blends, skinned levels, hash masks). A newcomer reads limits of features not yet explained.
- Evidence: assets.md:11; lighting.md:11; lod.md:11
- Proposed edit: Keep each banner to its release and stability sentences. LOD: move the exceptions to a "## Limits" section near the end. Lighting: move the four-light cap to "Kinds of light" and the area-light cap to "Clustered forward shading". Assets: delete the "... are built" status sentence.

Verdict: partly

## Evidence

- The rule allows the move. The docs check (tools/lib/docs.ts:651-658) only needs the note to start with the release sentence from tools/lib/steps.ts. The two-sentence banner (release, then "The API is experimental...") passes the check alone. AGENTS.md "Writing docs" says a concept page opens with a Mermaid diagram and a plain explanation. Extra sentences in the banner come before both.
- Most concept pages keep the banner to those two sentences (architecture, backends, color-management, culling, handles, instances, large-worlds, render-graph). So these three pages break the common pattern. Other pages in other slices do the same: quality-presets, post-processing, shadows, render-layers, particle-buffer, materials, static-dynamic.
- LOD (lod.md:11) holds. Four dense sentences come before the reader learns what a level is: "names the base mesh's own vertices", "the 'hash' alpha mode", "a distance band". Most of these facts appear nowhere else on the page. That morphed and blended objects draw their base mesh at every distance is not in the body. Neither is the skinned-level rule, nor the fact that a distance band cuts at once for hash masks (the "Distance bands" section, lines 202-212, does not say it). Line 182 says only that custom materials with an alpha hash switch at once. So these facts must move, not go. This is the part with a real cost to the reader.
- Lighting (lighting.md:11): the facts are true, but the proposed "move" is wrong. The body already says both. Line 76, in "Kinds of light and their units", says "Up to four directional lights light a frame ... A fifth directional light gives no light." Line 142, in "Clustered forward shading", says the preset's `areaLights` setting caps the rectangle and tube lights. So the edit is a plain delete from the banner. The cost here is low: two short sentences that repeat the body.
- Assets (assets.md:11): the "are built" sentence is a status list, not a list of limits, so the claim's frame ("limits of features not yet explained") does not fit this page. Deleting it is still right: it repeats the section headings and reads as a status label. But the proposal also says "keep each banner to its release and stability sentences", and that removes the second extra sentence too. Half of that sentence is already in the body: line 126 covers the texture memory budget. The other half is not. The body never says that glTF skins, clips and morph targets load and animate. Only line 63 (Draco) and line 128 (destroy frees the skeleton and clips) mention them in passing. That half must move into "Models and prefabs", or it is lost.

## Corrected claim

The LOD banner puts four dense exceptions before the diagram and the explanation, and most of them appear nowhere else on the page. The lighting banner repeats two caps that the body already states (lines 76 and 142). The assets banner holds a status list ("are built") and a sentence about glTF animation whose content the body does not otherwise give. All three break the pattern of most concept pages, whose banner holds only the release and stability sentences.

## Corrected edit

- Keep each banner to its release and stability sentences.
- LOD: move the exceptions into the sections they belong to, or into one "## Limits" section before "## API reference". Morphed and blended objects drawing their base mesh, and the skinned-level rule, go under "How the engine picks a level". Hash masks switching at once go under "Fading between levels", beside line 182. The distance band cutting at once for hash masks goes under "Distance bands".
- Lighting: delete the two banner sentences. Lines 76 and 142 already state them.
- Assets: delete the "are built" sentence. Move "The skins, clips and morph targets of glTF files load and animate" into "Models and prefabs". Drop the memory-budget clause, which line 126 already covers.
