# api-1-readability-01

## Finding as given

- page: api/assets
- anchor: ## glTF models, table row 'A material' (line 89)
- category: wall-of-text
- severity: high
- claim: One table cell holds about 420 words. It covers 15 material extensions and the rules for which textures a layered material keeps. On the website it renders as a very tall, narrow cell that nobody can scan.
- evidence: assets.md:89 runs from '`materials.standard`, or `materials.unlit` with `KHR_materials_unlit`.' to '`scatterAnisotropy` is not drawn'. The other rows of the table are one to three sentences.
- proposedEdit: Make the row read 'A material | `materials.standard`, or `materials.unlit` with `KHR_materials_unlit`. [Material extensions](#material-extensions) lists what each extension sets.' Add an H3 'Material extensions' with a table Extension | What it sets | See, one row per extension (emissive_strength, specular, ior, transmission, volume, dispersion, diffuse_transmission, clearcoat, sheen, iridescence, anisotropy, volume_scatter). Move the texture-slot rules into <details><summary>Technical details: which textures a material with many extensions keeps</summary>.

Verdict: partly

## Evidence

- docs/api/assets.md:89 is one table cell. `wc -w` on the line gives 321 words, not about 420. The cell names 13 material extensions (unlit, emissive_strength, specular, ior, transmission, volume, dispersion, diffuse_transmission, clearcoat, sheen, iridescence, anisotropy, volume_scatter), not 15.
- The core problem holds. The other rows (lines 87-88, 90-103) are one to three sentences. Line 89 mixes "what each extension sets" with texture-slot rules (specular and transmission families sharing arrays, thickness beside an sRGB specular color texture, layered materials dropping maps, coat and sheen roughness pairs, iridescence and anisotropy textures being noted). That cannot be scanned.
- stats.json does not list table cells, so it gives no count for this line.
- Severity: the cell is correct and links to the right sections of materials.md (Transmission, Light through thin surfaces, Clear coat and sheen, Iridescence and anisotropy, Light under the surface). It does not mislead and does not block a newcomer. By the given scale it is medium: it makes the page clearly harder to read.
- The proposed edit fits the rules. The H3 "Material extensions" sits under "## glTF models" before "### Freeing a model", no page uses that anchor yet, and the details block has no heading and no nested block. docs/api/materials.md:246 already points readers to Assets for the volume-scatter formula, so the formula must stay on this page (in the block is fine).

## Corrected claim

One table cell (line 89) holds 321 words. It covers 13 material extensions and the rules for which textures a material with several extensions keeps. It renders as a tall cell that a reader cannot scan. Severity medium, not high.

## Corrected edit

Keep the proposed edit, with these points:
- Row: 'A material | `materials.standard`, or `materials.unlit` with `KHR_materials_unlit`. [Material extensions](#material-extensions) lists what each extension sets.'
- H3 "Material extensions" after the paragraph at line 97 and before the member table, or directly after the table. Table Extension | What it sets | See, 12 rows. Keep short value rules in the row they belong to: the ior row says an `ior` of 0 becomes 1000; the dispersion row says it separates passing light into colors; volume_scatter is marked as a draft extension; the diffuse_transmission row says transmission wins over it.
- One sentence in the main text, outside the block: a material with many extensions can drop some textures, and the loader notes each one it drops.
- <details><summary>Technical details: which textures a material with many extensions keeps</summary>: transmission and thickness maps, the masked material that keeps transmission, the specular and transmission families sharing slots, thickness beside a specular color texture, layered materials dropping specular and diffuse transmission maps, the coat and sheen roughness pair rule, coat and sheen textures ahead of iridescence and anisotropy, and the volume-scatter formula with its no-attenuation-distance and `scatterAnisotropy` limits.
