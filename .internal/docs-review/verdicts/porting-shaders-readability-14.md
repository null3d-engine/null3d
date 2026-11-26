# porting-shaders-readability-14

## Finding as given

- page: shaders/surface-functions
- anchor: Lines 146, 164, 181, 209, 415, 464, 488
- category: duplication
- severity: medium
- claim: Seven sections end with a near-identical bullet: the engine compiles the field into the builds of a material whose WGSL names it, and other materials pay nothing. The repeat hides the facts that differ per section.
- evidence: surface-functions.md lines 146, 164, 181 ("pays nothing, and its builds stay as they were"), 209, 415, 464, 488.
- proposedEdit: State the rule once under the table in "The surface": "A field costs something only in a material whose WGSL names it. The engine builds that field's code into that material alone." Delete the repeats. Keep only per-section facts, such as the transmission option at creation and the E1217 cases.

Verdict: partly

## Evidence

- Lines 146, 164 and 181 are near-identical bullets. 164 and 181 match word for word apart from the noun ("the third normal", "the choice"). That part holds.
- Line 209 is not a closing bullet. It sits inside a paragraph, it is about declaring a function (`lobe`), not naming a field, and it carries its own fact: one call per light at each pixel that the light reaches.
- Lines 415, 464 and 488 are not the same bullet. Each one states that the material also needs an option at creation, and that the option without the WGSL throws E1217. Line 488 also says that such a material always has the layers, and that its layer options set the `defaultSurface` values. The proposed edit keeps these facts itself, so these three bullets stay almost whole. Little is saved there.
- The source shows that the opt-in fields work in two different ways. `crates/null3d-shaders/src/material.rs` lines 121-147 (`SURFACE_FIELDS`): `diffuseNormal`, `ambientNormal` and `occlusionByMinimum` each add a shader def "never a permutation bit, so the material keeps its count of builds". Lines 731-776 (`sets_transmission`, `names_diffuse_transmission`, `names_coat_sheen`) gate transmission, diffuse transmission and the layer fields, and those also need an option at creation. So "its builds stay as they were" (164, 181) and "the template's single-normal path" (146) are true, section-specific facts.
- The proposed sentence is wrong as a general rule under the surface table. Most fields in that table (`baseColor`, `normal`, `roughness`, `metalness`, `emissive`, `occlusion`, `irradiance`, `reflection`, `lobe`) are always in the template, whether the WGSL names them or not. A reader would conclude that every field is free until named.
- The finding misses two more cases of the same pattern: line 553 (the coverage function gets the caster builds) and line 574 (only WGSL that sets or reads `alpha` gets the alpha-to-coverage and hash builds).
- Severity is too high. The page is a reference page, and the surface table links readers straight into each section. A reader who lands at a section needs to know that the field costs nothing unless named. Three one-line repeats on a long page do not make the page "clearly harder to read". Low (polish) fits better.

## Corrected claim

Three sections (lines 146, 164, 181) end with a near-identical bullet saying that the field builds only into materials whose WGSL names it. Lines 209, 415, 464 and 488 state related but different rules (a declared function; a creation option and the E1217 error; layers always on), and must keep their own wording. Severity: low.

## Corrected edit

Under the table in "The surface", add one sentence that names the opt-in fields and does not claim the rule for every field:

"Some fields cost something only in a material whose WGSL sets or reads them: `alpha`, `diffuseNormal`, `ambientNormal`, `occlusionByMinimum`, `transmission`, `diffuseTransmission` and its color, and the layer fields. The `lobe` and `coverage` functions work the same way when the WGSL declares them. Each section below says what the field adds."

Then shorten lines 146, 164 and 181 to the fact that differs:
- 146: "A material that never names `diffuseNormal` keeps the template's single-normal path."
- 164 and 181: "Naming the field adds no builds: the material keeps its count of builds."

Leave lines 209, 415, 464 and 488 as they are.
