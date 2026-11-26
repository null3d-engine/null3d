# guides-2-substance-29

## Finding as given

- Page: guides/phones
- Anchor: "## Testing on real devices, line 125: 'the engine silently falls back to WebGL2 at Medium'"
- Category: wrong-claim
- Severity: low
- Claim: Medium is the highest preset that WebGL2 allows. It is not the preset a phone runs, because a phone starts at Low on any path.
- Evidence: phones.md:17; performance.md:93; testing.md:36 ('High on WebGL2 and compatibility runs at Medium').
- Proposed edit: 'On a network address over plain HTTP, the engine silently falls back to WebGL2, which caps the preset at Medium.'

Verdict: survives

## Evidence

- docs/guides/phones.md:125 reads "On a network address over plain HTTP, the engine silently falls back to WebGL2 at Medium." On a page about phones, this reads as "the phone then runs Medium".
- packages/engine/src/quality/chooser.ts:75-76 starts a phone at 'low' and a tablet at 'medium'. Lines 86-87 set 'medium' as the highest preset of WebGL2 and of compatibility mode. So WebGL2 is a ceiling, and a phone stays at Low under it.
- docs/concepts/quality-preset-tables.md:15-29 gives the same: Phone starts at Low; the WebGL2 path's highest preset is Medium.
- docs/concepts/quality-presets.md:65-73 calls it a cap ("The GPU path then caps the preset"), and its example shows Medium only when the page names High.
- phones.md:17 and :34 on the same page say a phone starts at Low and "WebGL2 ... caps the preset further". Line 125 contradicts that wording.
- Nothing nearby fixes the sentence. The previous sentence ("A secure origin is what makes WebGPU, and so the High and Ultra presets, available") hints at a cap, but "falls back to WebGL2 at Medium" still names a preset that runs.

## Edit

The proposed edit is correct and keeps to the writing rules. Low severity is right: the error is in one clause, and the page states the correct rule earlier.
