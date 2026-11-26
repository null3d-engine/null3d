# api-1-substance-10

## Finding as given

```json
{
 "page": "api/assets",
 "anchor": "## glTF models, table row 'A material' (line 89)",
 "category": "technical-details-block",
 "severity": "medium",
 "claim": "One table cell holds about 450 words: every material extension, then texture-array slot rules ('keeps a row slot of its own and samples a specular slot's texture array') whose terms the page never explains. It cannot be read on a phone.",
 "evidence": "docs/api/assets.md:89.",
 "proposedEdit": "Shorten the row to the base rule and a pointer to a list below the table, one line per extension and the values it sets. Move the slot rules into <details><summary>Technical details: which textures a layered material keeps</summary> ... </details> after the list.",
 "generatedSource": "",
 "id": "api-1-substance-10",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/assets.md:89 is one table cell. The whole line is 321 words (`wc -w`), not about 450. It is still by far the longest cell on the page, with about 25 sentences and 14 extensions. The readability problem is real.
- The page is hand-written (tracked in git as docs/api/assets.md; tools/lib/docs.ts:119 only lists it in PAGES). No generated source is needed.
- The slot terms are not explained on this page, but the cell links to materials.md#transmission, and docs/api/materials.md explains the same rules in full:
  - materials.md:169 (Transmission, "How it draws"): each volume map samples a specular slot's texture array at its own layer; a thickness map never shares a specular color map's array (linear against sRGB); E1217.
  - materials.md:296 ("Maps of the layers"): which layer maps fill the array that each volume map samples.
  - materials.md:138, 142, 455, 456, 462: the same rules in the map tables.
- So a details block that holds the slot rules on the assets page would copy what materials.md already says. That gives two places to keep in sync. Only one part is specific to the loader: "the loader notes the one that stays out" (a texture that cannot keep its slot is dropped with a note).

## Corrected claim

The 'A material' cell (docs/api/assets.md:89) holds 321 words and lists every material extension in one cell, which is hard to scan and does not read well on a phone. Its texture-array slot sentences use terms that this page does not define, but materials.md (lines 169, 296, 455-462) explains them in full.

## Corrected edit

Shorten the cell to the base rule ("`materials.standard`, or `materials.unlit` with `KHR_materials_unlit`; each extension below sets the material values it names"). Below the table, add a list with one line for each extension and the values it sets, each with its link into materials.md. Remove the slot sentences ("each transmission or thickness texture keeps a row slot of its own...", "A thickness texture stays out beside a specular color texture...", "A layered material keeps each texture unless a layer map fills the array...", "The coat's and the sheen's textures keep their places ahead of...") and replace them with one plain line: "A material can sample only some texture combinations. When a texture has no place, the loader leaves it out and notes it. [Transmission](materials.md#how-it-draws) and [Maps of the layers](materials.md#maps-of-the-layers) list the combinations." Use a `<details>` block only for loader-specific detail that materials.md does not hold, such as which texture wins when two compete and the volume-scatter mapping from `attenuationDistance` and `multiscatterColor`.
