# Verdict: api-2-substance-24

## The finding as given

- id: api-2-substance-24 (slice api-2, role substance)
- page: api/impostors
- anchor: long paragraphs at file lines 24, 38, 79, 85, 107, 111, 127, 135, 159, 173, 236, 252 (stats lines 17, 31, 72, 78, 100, 104, 120, 128, 153, 166, 229, 245)
- category: long-paragraph
- severity: medium
- claim: 12 paragraphs are over the length limit. The longest are 24 (158 words: what an impostor is), 79 (174 words: shadows) and 38 (128 words: facing, face culling and levels: false).
- evidence: stats.json api/impostors longParagraphs.
- proposedEdit: Split 24 into 'what an impostor is' and 'how a card lights'. Move into <details> blocks: the face-culling reason and levels: false (38), shadow detail (79), the octahedral fold (85), and the dither phases (236-238). Make 252 a list.
- generatedSource: "" (the page is hand-written; correct)

Verdict: partly

## Evidence

- The 12 lines and the word counts match stats.json. File line = stats line + 7 (the front matter). Stats line 153 is the second line of the bullet at file line 159 ("Bake the views with the engine's baker ..."), so line 159 is the right anchor.
- The claim holds. The proposed edit is incomplete, and two parts of it are too broad.
- Incomplete: the edit treats only 6 of the 12 paragraphs (24, 38, 79, 85, 236, 252). It gives no fix for 107, 111, 127, 135, 159 and 173. The review rule puts all long paragraphs of a page in one finding, so the finding must also say how to fix every one of them.
- Too broad, line 79: this paragraph holds the user-facing switches for card shadows. These are `castShadows: true` with a sun-only layer, `receiveShadows: true` and `castsStill: false`. `castsStill` is a real option, and its default is true (packages/impostors/src/batch.ts:103, :216). If all of "shadow detail" goes into a closed block, the main text no longer says how to turn shadows on. Only the reasons can move: the coverage test, the contact-shadow march that sees a wall, and the cached far cascades.
- Too broad, line 236: its first two sentences are user-facing. They say that the meshes draw from `start` up to the switch, and that a coarser level passes the start of its own band. These must stay in the main text. The rest of 236 (the `EDGE_BAND` share and why the cards start earlier) and all of 238 can move into one block.
- The other parts hold. Line 24: sentences 1-6 explain what an impostor is, and sentences 7-9 explain the light, so the split falls at a natural place. Line 38: the culling reason and `levels: false` are internal, so they can go in a block, but "the cards draw both faces" stays in the main text. Line 85: the octahedral fold (the front half in the diamond, the back half in the corners, the back pole) is implementer detail. The `frameDirection`/`impostorFrame` pair stays in the main text. Line 252: the per-attribute rules read well as a list.

## Corrected claim

12 paragraphs are over the limit. The longest are 79 (174 words), 24 (158) and 38 (128). The proposed edit fixes only 6 of them. On 79 and 236 it would also hide options that users must set.

## Corrected edit

- 24: split before "The card blends the three stored views". The first part is what an impostor is. The second part is how a card blends views and lights.
- 38: keep the facing sentence and "the cards draw both faces" in the main text. Move the face-culling and shadow-pass reason and `levels: false` into a `<details>` block.
- 79: keep in the main text how to enable casting (`castShadows: true` plus a layer that only the sun draws), `receiveShadows: true`, and "pass `castsStill: false` when the cards of a casting batch turn from frame to frame". Move the reasons into a `<details>` block: the coverage test, why a card takes only shadow-map shadows, and why still cards keep the far cascades cached.
- 85: keep the `frameDirection`/`impostorFrame` sentences. Move the `encodeOctahedral`/`decodeOctahedral` fold into a `<details>` block.
- 107: break after "never color the picture". Then put the `room` explanation (the picture holds the view from above, so it is taller by `room`) in a `<details>` block, or start a new paragraph at "It returns the card's `size`".
- 111: start a new paragraph at "`loadImpostorAtlas(assets, url)` loads the three files."
- 127: start a new paragraph at "The loader throws".
- 135: keep the first two sentences. Move the measured history ("The island's trees once baked ... 34 to 79 per cent ...") into a `<details>` block, or cut it. It is a story about one project, not guidance.
- 159: cut the bullet to its rule (use the engine's baker unless the card stays within a few tens of pixels) and to the reason why a hand-painted view fails. Move the island's measured pixel sizes into a `<details>` block, or cut them.
- 173: break after the first sentence. Also note that the views and texels figures repeat the bullets at 151-156, so the two sections can share one statement.
- 236-238: keep the first two sentences of 236 in the main text. Move the `EDGE_BAND` share, why the cards start earlier, and all of 238 into one `<details>` block.
- 252: make the attributes and the transform rules a list: normals (inverse transpose), tangents, and mirrored copies (winding reversed, tangent sign flipped).
