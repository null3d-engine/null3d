# concepts-1-readability-25

## Finding as given

- page: concepts/assets
- anchor: lines 25, 29, 43, 49, 59, 61, 63, 67, 118, 126
- category: long-paragraph
- severity: medium
- claim: Ten long paragraphs. The opening (25, 114 words) repeats the diagram and every section. Line 67 (146 words) mixes image formats, errors, KTX2 transcoding and the cache. The meshopt and Draco story spreads over five paragraphs (49-63).
- evidence: stats.json concepts/assets longParagraphs
- proposedEdit: 25: keep the first 3 sentences. 49-63: add a table 'Format | Decoder size | Use it for' for meshopt (4 KB, the default, animated files) and Draco (60 KB, large static scans and product models, 14 to 27% smaller), then one short paragraph each on fallback buffers and E1416, and on stored integer types. 67: three paragraphs (images and E1412; KTX2 transcode and memory; cache). 118: move into a block 'Technical details: limits inside meshopt blocks' under the limits table. Split 29, 59, 61 and 126. For 43, see the extension-list finding.

## Verdict: partly

## Evidence

- stats.json lines are offset by the 7-line front matter; the finding's anchors match page lines (stats 18 = page 25, stats 60 = page 67, and so on). All ten paragraphs are flagged. Fact.
- Page line 25 does restate the diagram (lines 13-23): prefab, outside-frame decode, KTX2 stays compressed, integer types, per-frame upload budget. It does not cover every section: it says nothing on Draco, the file limits (99-120), texture memory budget (126) or freeing memory (128). "Repeats every section" is overstated.
- Line 67 (146 words, 10 sentences) holds four topics: image formats and E1412, KTX2 transcode workers, memory ratio, transcoder download and cache. A three-way split is right.
- Lines 49, 57, 59, 61, 63 are five paragraphs on meshopt and Draco. The decoder sizes (about 4 KB and 60 KB after Brotli), the lazy download and compile-once facts repeat for each format. A table removes that repeat. Correct.
- Line 118 is implementer detail (index lists packed into one block, block may pass 256 MiB, only the file total limits it, each array still within 256 MiB). A details block after line 116 fits the rule. But its last two sentences (the optimize command never writes a model past either limit; its error tells you to split) are advice to a reader and must stay in the main text.
- Lines 29 (74 words, 5 sentences), 59 (61 words, 5), 61 (65 words, 5) and 126 (58 words, 5) are short and pass the sentence limit by one. Each holds one idea. Splitting them is low value. Also, 59 and 61 are rewritten by the table edit, so a separate "split" instruction for them conflicts with that edit.
- Cutting line 25 to three sentences drops sentence 4 ("Files download and decode outside the sketch's frames"), which the diagram only shows in its labels. Keep it as a fourth sentence.

## Corrected claim

Ten paragraphs pass the length rule. Three are clearly long: the opening (25) repeats what the diagram shows; line 67 mixes four topics; the meshopt and Draco facts repeat over five paragraphs (49-63). Lines 29, 59, 61 and 126 pass the limit by one sentence only, and each holds one idea.

## Corrected edit

- 25: keep the first four sentences (up to "outside the sketch's frames"); drop the KTX2, integer and budget sentences, which the diagram and the sections cover.
- 49-63: one short paragraph on meshopt, then a table "Format | Decoder after Brotli | Use it for": meshopt (about 4 KB; every model, and the only choice for files with animation clips or morph targets) and Draco (about 60 KB; large static meshes such as scans and product models on a page that loads several hundred KB of them, where it is 14 to 27% smaller). Say once, under the table, that each decoder downloads with the first file that needs it and compiles once per page. Keep short paragraphs on: the two extension names, fallback buffers and E1416; the integer types the loader stores for Draco data and the development warning; converting with the optimize command and the Blender note.
- 67: three paragraphs (images, browser decode and E1412; KTX2 transcode workers and memory; transcoder download and cache).
- 118: move the first four sentences into `<details><summary>Technical details: limits inside meshopt blocks</summary>` after line 116. Keep the last two sentences in the main text.
- 29, 59 (outside the table rewrite), 61 (outside the table rewrite) and 126: leave as they are.
- 43: see the extension-list finding.
