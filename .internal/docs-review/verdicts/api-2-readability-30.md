# Verdict on api-2-readability-30

## The finding as given

- Page: api/points
- Anchor: long paragraphs at lines 21, 59, 94, 120; error list at line 83
- Category: long-paragraph. Severity: low.
- Claim: Line 21 (100 words) mixes what a point cloud is, how it draws, and the row arrays. Line 83 gives the errors in prose, as the lines page does.
- Evidence: stats.json api/points longParagraphs (stats lines 14, 52, 87, 113); line 83.
- Proposed edit: Cut line 21 to what a point cloud is and how it draws, and move the row-array sentence down. Make line 83 a table of input and error, to match the lines page. Split 94 after 'even when `colors` in the options held 3'.

Verdict: partly

## Evidence

- Stats lines 14, 52, 87 and 113 are page lines 21, 59, 94 and 120 (the front matter takes 7 lines). The four long paragraphs are facts.
- Line 21 (100 words, 5 sentences) holds three topics: what a point cloud is (sentence 1), how it draws (sentences 2 and 3), and the rows in engine memory (sentences 4 and 5). This part holds. The page has a section on the rows (line 87, "The row arrays"), so the row sentences have a home. But "no call per point" is a main reason to use points, so a split after "until its whole square leaves the screen." keeps it in the opening. Moving it down is also fine.
- Line 83: the lines page gives its errors in prose too (docs/api/lines.md:104), and so does the sprites page (docs/api/sprites.md:101). So "make it a table to match the lines page" rests on a false premise. A table would make this page differ from its siblings. Line 83 is not in the stats list of long paragraphs (about 60 words, 5 sentences). Turning it into a table is taste, with no real cost to a reader. Leave it as prose.
- Line 94: the proposed split point is in the middle of a sentence. The sentence goes on with ": the call writes an alpha of 1 then." The right split is after that clause.
- Lines 59 and 120 are in the anchor, but the edit proposes nothing for them.

## Corrected claim

Lines 21, 59, 94 and 120 are long paragraphs. Line 21 mixes what a point cloud is, how it draws, and how its rows live in engine memory. Line 83 gives the errors in prose, like the lines and sprites pages. That is consistent and needs no change.

## Corrected edit

- Line 21: split after "it stays in view until its whole square leaves the screen." The new second paragraph starts "Each point is a row in the batch's typed arrays".
- Line 59: move the E1406 sentence up to follow "A page without points or sprites never downloads it.". Then start a new paragraph at "The [points demo]".
- Line 83: no change.
- Line 94: split after "the call writes an alpha of 1 then." The second paragraph starts "Both arrays are `Float32Array` views of engine memory."
- Line 120: split after "as an instance batch does." The second paragraph starts "The `pointThreshold` option changes the test".
