# concepts-1-readability-04

## Finding as given

- page: concepts/lighting
- anchor: whole page (9,783 words, 25 headings, 6 Mermaid diagrams)
- category: split-page
- severity: medium
- claim: The page covers four page-sized subjects: lights, fog, image-based light and sky with time of day. A reader who wants fog or the sky must scroll past clustering and probes.
- evidence: stats.json concepts/lighting words 9783 and its heading outline
- proposedEdit: Split into: concepts/lighting 'Lights and units' (kinds, units and exposure, clustered shading, lights as objects, ambient and hemisphere, scene passes); concepts/fog 'Fog' (fog, volumetric fog, where the land ends); concepts/environment 'Environment light and probes' (environment maps, reflection probes, light probe grid); concepts/sky 'Sky and time of day' (sky and backgrounds, physical sky, background cost, time of day). Each page gets its own diagram and Related pages. Update the links that point at the old anchors.

Verdict: survives

## Evidence

- stats.json gives 9,783 words, 25 headings, 6 Mermaid diagrams and 19 long paragraphs for this page.
- Word counts per section of docs/concepts/lighting.md (headings at lines 39 to 576) show four clear blocks of about equal weight:
  - Lights (lines 9 to 169): about 2,600 words (intro, kinds, units and exposure, clustered shading, lights as objects, ambient and hemisphere, lights far from the origin).
  - Fog (lines 170 to 206): about 925 words (fog, volumetric fog).
  - Environment light and probes (lines 207 to 360): about 2,900 words (environment maps, how an environment lights a surface, cost, reflection probes, cost of probes, light probe grid and its subsections).
  - Sky and time of day (lines 361 to 571): about 3,050 words (sky and backgrounds 740, where the land ends 560, physical sky 468, background cost 277, time of day 1,009).
  Each block alone is the size of a normal concept page, such as concepts/shadows.
- The page's own front matter summary already lists these subjects as separate items, and the "Related pages" list (line 576) splits by the same lines.
- I could not find a reason to keep them together that outweighs the length. Fog and sky do link to each other (the fog's background share, lines 176 and 417), but a cross-link handles that.
- Inbound anchor links exist and must be moved: #environment-maps (5), #sky-and-backgrounds (3), #clustered-forward-shading (3), #volumetric-fog (2), #units-and-exposure (2), #light-probe-grid (2), #where-the-land-ends (1, docs/api/scene.md:488), #time-of-day (1), #reflection-probes (1), #cost (1, docs/api/assets.md:246). The skills under skills/null3d-develop and skills/null3d-port-threejs also link to concepts/lighting.

## Gaps in the proposed edit (it is right, but incomplete)

- It does not place "Lights far from the origin" (line 166). It belongs on the lights page.
- It does not place "A scene that shows a time of day" (line 158, under ambient and hemisphere lights). It is about the hour, so it fits the sky and time of day page, with a link from the ambient section.
- The page list is generated: the new pages need entries in PAGES in tools/lib/docs.ts (line 99 holds concepts/lighting), so docs/pages.md lists them. The concepts/lighting summary there and in the front matter must shrink to the lights subject.
- The generic anchor #cost (docs/api/assets.md:246) should point at the environment page's cost section.
- Skills link to the page, so the "Docs and skills stay in sync" rule applies: update the skill links in skills/ in the same change.
- Each new concept page must open with its own Mermaid diagram and a plain explanation, per the "Writing docs" rules. The proposal already says this.
