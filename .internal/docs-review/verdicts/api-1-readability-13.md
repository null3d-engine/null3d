# api-1-readability-13

## Finding as given

- Page: api/assets (hand-written, docs/api/assets.md; no generated source)
- Anchor: long paragraphs at lines 59, 63, 77, 79, 81, 104, 126, 171, 173, 229, 263, 283, 310, 357
- Category: long-paragraph. Severity: medium.
- Claim: Fourteen paragraphs are too long. The worst are line 77 (128 words, 10 sentences, staged models), 310 (125 words, onProgress) and 59 (99 words, hold mode). Line 173 packs required against used extensions and two warnings into one block.
- Evidence: stats.json lines 52, 56, 70, 72, 74, 97, 119, 164, 166, 222, 256, 276, 303, 350.
- Proposed edit: Line 77: add an H3 'Models in stages', with one paragraph on load order and one on maxLevels and cluster bands. Line 310: put the counting rules in a bullet list under one lead sentence. Line 173: split into 'requires' and 'only uses', with the warnings in a third short paragraph. Line 263: make the face order and the size rules two bullets. Line 283: split after the light map sentence. Lines 59, 79 and 81 go to details blocks. Split the rest at the change of subject.

Verdict: partly

## Evidence

- The counts are facts. The stats file lists the same 14 paragraphs. Its line numbers are the page's lines less the 7-line front matter, so the anchor lines (59 ... 357) and the stats lines (52 ... 350) name the same paragraphs. Words and sentences match the claim (77: 128 words, 10 sentences; 310: 125 words, 8 sentences; 59: 99 words, 6 sentences; 173: 97 words, 7 sentences).
- Line 77 has two subjects: the stage load order, then the level limit and cluster bands. A small subheading and a split help. This holds.
- Line 310 is a list of counting rules in prose. A lead sentence and bullets help. This holds.
- Line 173 mixes required extensions, used extensions and the development warnings. The three-way split holds.
- Lines 263 and 283 split cleanly at the change of subject. This holds.
- Line 59 into a collapsed block is mostly right. The testing guide already explains the one-at-a-time loads in hold mode (docs/guides/testing.md:194). But the last sentence of line 59 is a hard rule for handler authors: a glTF extension handler's `load` must not wait for another `assets` call in hold mode, or the two calls wait for each other. No other page states this (no match in docs/guides/testing.md). A reader who writes a handler reads the "Extensions that add-ons read" section, not line 59. Hiding that rule in a closed block, far from the handler docs, costs a reader a deadlock in tests. So that sentence must stay in main text, beside line 171, which already says "`load` may return a promise."
- Line 81 is about the whole `assets` API, not about glTF, yet it sits in the "glTF models" section. Its sentence "Both `registerGltfExtension` and `onProgress` give a function that removes the handler" repeats the calls table (lines 41 and 56). The fact that three calls return at once is real (packages/engine/src/scene/assets.ts:323, :766, :791 return a function or a namespace, not a promise), and line 13 already says that the calls that load and make data return promises. So a details block is fine for the lazy loading of the API code, but the block belongs after the intro or the calls table, and the repeated sentence should go.
- Line 79 into a details block is fine for the worker and the download size. The sentence that `preload` and `onProgress` cover the files a `.gltf` file names is useful to every user and fits better in the "Loading screens" section, or stays in main text.
- Line 104 is five unrelated facts about how the loader treats a mesh. A bullet list reads better than a split at the change of subject. Lines 229 (51 words) and 357 (68 words) are short sentences on one subject; splitting them is polish only.
- The finding does not list the table cell at line 89 (the material row, several hundred words). That is outside a paragraph count, so it is not a fault of this finding, but it is the densest block on the page.

## Corrected claim

The 14 paragraphs are too long, and most proposed breaks are right. The proposal to move line 59 whole into a collapsed block is wrong for its last sentence, and line 81 sits in the wrong section.

## Corrected edit

- Line 77: add an H3 "Models in stages". One paragraph on the load order, one on `maxLevels` and cluster bands.
- Line 310: a lead sentence, then the counting rules as bullets.
- Line 173: three paragraphs: a file that requires the extension, a file that only uses it, the development warnings.
- Line 263: face order and size rules as two bullets. Line 283: split after the light map sentences.
- Line 59: keep one short main-text sentence that loads in hold mode run one at a time and link to the testing guide; put the reason in a details block. Move the handler rule to the end of line 171: "In hold mode, `load` must not wait for another `assets` call. That call waits for the load that runs the handler."
- Line 81: move it after the calls table, drop the sentence that repeats the table, and put the lazy loading of the API code in a details block.
- Line 79: put the worker and the download size in a details block. Keep the sentence about `preload` and `onProgress` in main text.
- Line 104: make the five facts a bullet list.
- Lines 63, 126, 171, 229, 357: split at the change of subject, or leave 229 and 357 as they are.
