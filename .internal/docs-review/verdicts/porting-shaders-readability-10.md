# porting-shaders-readability-10

## Finding as given

- Page: porting/threejs-overview
- Anchor: "## What stays the same", line 94 "Some settings change the look, so check them first when a port looks different:"
- Category: structure. Severity: medium. Role: readability. Slice: porting-shaders.
- Claim: The list of tone mapping, pixel ratio, shadows and light range is the first thing to check when a port looks wrong. It sits under a heading that says nothing changes, so a reader who scans headings misses it.
- Evidence: threejs-overview.md lines 85-99.
- Proposed edit: Give the list its own H2, "Settings that change the look", right after "What stays the same".
- Generated source: none (hand-written page).

Verdict: survives

## Evidence

- docs/porting/threejs-overview.md:85 opens "## What stays the same". Lines 87-92 list six things that do stay the same. Line 94 then starts a second list about things that differ ("Some settings change the look, so check them first when a port looks different"), lines 96-99. The heading outline in stats.json has no heading for this list, so a reader who scans headings or the page's table of contents cannot find it.
- The page itself says to check these settings first, so the claim about their importance is the page's own words.
- I tried to show the advice is covered elsewhere. Tone mapping and pixel ratio are partly repeated in docs/porting/verification.md:39 and :49, and docs/porting/threejs-materials.md:129 and :208. But the shadow advice appears only here and in a table row in threejs-unsupported.md:26, and the light range advice (`distance: 0` against a finite `range`) appears only on this page (line 99). So the overview is the main home for this checklist, and burying it costs the reader.
- The proposed heading is in sentence case, with no emojis, as AGENTS.md "Writing docs" asks. Splitting the section breaks no writing rule and no website contract. The intro sentence on line 94 still reads well under the new heading.

## Corrected claim or edit

None. Optional polish: under the new heading, the intro sentence can drop "Some settings change the look, so" and read "Check these settings first when a port looks different:".
