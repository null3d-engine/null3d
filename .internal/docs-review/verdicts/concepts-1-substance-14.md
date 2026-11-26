# concepts-1-substance-14

## Finding as given

- page: concepts/lighting
- anchor: ### Cost (lines 264-284), ### Cost of probes (319-325), ### Background cost (506-514), WebGL2 texture-unit bullet line 275; long paragraphs at file lines 76, 92, 94, 112, 114, 142, 146, 154, 168, 176, 178, 254, 329, 331, 335, 377, 417, 500, 518
- category: wall-of-text
- severity: medium
- claim: The page is 9,783 words. Its cost sections hold download sizes, MacBook and phone timings and texture-unit budgets. Implementers need these, but they break up the explanation for everyone else. Line 275 alone is about 120 words on WebGL2 texture units.
- evidence: stats.json concepts/lighting (9,783 words, 19 long paragraphs).
- proposedEdit: Put each cost list in `<details><summary>Technical details: download sizes, memory and timings</summary>`, with one plain sentence above it. Put line 275 in its own block, "Technical details: texture units on WebGL2". Move the device timing table (lines 277-284) into the "### Cost" block.

Verdict: partly

## Evidence

- The counts hold. stats.json gives 9,783 words and 19 long paragraphs. The stats lines are body lines; they are 7 less than the file lines the finding gives (stats 85 = file 92), so the finding's file lines are right.
- Line 275 is 132 words (wc), not "about 120". That is a small error.
- Some bullets really are dense. Line 267 is 92 words, line 271 is 146 words, line 275 is 132 words. The timing table (277-284) and the memory figures (268, 272, 322-323, 512) are numbers that only an implementer tunes against. A block suits them.
- The claim that the cost sections "break up the explanation" is weak. Each one is its own `###` heading at the end of its section (264, 319, 506), after the explanation is done. A reader who does not care can skip the heading.
- Wrapping each whole list hides advice that every user needs. With the blocks closed, a reader would lose:
  - line 270: ask for the room while the scene loads, because a call during play makes one long frame (3 to 7 frames on a phone);
  - line 267, last sentence: load HDR files while the scene loads;
  - line 509: an opaque material with `depthWrite: false` or `depthTest: false` makes every pixel pay for the background (a trap);
  - line 510: `cloudCoverage: 0` skips the clouds;
  - line 324: WebGL2 devices without half-float targets get no probe light (a visible fallback);
  - line 275: a custom material with too many textures fails with E1209 (docs/errors/E1209.md exists).
  "One plain sentence above it" cannot carry all of this. So the edit as given breaks the rule that the main text must make sense with every block closed.
- The anchor lists 16 long paragraphs outside the cost sections (76 through 518), but the edit does nothing for them. This half of the finding has no fix.
- The page has a fourth cost section, "### Limits and cost" (352-358), that the edit leaves out. The cost sections would be handled in different ways.

## Corrected claim

The page is long (9,783 words, 19 long paragraphs), and some cost bullets are dense measurement detail: lines 267, 271 and 275 are 92 to 146 words each, and the timing table sits in the main text. The cost sections already have their own headings at the end of each section, so they do not break up the explanation. Many of their bullets are short advice that every user needs.

## Corrected edit

Keep each cost heading and its short advice bullets in the main text: 270, the last sentence of 267, 509, 510, 511, 324, and one sentence from 275 ("On WebGL2 a custom material can use only the texture units that the lighting leaves; the engine refuses one with too many with [E1209](../errors/E1209.md). WebGPU has no such limit."). Move the measurements into one block per section:

- "### Cost": `<details><summary>Technical details: download sizes, memory and timings</summary>` with the reader and worker sizes and timings from 267, all of 268, 269, 271 (the 20-stage refresh), 272-274 and the table at 277-284 with its lead sentence. Put the rest of 275 (the 13-unit budget and which maps drop first) in a second block, "Technical details: texture units on WebGL2".
- "### Cost of probes": a block for 322-323 (capture passes and memory).
- "### Background cost": a block for 512-514 (memory, uniform updates, cube map upload).
- "### Limits and cost" (352): do the same for its memory and texture-layout bullets, so all four cost sections match.

Report the 16 long paragraphs outside the cost sections (file lines 76, 92, 94, 112, 114, 142, 146, 154, 168, 176, 178, 254, 329, 331, 335, 377, 417, 500, 518) with their own proposed breaks or blocks. This edit does not fix them.
