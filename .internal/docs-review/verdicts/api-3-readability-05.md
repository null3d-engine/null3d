# Verdict: api-3-readability-05

## The finding as given

- Page: api/water, api/sound, api/wind
- Anchor: water line 477, sound line 168, wind line 374
- Category: structure. Severity: medium.
- Claim: On these three pages the link to the generated reference is a loose paragraph at the end of "Costs and limits", with no "## API reference" heading. On api/water it also sits above Related pages. api/wind has no Related pages section.
- Evidence: stats.json headings for the three pages have no "API reference". AGENTS.md "Docs and skills stay in sync" rule 5: the written page links to it under its "API reference" heading.
- Proposed edit: End each page with "## Related pages" (add one to api/wind: grass, water, materials, features, quality), then "## API reference" as the last heading with the existing link paragraph under it. Optionally make the docs check test for the heading.

Verdict: survives

## Evidence

- docs/api/water.md: the reference link paragraph is at lines 477-478, inside "## Costs and limits" (line 436), and "## Related pages" follows at line 480. No "## API reference" heading.
- docs/api/sound.md: the link is at lines 168-169, the last lines of "## Costs and limits" (line 160). No "## API reference" heading.
- docs/api/wind.md: the link is at lines 374-375, the last lines of "## Costs and limits" (line 365). No "## API reference" heading and no "## Related pages".
- AGENTS.md line 216 (rule 5): "The written page links to it under its 'API reference' heading". The three pages break that rule.
- Of the 40 pages in docs/api/, 35 have a "## API reference" heading; 26 of those make it the last heading, after "## Related pages". These three pages are the exceptions that have a reference page (docs/api/reference/water.md, sound.md, wind.md exist).
- The docs check (tools/lib/docs.ts, referenceLinkProblems, lines 670-681) tests only that the page text includes the link, not the heading. So the check passes these pages, and the optional extra check would catch the gap.
- The wind page links only to grass.md and its reference page, so a Related pages section adds real navigation. Water reads a wind field (water.md lines 142-143, 171-173), the wind page has a section on reading the field in custom WGSL (materials), and its presets section is about the governor (quality). The proposed list fits.

## Note on the edit

The claim is correct, but it misses one gap: api/sound has no "## Related pages" section either. The edit says "end each page with Related pages", but names a list only for wind. For sound, a fitting list is: assets (loading the sound files), getting-started/hosting (cross-origin isolation), and quality (the presets that drop the HRTF panner).
