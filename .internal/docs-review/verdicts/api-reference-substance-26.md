# api-reference-substance-26

Finding as given:

- page: api/reference/impostors
- anchor: impostors.md:96 `HAND_OVER_GROUPS`; :37 `Direction`
- category: unclear; severity: low
- claim: HAND_OVER_GROUPS's summary also explains the spread (HAND_OVER_SPREAD) and says 'a tree's own swap is as it was', which compares with an older behavior. Direction says 'this module makes it unit length' with no module in view.
- evidence: packages/impostors/src/hand-over.ts:17-25; packages/impostors/src/octahedral.ts:13.
- proposedEdit: HAND_OVER_GROUPS: 'The number of groups that a plant's trees hand over in. Trees in different groups swap to their cards a little before or after one another, so a frame loses one group's cards at a time.' Direction: 'It need not have length 1: the functions on this page normalize it.'
- generatedSource: packages/impostors/src/hand-over.ts, packages/impostors/src/octahedral.ts

Verdict: partly

Evidence:

- impostors.md:102 (from hand-over.ts:17-25) does say the constant is both "the groups" and "how far either side ... the groups' switches spread". The spread is HAND_OVER_SPREAD (hand-over.ts:33, impostors.md:110), and handOverSwitches takes the two as separate arguments (hand-over.ts:43-47). So the summary gives this constant a second job it does not have. "a tree's own swap is as it was" compares with an older behavior the reader never saw. This half holds, and the proposed HAND_OVER_GROUPS text is correct.
- impostors.md:43 (octahedral.ts:13) says "this module makes it unit length". On a reference page the reader sees no module. This half holds too.
- The proposed Direction text overclaims. encodeOctahedral, impostorFrame and encodeImpostorSurface ignore the length: they divide by the sum of the absolute values (octahedral.ts:74-81, surface.ts:31). nearestFrame scales its first argument to length 1 (octahedral.ts:189-192), but it does not scale the entries of its list. It compares plain dot products (octahedral.ts:195-197), so a longer entry in the list can win over a closer one. Also decodeOctahedral and frameDirection return a Direction, and those results are always unit length. "The functions on this page normalize it" is therefore not true for every place a Direction appears.

Corrected claim: Both summaries are unclear as the finding says. But the proposed Direction text is wrong for the list of views that nearestFrame takes, which the code does not scale.

Corrected edit:

- HAND_OVER_GROUPS (hand-over.ts:17-22): "The number of groups that a plant's trees hand over in. Trees in different groups swap to their cards a little before or after one another, so a frame loses one group's cards at a time. HAND_OVER_SPREAD sets how far apart the groups' switches are."
- Direction (octahedral.ts:13): "A direction, three numbers. A direction you pass in need not have length 1, and only its way counts. The one exception is the list of views that nearestFrame compares against: give those at length 1. Directions that the functions return have length 1."
