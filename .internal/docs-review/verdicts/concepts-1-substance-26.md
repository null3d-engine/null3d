# concepts-1-substance-26

Finding as given:

- page: concepts/lighting, concepts/color-management, concepts/lod
- anchor: lighting line 335 "colour", "coloured", line 357 "metre"; color-management line 77 "honours"; lod lines 107, 111 "Neighbours", "neighbours"
- category: polish, severity: low
- claim: These lines use British spellings. The rest of the docs and the API use American spellings (color, meter, colorSpace).
- proposedEdit: Write color, colored, meter, honors and neighbors.

Verdict: partly

Evidence:

- The named lines do hold the British spellings: concepts/lighting.md:335 ("colour", "coloured"), :357 ("metre"); concepts/color-management.md:77 ("honours"); concepts/lod.md:107 ("Neighbours"), :111 ("neighbours").
- On these three pages American spelling dominates: "color" appears about 50 times on lighting and 65 times on color-management. Across docs/, American forms are far more common (meters about 313, center 166, gray 33, neighbors 13, colored 15). So the edit is right for these lines.
- The claim "the rest of the docs use American spellings" is wrong. British forms also appear on other pages:
  - Hand-written: api/terrain.md:11, 21, 86 (neighbours); api/engine.md:97 (honour, honours); api/scene.md:387, 393 (grey); api/controls.md:235 (metres); guides/baked-light-data.md:122, 130, 174 (colour); shaders/surface-functions.md:541, 544, 546 (colour).
  - Generated from TSDoc in packages/*/src: api/reference/engine.md:198 (honour, honours); api/reference/geometry.md:356, 360 (centre); api/reference/impostors.md:19, 164, 176, 181, 221, 228, 230, 232, 278, 304 (colour, colours; for example "The colour atlas's PNG file" beside the field `color`); api/reference/terrain.md:84, 123, 148; api/reference/water.md:176, 367.
  - Generated from docs/data/threejs-mapping.json:695, 1993 into porting/threejs-mapping.md:105, 124 (neighbours).
- Fixing only the three concept pages leaves the same mix on about ten other pages, so a reader still sees both spellings.

Corrected claim:

British spellings (colour, coloured, metre, metres, honour, honours, neighbour, neighbours, centre, grey) appear on many docs pages, while most of the docs and the API use American spelling. This is one cross-page issue, not three pages.

Corrected edit:

Use American spelling everywhere in docs/. Fix the named lines on concepts/lighting, concepts/color-management and concepts/lod, and also the hand-written pages api/terrain, api/engine, api/scene, api/controls, guides/baked-light-data and shaders/surface-functions. For the generated pages, edit the sources: the TSDoc comments in packages/*/src that feed api/reference/engine, geometry, impostors, terrain and water, and docs/data/threejs-mapping.json (entries near lines 695 and 1993) for porting/threejs-mapping. Optionally add a spelling rule to the "Writing docs" section of AGENTS.md so the docs check can catch new cases.
