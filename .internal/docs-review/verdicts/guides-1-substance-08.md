# guides-1-substance-08

## Finding as given

- Page: guides/deterministic-simulation
- Anchor: "A real game ... 300 files and 26 MB ... 762 files and 226 MB" (line 218) and "A small game scene ... 297 files and 26,057,130 bytes ... 759 files" (line 222)
- Category: duplication. Severity: medium.
- Claim: The same comparison is reported twice with different counts (300 vs 297 files, 762 vs 759). The reader cannot tell if these are two games. Line 220 names "the folder's file and byte limits" without saying whose.
- Evidence: docs/guides/deterministic-simulation.md:218, 220, 222.
- Proposed edit: Keep one sentence: "A small game drew with 5 words. Its folder held about 300 files and 26 MB, against about 760 files and 226 MB with the 172-word example list." Move exact bytes, the Brotli size and the 4.1 GB full set into a "Technical details: measured folder sizes" block. Name the real limit (a host's file limit) or drop it.

Verdict: survives

## Evidence

- docs/guides/deterministic-simulation.md:218 ends with "A real game recorded this way drew with 5 words, and its folder held 300 files and 26 MB. The same folder built with the 172-word example list held 762 files and 226 MB."
- docs/guides/deterministic-simulation.md:222 opens with "A small game scene with three lanes and a ship drew with 5 words. Its folder held 297 files and 26,057,130 bytes ... 759 files and 225,683,678 bytes." Same word count (5), same 172-word baseline, sizes that agree to the MB, file counts 3 apart. The page gives no hint whether this is one game or two.
- The two passages came from two commits: 1be201004 (#557) added the 297-file text, bb882f565 (#559) added the 300-file text. That looks like one game measured twice, but a reader cannot know it.
- docs/guides/deterministic-simulation.md:220 says "That can exceed the folder's file and byte limits." No limit is named on this page. docs/getting-started/hosting.md, which the page links for the files folder, has no mention of a file or byte limit (grep for "limit" finds nothing). So the reader cannot learn whose limit it is.
- The proposed details block fits the user's request: the exact bytes, the Brotli size and the full-set size are correct, dense detail for implementers, and the main text stays clear with the block closed. No heading or nesting is proposed.

## Notes on the edit

- Keep the last two sentences of line 222 ("Record again after the game gains a feature..." and "The engine names a word that the set lacks...") in the main text. They are guidance, not measurements.
- For line 220, either name the limit concretely (for example "a static host's limit on file count or file size") or cut the sentence to "Narrow the set first, because the full set is about 4 GB." The 4.1 GB figure alone makes the point.
