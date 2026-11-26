# Verdict: api-2-readability-04

## Finding as given

- Page: api/post
- Anchor: ## Errors, line 472 (E1213 row)
- Category: wall-of-text. Severity: medium.
- Claim: The E1213 cell lists every range check of every effect in one 336-word run-on paragraph. Nobody can scan it, and each effect's settings table already gives its ranges.
- Evidence: line 472: 336 words in one table cell, from 'A ninth effect.' to 'an `ev100` outside -20 to 30.'
- Proposed edit: Shorten the cell to: 'A ninth effect, a setting that the engine does not have, a tone mapping it does not know, or a value outside the range that the setting's table gives.' Under the table, add <details><summary>Technical details: every value that throws E1213</summary> with one bullet per effect. You can also move that list to the E1213 error page through packages/engine/src/errors/fixes.ts.

Verdict: partly

## Evidence

- docs/api/post.md is hand-written (front matter status "experimental", not "generated"), so the edit goes in that file directly.
- Line 472 is one table cell with the full list. The other rows in the same table (E1203, E1204, E1215, E1216, E1101) are one short sentence each, so this row stands out.
- The claim that the settings tables already give the ranges holds. I checked them one by one: ev100 -20 to 30 (line 30); percentiles, centerWeight, speedUp/speedDown, minEv/maxEv/compensation -20 to 20 and maxEv no lower than minEv (lines 97-103); bloom intensity/threshold/knee/blend/weights (131-135); ao distanceFalloff, distanceExponent, samples 1 to 64, intensity (165-169); ssr maxDistance above 0 and maxRoughness 0 to 1 (206-208); dof focusDistance, maxBlur 0 to 0.1, blades 0 or 3 to 12, focusPoint (248-253); outline width (291); lut and lutIntensity (322-323); white balance 1667 to 25000, lift, gamma, gain, saturation, split toning (354-363); vignette falloff and roundness (387-388); sharpen 0 to 1 (408). The limit of 8 effects is on line 455.
- So the cell repeats the tables in a form that a reader cannot scan. The core of the finding survives.

## What does not hold

1. The proposed short cell says "a value outside the range". Several checks in the cell are not ranges: a value of the wrong kind (not settings, a number or `false`), a `metering` that is not one of two words, a `lut` that is not a loaded table, a `focusPoint` that is not three numbers, and `minEv` above `maxEv`. The short text must cover these too.
2. The option to move the list to the E1213 error page through fixes.ts is wrong. E1213 is shared by many calls (built-in environments, glTF extension handlers and others, per docs/errors/E1213.md). The post-processing ranges do not belong on that shared page, and its "How to fix it" text already sends readers to the call's own page.
3. A details block that repeats every range is optional, not required. The tables already hold each range next to its setting, so a second full copy can drift from them. If the block is kept for implementers, it should hold only the checks that the tables do not state, such as the combined rules (minEv not above maxEv, bloom weights not all 0, the `'mix'` blend capping intensity at 1).

## Corrected edit

Replace the E1213 cell with:

"A ninth effect, a setting that this version does not have, a tone mapping that the engine does not know, or a value that the setting's table does not allow: the wrong kind of value, or a number outside its range."

Optionally, under the Errors table, add a details block (summary "Technical details: checks that span more than one setting") for the cross-setting rules only. Do not move the list to the E1213 error page.
