# Verdict for api-2-readability-10

## The finding as given

```json
{
 "page": "api/impostors",
 "anchor": "long paragraphs at lines 24, 38, 79, 85, 107, 111, 127, 135, 160, 173, 236, 252",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Line 79 holds five shadow rules in 174 words. Line 24 explains the whole technique in 158 words before any code. Line 38 mixes the create call with the reason the shadow pass culls front faces.",
 "evidence": "stats.json api/impostors longParagraphs: 174 words at stats line 72, 158 at 17, 128 at 31 (file line = stats line + 7).",
 "proposedEdit": "79: add '### Shadows of the cards' as a list (castShadows and the sun-only layer, receiveShadows, no contact shadows, cached cascades, castsStill: false). 24: keep three sentences, and move the turn and light reasoning to a details block. 38: move the both-faces reason to a details block. 85: put frameDirection and impostorFrame in a table, and the fold in a details block. 236-238: put them in <details><summary>Technical details: how the two dither bands avoid gaps</summary>. 252: make a list.",
 "generatedSource": "",
 "id": "api-2-readability-10",
 "slice": "api-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The line offset holds: the page has 7 front-matter lines, so stats line 17 is file line 24, 31 is 38 and 72 is 79. All twelve anchors match the stats entries.
- docs/api/impostors.md:79 holds five separate shadow rules in 174 words: cast with a sun-only layer, receive at the stored depth, no contact shadows, cached far cascades, and `castsStill: false`. A heading and a list fit. The heading "### Shadows of the cards" is sentence case and sits under "## Create the cards", outside any block, so it breaks no rule.
- docs/api/impostors.md:24 is 158 words and 9 sentences, after the diagram and before any code. Its last three sentences are the turn and light reasoning. A details block for them is right, and the main text still reads without them.
- docs/api/impostors.md:38 mixes what the call makes with the shadow pass's front-face culling. Moving the reason why both faces draw into a block is right.
- The page is hand-written, so an empty generatedSource is correct.

## What does not hold

1. Lines 236 to 238 can't all go into a details block. Line 236 is usage: the meshes draw from `start` (0 by default) up to the switch, and a coarser level's batch passes the start of its own band. That is the only place the page explains the fourth argument of `handOverToCards` (line 224). With the block closed, a reader would not know what `start` does. Only the dither detail is implementer depth: the edge band's 8 per cent share, the cards starting earlier by the largest card's size, the dither phases (line 238) and sky showing through.
2. Line 24, "keep three sentences": the core idea (a bake draws views into atlases, one card faces the eye, it blends the three nearest views, it lights from the stored normals, many cards draw in one batch) needs about six sentences. Name what stays: keep sentences 1 to 6 and the last one, and move only the two turn sentences (the turned tree and the light staying on the tree's side) into the block.
3. Line 85: `encodeOctahedral` and `decodeOctahedral` are public exports. Keep one main-text sentence that names them and says they fold directions onto one square. Move only the diamond, corners and back-pole detail into the block. A two-row table for `frameDirection` and `impostorFrame` is a matter of taste; a two-item list does the same job.
4. The anchor lists lines 107, 111, 127, 135, 160 and 173, but the proposed edit gives no change for them. The finding is incomplete there, though it is not wrong. Lines 135 to 169 and 173 to 191 also repeat the same view and texel figures in two sections, which is its own issue.

## Corrected claim

Lines 24, 38 and 79 are long, and the proposed changes for them work, with line 24 keeping its core six sentences, not three. Lines 236 to 238 must keep the meaning of `start` and the coarser level's band in the main text. Only the band arithmetic and the dither-phase reason go into the block.

## Corrected edit

- 79: add "### Shadows of the cards" with a five-item list: castShadows with a layer the sun draws and no camera does; receiveShadows at the stored depth; no contact shadows; the far cascades stay cached; `castsStill: false` for cards that turn each frame.
- 24: keep sentences 1 to 6 and "Many cards draw in one instance batch." Move the two turn and light sentences into `<details><summary>Technical details: how a card's turn and light follow its mesh</summary>`.
- 38: keep the call, the facing rule and the view blend. Move the both-faces and front-face-culling reason, and the `levels: false` note, into `<details><summary>Technical details: why the cards draw both faces</summary>`.
- 85: make `frameDirection` and `impostorFrame` a two-item list or a table, and keep one sentence that names `encodeOctahedral` and `decodeOctahedral`. Move the diamond, corners and back-pole detail into `<details><summary>Technical details: how the octahedral fold covers the sphere</summary>`.
- 236: keep in the main text "The meshes draw from `start`, 0 by default, up to the switch. A coarser level's batch passes the start of its own band. The cards start a little before the switch, so the two overlap." Move the edge band share, the largest-card arithmetic and all of line 238 into `<details><summary>Technical details: how the two dither bands avoid gaps</summary>`.
- 252: make a list of the kept and optional attributes and the three transform rules (normals by the inverse transpose, tangents turn, mirrored copies flip winding and tangent sign).
- 107, 111, 127, 135, 160, 173: split each into shorter paragraphs. Handle the two sections that repeat the view and texel figures (135 to 169 and 173 to 191) as a separate finding.
