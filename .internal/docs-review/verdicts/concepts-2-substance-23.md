# concepts-2-substance-23

## Finding as given

- page: concepts/post-processing
- anchor: Bloom ### Cost, line 114 ("a phone's canvas of 540 x 932 at a base of 128")
- category: contradiction
- severity: low
- claim: Line 101 says Low, which phones run, uses a base of 64. The phone figure uses a base of 128.
- evidence: docs/concepts/post-processing.md:101, 114; docs/concepts/quality-preset-tables.md:63.
- proposedEdit: Give the figure at a base of 64, or write "at a base of 128, which a sketch can set".
- generatedSource: (none)

Verdict: survives

## Evidence

- docs/concepts/post-processing.md:101 says `bloomSize` is 512 on Medium, High and Ultra, "and 64 on Low, which phones run".
- docs/concepts/post-processing.md:114 gives the phone figure "On a phone's canvas of 540 x 932 at a base of 128, it reads about 2.7."
- docs/concepts/quality-preset-tables.md:63 lists `bloomSize` as 64 / 512 / 512 / 512.
- Source agrees with the tables: packages/engine/src/quality/presets.ts:169-173 has `presets: [64, 512, 512, 512]` and allowed values 64, 128, 256, 512. The comment there says Low runs on phones.
- No default path gives a phone a base of 128. The governor halves a larger base once (post-processing.md:107, presets.ts comment), so Medium falls to 256, not 128, and Low's 64 is not raised.
- So the phone example uses a base that no phone gets by default. A reader who compares line 114 with line 101 sees two numbers for "the phone" and cannot tell which cost applies to them. The cost is small, so low severity fits.

## Corrected edit

Both proposed options are fine. Second option is the safe one, because it needs no new figure:
"On a phone's canvas of 540 x 932 at a base of 128, a value a sketch can set, it reads about 2.7."
Use the first option (a figure at 64, the Low default) only if the maintainer can measure or compute the reads at 64 with the same method as the 2.7 and 7.6 figures; do not guess the number.
