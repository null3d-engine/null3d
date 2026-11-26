# guides-1-substance-07

## Finding as given

- page: guides/audio, api/sound
- anchor: Sources at places: near: 6, far: 200 (lines 75, 94); table row 'A waterfall' 5 / 400 (line 86); line 91
- category: contradiction
- severity: medium
- claim: Three places give three ranges for a waterfall: 6/200 in the prose and code, 5/400 in the table on the same page, 4/120 on the API page. Line 91 says a far of a kilometre is heard from the whole map, while the table gives thunder 4000.
- evidence: docs/guides/audio.md:75, 86, 91, 94; docs/api/sound.md:41-42.
- proposedEdit: Use one set of values in all three places, or say the prose example is a small fall unlike the table's large one. Line 91: limit the warning to sources other than thunder.

Verdict: survives

## Evidence

- docs/guides/audio.md:75 says "A waterfall heard across a valley might take `near: 6` and `far: 200`."
- docs/guides/audio.md:86, in the table directly below, gives "A waterfall, which is loud and carries | 5 | 400".
- docs/guides/audio.md:94, the code under the table, uses `near: 6, far: 200` again.
- docs/api/sound.md:41-42 says "full within 4 m and gone by 120 m" and uses `near: 4, far: 120`.
- docs/guides/audio.md:89 gives thunder a `far` of 4000, and line 91, two lines later, warns that a `far` of a kilometre is heard from the whole map and makes the opening view roar. The warning has no exception for the row just above it. The table's own guidance at line 77 says to pick `far` as the distance at which a listener would stop hearing the thing, so the thunder row is deliberate, and the warning reads as if it rules that row out.
- docs/api/sound.md is a hand-written page, not one under docs/api/reference/, so no generated source applies.

Nothing on either page explains why the values differ (for example a small fall against a large one). A reader who copies the table, the prose or the API example gets three different ranges for the same kind of source. Each value is a plausible example on its own, so the cost is confusion about which to trust, not wrong behavior. Medium fits, at the low end.

## Corrected edit

None needed. One simple fix: change the table row, the prose at line 75 and the code at line 94 to the same pair, and use that pair in docs/api/sound.md:41-42. Change line 91 to say that a `far` of a kilometre or more suits only sounds meant to carry across the whole map, such as thunder.
