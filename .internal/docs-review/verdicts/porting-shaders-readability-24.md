# porting-shaders-readability-24

## Finding as given

- page: shaders/surface-functions
- anchor: ## The surface table (lines 71-98)
- category: scan-order
- severity: low
- claim: The table has 23 rows. The roughly 8 fields a newcomer needs (base color, alpha, metalness, roughness, normal, emissive, occlusion, irradiance) are mixed with extra normals, a lobe vector, a shadow offset, transmission, coat, sheen and iridescence rows, some 50 words long.
- evidence: surface-functions.md lines 71-98.
- proposedEdit: Split into "Fields every surface uses" and "Fields for layers and special light paths", each row linking to its section. If the page splits, the second table moves to the new page.

Verdict: partly

## Evidence

- The table in the generated page (docs/shaders/surface-functions.md, rows at lines 73-98) has 26 field rows, not 23.
- The eight core fields are real and come first in the shader's own struct (crates/null3d-shaders/wgsl/lit.wgsl:1148-1164: baseColor, alpha, metalness, roughness, normal, emissive, occlusion, irradiance; the rest sit after a CUSTOM guard). The docs table breaks that order. It puts `diffuseNormal` and `ambientNormal` right after `normal` (lines 78-79), and `occlusionByMinimum` right after `occlusion` (line 82). So a reader who scans for the basics hits three special-case rows in the middle of them. That part of the claim holds.
- "Some 50 words long" holds only for the two extra-normal rows (about 45 words each, lines 78-79). The transmission, coat, sheen and iridescence rows are short (roughly 10 to 35 words). `lobe` and `shadowOffset` are about 15 and 30 words. The `reflection` row is also an extra field and the finding leaves it out.
- The rows for the extra fields already link to their sections. `lobe`, `shadowOffset`, `reflection`, `transmission`, `diffuseTransmission`, `clearcoat`, `iridescence`, the two extra normals and `occlusionByMinimum` all do. Only the follow-on rows (`thickness`, `diffuseTransmissionColor`, `clearcoatRoughness`, `clearcoatNormal`, `sheenRoughness`, the two iridescence values) do not, and each one sits right under the row that links. "Each row linking to its section" is mostly done already.
- The page already tells newcomers to start from `defaultSurface(input)` and to "change only the fields that your look needs" (line 100 and the example after it). So the cost to a reader is small, and low severity is right.
- The last sentence of the edit ("If the page splits, the second table moves to the new page") depends on a different finding. It is not part of this fix.

## Corrected claim

The table has 26 rows. Three special-case rows (`diffuseNormal`, `ambientNormal`, `occlusionByMinimum`) sit between the eight core fields. Two of those rows are about 45 words long, so the core fields are harder to scan. The layer rows (transmission, coat, sheen, iridescence) already come after the core fields and are short.

## Corrected edit

Keep one table, or split it in two. Either way, list the eight core fields first, in the shader's own order: baseColor, alpha, metalness, roughness, normal, emissive, occlusion, irradiance. Then add one lead-in line, for example "Most surfaces change only these fields." Put `diffuseNormal`, `ambientNormal` and `occlusionByMinimum` after them, together with `reflection`, `lobe`, `shadowOffset` and the layer rows, under a short label such as "Fields for special light paths and layers". Cut the two extra-normal rows down to one short clause plus their existing section link. Their sections already explain the detail. The existing links stay as they are. The "If the page splits" clause is dropped, because the split-page finding handles it.
