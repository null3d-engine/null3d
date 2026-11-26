# porting-shaders-substance-27

Finding as given:
- page: porting/threejs-overview
- anchor: "## What stays the same", line 88 "and lux for the others"
- category: wrong-claim, severity: low
- claim: Rectangle and tube lights take nits, not lux.
- evidence: docs/api/reference/lights.md intensity: "lux for directional and ambient lights, candela for point and spot lights, and nits for rectangle and tube lights"
- proposedEdit: "candela for point and spot lights, nits for rectangle and tube lights, and lux for directional and ambient lights."

Verdict: survives

Evidence:
- docs/porting/threejs-overview.md:88 says "candela for point and spot lights, and lux for the others". "The others" covers rectangle and tube lights.
- docs/api/reference/lights.md:129 (light options, intensity): "lux for directional and ambient lights, candela for point and spot lights, and nits for rectangle and tube lights".
- docs/api/reference/lights.md:174 (RectAreaLight): "Its intensity is the rectangle's brightness in nits."
- docs/api/reference/lights.md:237 (TubeLight): "Its intensity is the tube's brightness in nits, as for a rectangle light."
- The hemisphere light (lights.md:94) is in lux, so it fits "lux" too. three.js r155 also gives RectAreaLight in nits, so the "as three.js does" part stays true after the fix.
- The page is hand-written, not generated, so the fix goes in the page itself.

Corrected edit (small refinement: also names the hemisphere light, so no light kind is left out):
"candela for point and spot lights, nits for rectangle and tube lights, and lux for directional, hemisphere and ambient lights."
