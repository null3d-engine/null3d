# concepts-1-substance-23

## Finding as given

- page: concepts/assets
- anchor: File lines 25, 29, 49, 59, 61, 63, 67, 118, 126 (stats 18, 22, 42, 52, 54, 56, 60, 111, 119); line 67 "`assets.loadTexture` loads PNG, ..." (146 words)
- category: long-paragraph
- severity: low
- claim: Line 67 holds four topics: formats, decoders, transcoding workers and the cache. Line 118, on meshopt blocks over 256 MiB, is implementer detail.
- evidence: stats.json concepts/assets.
- proposedEdit: Split line 67 into image formats and KTX2 transcoding. Put line 118 in <details><summary>Technical details: meshopt blocks and the 256 MiB limit</summary>.

Verdict: partly

## Evidence

- docs/concepts/assets.md:67 does hold the topics the finding names. Sentences 1-4 cover the image formats, browser decoding and E1412. Sentences 5-10 cover KTX2 transcoding: which workers do it, the GPU memory gain, when the transcoder downloads, and the cache. A split after "fails with E1412." is a clean break.
- docs/concepts/assets.md:118 explains why a meshopt block can pass the per-array limit of 256 MiB in the table (line 105) and still load. This is implementer detail. The reader's action ("split the scene into several files") is already in line 116, so the main text still makes sense with the block closed. Lines 116 and 120 read on without it, and the table row at line 106 ("with each block of meshopt data") stays clear without it. The proposed summary follows the block format.
- What does not hold: the finding lists nine long paragraphs but proposes edits for only two of them. The instructions say one finding covers all the long paragraphs of a page. The finding has no edit for:
  - line 25 (114 words, 7 sentences, the intro)
  - line 63 (95 words, 7 sentences, the advice on Draco and meshopt)
  - lines 29, 49, 59, 61 and 126 (5 to 6 sentences each)
- The proposed split of line 67 still leaves the KTX2 half at about 85 words and 6 sentences, which is over the 4-sentence mark.

## Corrected claim

Line 67 mixes image formats with KTX2 transcoding, worker placement, the download and the cache. A split into two parts alone still leaves one long paragraph. Line 118 is implementer detail, and a collapsible block suits it. The finding also leaves the other long paragraphs on the page without edits, most of all line 25 and line 63.

## Corrected edit

- Line 67: break it after "fails with E1412." Then break it again before "The transcoder downloads when the first KTX2 file loads". Move "These are the engine's job workers, which take the work between frames, or one worker of its own where no job worker can." into a `<details><summary>Technical details: which workers transcode KTX2 data</summary>` block placed after the paragraph. Keep "A frame never waits for them." in the main text.
- Line 118: put it in `<details><summary>Technical details: meshopt blocks and the 256 MiB limit</summary>`, as proposed, after line 116.
- Line 25: break it before "Files download and decode outside the sketch's frames." That gives one paragraph on prefabs and one on loading and memory.
- Line 63: break it before "Draco does not compress animation clips or morph targets." That gives one paragraph on when Draco is smaller and one on animated files and Blender.
