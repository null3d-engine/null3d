# porting-shaders-substance-06

## Finding as given

- page: porting/threejs-mapping, porting/threejs-unsupported, porting/threejs-overview
- anchor: rows 'OrbitControls / MapControls / TrackballControls / ArcballControls' (changed), 'FilmPass / GlitchPass / HalftonePass / AfterimagePass / ...' (manual), 'renderer.shadowMap.enabled / .type (PCFSoftShadowMap, VSMShadowMap)' (changed)
- category: contradiction
- severity: high
- claim: TrackballControls, ArcballControls, AfterimagePass, BasicShadowMap and VSMShadowMap have no equivalent, as the unsupported page says, but the mapping files them under changed or manual. The porting scanner groups and weighs features by mapping status, so an app using them shows no unsupported feature in its inventory.
- evidence: docs/data/threejs-mapping.json (those rows); docs/porting/threejs-unsupported.md:25,30,62; skills/null3d-port-threejs/scripts/analyze-threejs.mjs:149-155
- proposedEdit: Split each row so each feature has one status: 'TrackballControls / ArcballControls: unsupported', 'AfterimagePass: unsupported', 'BasicShadowMap / VSMShadowMap: unsupported', each with the workaround from the unsupported page. Add a docs check that every three.js name on the unsupported page has an unsupported mapping row.
- generatedSource: docs/data/threejs-mapping.json

Verdict: partly

## Evidence

- docs/data/threejs-mapping.json:64-70: the shadow row is "changed". Its "three" cell names VSMShadowMap as if it maps. Its detect regex matches `(PCF|PCFSoft|VSM|Basic)ShadowMap`. Its notes say "BasicShadowMap and VSMShadowMap have no equivalent."
- docs/data/threejs-mapping.json:1615-1621: the orbit row is "changed". Its detect regex matches `(Orbit|Map|Trackball|Arcball)Controls`. Its notes say "Trackball and Arcball controls have no equivalent."
- docs/data/threejs-mapping.json:1846-1852: the post pass row is "manual". Its detect regex matches Afterimage. Its notes say AfterimagePass "has no port".
- docs/porting/threejs-unsupported.md:25,30,62 lists all three as unsupported, with workarounds. The contradiction in status is real.
- Only 2 rows in the whole mapping have status "unsupported" (stereo-camera, xr).
- analyze-threejs.mjs:91-135 keys each hit by mapping row id, so a TrackballControls hit counts as the orbit row. Lines 147-155 group and weigh by that row's status. The summary line "By status: ... unsupported N" (around line 207) therefore counts 0 unsupported for an app that uses only these features. docs/porting/threejs-overview.md:103 tells the reader to settle "the unsupported features with the app's owner" from this inventory, so the wrong count matters.

## What does not hold

The claim that the app "shows no unsupported feature in its inventory" is too strong. The inventory table prints each row's notes (analyze-threejs.mjs, the row loop near line 239). So the row does say "have no equivalent" or "has no port" in its Notes cell. What is wrong is the grouping, the status count and the effort weight, not that the fact is hidden. Severity is better medium than high: a careful reader finds it in the notes, but the status count and grouping mislead.

## Corrected claim

The three rows give an unsupported feature the status changed or manual. Their notes say the feature has no equivalent, but the porting scanner groups, counts and weighs features by row status. So these features land under changed or manual, and the "unsupported" count in the inventory summary misses them.

## Corrected edit

Split the rows as proposed, and also narrow each detect regex so a name matches only one row:
- Orbit row: detect `\b(Orbit|Map)Controls\b`, "three" cell 'OrbitControls / MapControls'. New unsupported row for `\b(Trackball|Arcball)Controls\b`, workaround "createOrbitControls, or your own rotation from ctx.input", docs `porting/threejs-unsupported`.
- Shadow row: "three" cell names PCFShadowMap / PCFSoftShadowMap, detect drops VSM and Basic. New unsupported row for `\b(VSM|Basic)ShadowMap\b`, workaround the shadowFilter quality setting, docs `concepts/shadows`.
- Post pass row: drop AfterimagePass from the "three" cell, the detect regex and the notes. New unsupported row for `\bAfterimage(Pass|Shader)\b`, "No port", docs `porting/threejs-postprocessing`.
Then drop the "has no equivalent" sentences from the old rows' notes, since the new rows carry them. The check proposal is sound: the unsupported page tables can be matched against unsupported rows by name in tools/lib/docs.ts.
