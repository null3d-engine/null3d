# concepts-1-readability-03

## The finding as given

- Page: concepts/lod
- Anchor: lines 23, 29, 37, 59, 93, 97, 99, 103, 107, 109, 111, 113, 115, 117, 119, 125, 127, 129, 139, 145, 160, 169, 184, 198, 211, 215, 221, 233, 235, 237
- Category: long-paragraph. Severity: high.
- Claim: 30 paragraphs are over the limit. The worst are 129 (298 words, 15 sentences), 127 (267 words), 97 (225 words), 145 (206 words) and 93 (162 words). The core rule (a level switches where its error covers under a pixel) is lost among storage and planning detail.
- Evidence: stats.json concepts/lod longParagraphs (30 entries; stats lines are file lines minus 7).
- Proposed edit: 29: make the planning conditions a bullet list (4,096+ triangles; or 256+ with copies holding 65,536+), and move the "same planner as --lod" sentence into a details block. 37: keep the halving and threshold sentence, move the fade sentences to "Fading between levels", and make the meshes that plan none a list. 93: keep 3 sentences (a finer stage downloads only after the level above draws; a level never drawn costs no download; the loader checks about every 1.5 s), and move the timing into a details block. 97+99: keep 2 sentences, and move vertex order, vertex copies, NULL3D_lod_error, MSFT_screencoverage and the 1,080-pixel screen into a block "Technical details: how the file stores levels". 235: move the octahedral atlas and three-view blend into a block "Technical details: what a card bake stores". Split 160, 169, 184, 198, 211, 215 and 221 at their change of subject. For 103-129, see the cluster split finding.

Verdict: partly

## Evidence

- The counts hold. stats.json gives 30 long paragraphs for concepts/lod. With the 7-line offset they map to the anchor lines: 129 = 298 words / 15 sentences, 127 = 267 / 15, 97 = 225 / 15, 145 = 206 / 11, 93 = 162 / 12 (119 also has 162 words). The page has 5,956 words.
- "The core rule is lost" is overstated. The page states the rule in plain words in its second paragraph (docs/concepts/lod.md:23: "Where that distance covers less than about a pixel on the screen, the copy looks the same as the full mesh"). It has its own section with the formula at lod.md:131-137. The rule is hard to reach because of section order (the cluster and pieces sections come first). That is findings rank 10 (scan order) and rank 5 (split page), not the paragraph length. Long paragraphs make the page harder to read, but they do not mislead and do not block a newcomer who reads the opening. By the severity scale this is medium, not high.
- 29: the numbers in the proposed list are correct. packages/engine/src/scene/resources.ts:306 (4,096 triangles), :312 (65,536 drawn triangles), :315 (256 triangles for the copy rule). The list and the block are a good change.
- 93: the proposed kept sentence is wrong for the first stage. packages/engine/src/scene/gltf.ts:806-809 says "The first stage always arrives, and each later one waits until the level loaded now has drawn", and gltf.ts:834 and :909 skip the wait for index 0. The page says this correctly at lod.md:93 ("It fetches the stage after the file's own level at once"). The proposed main text drops that fact and says every finer stage waits for a draw. The timing figures are correct: gltf.ts:725 (120 frames, about 2 s at 60 fps) and gltf.ts:739 (1,500 ms pause, then a 20-frame watch at :731). So "checks again about every 1.5 seconds" is close enough for the main text.
- 37: the governor and fade sentences need not move. "Fading between levels" already holds them (lod.md:166 and :178). They should be cut at 37 and replaced with a link, as rank 27 says.
- 97+99: most of the storage detail suits a block. But lod.md:99 ends with a user-facing fact: a file may bring its own levels (for example from Blender), and `assets optimize` keeps them and converts their errors. "Keep 2 sentences" for 97 and 99 together would push that fact into the block or cut it. It belongs in the main text. The measured-error rule at 99 duplicates lod.md:166 and should be a link, not block content.
- 103-129: the referral to "the cluster split finding" is right. Rank 5 in findings/concepts-1-readability.md covers both "Cluster levels" (101-119) and "Pieces of a large level" (121-129), with a fallback of two details blocks. 139 and 145 are covered by rank 11. The JSON form of this finding leaves 139 and 145 out of the edit, but the readability report's full entry points them to rank 11.
- 235: the octahedral atlas and three-view blend are good block content. The sentences on how a card takes the scene's light, and turns with a turned copy, are user-facing and should stay in the main text.
- 23: a 68-word, 5-sentence opening that states the core rule clearly. It is over the limit by one sentence only, and it needs no change.

## Corrected claim

30 paragraphs on concepts/lod are over the limit, and the worst (129, 127, 97, 145, 93) mix user rules with storage and planning detail. That makes the page clearly harder to read: severity medium. The core rule is in the opening paragraph (line 23) and in its own section (131-137). It is pushed down by section order (rank 10), not lost in the long paragraphs.

## Corrected edit

Keep the proposal, with these changes:
- 93: keep 4 sentences in the main text: "The loader downloads the first stage at once. Each later stage waits until a view draws the level that the mesh has now. A level that the camera never draws costs no download. The loader looks again about every 1.5 seconds, so a camera that comes close later still gets the finer stages." Move the 2-second warm-up into the details block.
- 37: cut the governor and fade sentences and link to [Fading between levels](#fading-between-levels). Do not move them, because that section already holds them.
- 97+99: keep in the main text that the tool halves the triangles per level, that `assets.loadGltf` gives each mesh its levels with no code, and that `assets optimize` keeps a file's own levels (for example from Blender). Put vertex order, vertex copies, `MSFT_lod`, `NULL3D_lod_error`, `MSFT_screencoverage` and the 1,080-pixel screen in "Technical details: how the file stores levels". Replace the measured-error rule at 99 with a link to "Fading between levels".
- 235: keep the light and turning sentences in the main text. Put only the octahedral grid, the two atlases and the three-view blend in the block.
- 23: no change.
