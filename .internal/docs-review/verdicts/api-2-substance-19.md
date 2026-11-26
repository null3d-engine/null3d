# Verdict for api-2-substance-19

## The finding as given

- Page: api/post
- Anchor: ## Errors, row E1213 (line 472)
- Category: wall-of-text
- Severity: medium
- Claim: The E1213 cell lists about 40 causes in one run of text of about 400 words. A reader with an E1213 cannot find their cause.
- Evidence: docs/api/post.md:472.
- Proposed edit: Shorten the cell to 'A setting or value that post.set or post.addEffect does not take, such as a value outside its range.' Below the table, add <details><summary>Technical details: every cause of E1213</summary> with a list grouped by effect.
- Generated source: none (docs/api/post.md is a hand-written page)

Verdict: partly

## Evidence

- docs/api/post.md:472 holds the E1213 cell. It is one run of text of 336 words (not about 400). It lists several dozen causes across every effect in one block of prose. The problem is real: a reader cannot scan it for their setting.
- The proposed details block below the table would repeat detail that the page already shows. Each range in the cell is in the settings table of its own section on the same page:
  - ev100 -20 to 30: line 30.
  - automatic exposure metering, percentiles, centerWeight, minEv, maxEv, compensation: lines 96-103.
  - bloom intensity, blend, weights: lines 131-135.
  - ambient occlusion distanceExponent, samples: lines 165, 168.
  - ssr maxDistance, maxRoughness: lines 206, 208.
  - depth of field maxBlur, blades, focusPoint: lines 249-253.
  - lutIntensity: line 323. Grading white balance, lift, gamma, split toning: lines 354-363.
  - vignette roundness: line 388.
  - At most 8 effects: line 456.
- docs/errors/E1213.md says "The call's docs page lists them." The settings tables already fill that role. A third copy in a details block adds upkeep (three places to change when a range changes) and no information.
- The proposed short cell drops the one cause that is not a setting range: a ninth effect from post.addEffect. "A setting or value that post.addEffect does not take" does not tell a reader that the limit is 8 effects.

## Corrected claim

The E1213 cell is a 336-word run of text that repeats every range from the settings tables above it. It is hard to scan. The detail is not lost if the cell is cut, because each section's settings table already gives the valid values.

## Corrected edit

Do not add a details block. Shorten the cell to name the kinds of cause and point to the tables, for example:

"A ninth effect, because at most 8 run at once. A setting that this version does not have, or a value that a setting does not take, such as a tone mapping that the engine does not know or a number outside its range. Each section's settings table gives the values that a setting takes."
