# Verdict on guides-1-readability-24

## The finding as given

- page: guides/baked-light-data
- anchor: lines 33, 64, 66, 94, 122, 124; ## Limits first bullet (line 174)
- category: long-paragraph
- severity: medium
- claim: Line 122 (107 words, 7 sentences) mixes what each call returns with texture formats and download size. Line 64 gives the coefficient order, which a tool author must get exactly right, in running text. Lines 66, 94, 124 and the sub-volume bullet are GPU-side detail.
- evidence: stats.json lines 26 (61 words, 5 sentences), 57 (65, 5), 115 (107, 7).
- proposedEdit: Line 33: cut what the banner repeats. Line 64: a list of probe order, 12 floats per probe, coefficient order L0, L1 y, L1 z, L1 x. Line 66: three sentences or a three-row table. Line 122: keep what each call returns; move rgba8unorm/rgba16float, the opaque fourth channel and the shared binding, plus lines 94 and 124, into <details><summary>Technical details: the textures that the loader makes</summary>. Line 174: keep the 256 x 256 x 62 limit; move sub-volumes and padding into details.

Verdict: partly

## Evidence

- Paragraph counts: stats.json lines 26, 57 and 115 match page lines 33, 64 and 122 (the front matter adds 7 lines). They are facts.
- Line 33 repeats the banner (line 11) twice: "a reader ignores members that it does not know" and the rule for a new version number. Its last sentence also repeats the table row on line 30. The banner starts with a fixed phrase that the docs check needs (tools/lib/docs.test.ts:135), so cutting from line 33 is the right side. This part holds.
- Line 64: the order is correct. packages/engine/src/scene/light-probes.ts:28-29 says "L0, then L1 along y, along z and along x, four RGB coefficients". A list is a fair change. But "12 floats per probe" is already in the table (line 60), so the list need not repeat it.
- Line 66 is not GPU-side detail. Its first two sentences say what the validity and sky visibility values mean (1 in open space, 0 inside geometry; the share of sky that the rays reached). A bake tool must write these values, and this page is the format's reference (line 21). They must stay in the main text. The paragraph already has three sentences, one for each member. The real defect is the third sentence: about 45 words, over the 25-word limit in AGENTS.md "Writing docs". Only its second half (how the engine weights sky visibility by the surface's facing and the live environment light) is engine-side detail.
- Line 94 is mostly format specification, not GPU-side detail. "A unit vector in world space, pointing from the surface toward the light" is what a bake tool must write. Only the third sentence (own texture, shared texture array and binding) is loader detail. The second sentence is broken English ("Each curve of the map's ranges from -1 to 1, then divided by 127"). It must be rewritten, not only moved. The code says each signed byte holds an axis times 127, from -127 to 127 (packages/engine/src/scene/baked-light.ts:56, 77).
- Line 122: the split holds. The sentence "the direction texture has the radiance's size and format" repeats line 94's last sentence, so one block for both removes the repeat. The proposal does not say where the download sentence goes. It is a cost that every user sees, so it stays in the main text.
- Line 124: its first two sentences tell a user what `lightMapDirection` does to a normal map's relief. That is the user-facing effect, and it stays in the main text. Only the last sentence (one texture read and a branch for each pixel) fits the block.
- Line 174: the sub-volume layout and the padding slices are GPU internals, so a block fits. But line 176 says "plus the padding slices", so the main text would then name a thing that only the closed block explains. Also, a details block inside a list item renders badly in GitHub Flavored Markdown. Put the block after the list.

## Corrected claim

Line 122 mixes what each call returns with texture formats and the reader's download size. Line 64 gives the coefficient order in running text. Line 33 repeats the banner and the version table. Some engine-side detail sits in the main text: the last sentence of line 94, the second half of line 66's last sentence, the cost sentence of line 124, and the sub-volume layout on line 174. Lines 66 and 94 are mostly format facts that a bake tool needs. Line 66's last sentence is too long, and line 94's second sentence is broken English.

## Corrected edit

- Line 33: keep "The rest of the file depends on its kind" and "A bake tool may write members that an earlier engine leaves out, and the file still reads." Cut the sentences that the banner and the table already give.
- Line 64: a list. Probes run x fastest, then y, then z. Each probe holds four RGB coefficients in this order: L0, L1 along y, L1 along z, L1 along x. `bakeProbes` writes the same layout. Do not repeat the float count from the table.
- Line 66: keep it in the main text. Split the third sentence: "The sky visibility is the share of the sky that the probe's rays reached." Then move the engine's weighting of it, and the live environment light, to the block.
- Line 94: keep the first sentence in the main text. Rewrite the second: "Each axis runs from -1 to 1. Multiply it by 127 and store it as a signed byte." Move the third sentence to the block.
- Line 122: keep what each call returns and the download sentence. Move the texture formats (`rgba8unorm` in sRGB, `rgba16float` in linear light), the opaque fourth channel and the shared binding to the block.
- Line 124: keep the first two sentences. Move the cost sentence to the block.
- One block after "## Load a file" text: `<details><summary>Technical details: the textures that the loader makes</summary>` with the moved sentences from lines 66, 94, 122 and 124.
- Line 174: keep "A grid takes at most 256 probes along x, 256 along y and 62 along z." Put a block after the list, `<details><summary>Technical details: how the grid's texture is laid out</summary>`, with the sub-volumes and padding slices. Line 176 then reads "The grid's texture takes about 32 bytes of GPU memory for each probe", with the padding mentioned only in the block.
