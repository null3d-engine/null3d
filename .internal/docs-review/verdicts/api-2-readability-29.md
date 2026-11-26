# Verdict: api-2-readability-29

## Finding as given

```json
{
 "page": "api/materials",
 "anchor": "## Options fixed at creation, rows toneMapped (558) and contactShadows (559)",
 "category": "wall-of-text",
 "severity": "low",
 "claim": "The toneMapped cell is 103 words and explains how both color paths skip the curve. Paragraph-sized cells make the table hard to scan.",
 "evidence": "line 558: 103 words in one table cell.",
 "proposedEdit": "Cut each cell to one sentence plus a link. Put the 8-bit and HDR path detail in <details><summary>Technical details: toneMapped on each color path</summary> under the table.",
 "generatedSource": "",
 "id": "api-2-readability-29",
 "slice": "api-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/api/materials.md:558. The "What it does" cell of the `toneMapped` row is about 96 words and 7 sentences (the whole row is about 103). It is the longest cell in the table by far. Most other rows are one or two sentences. The core claim holds: this cell is hard to scan in a table.
- docs/api/materials.md is a hand-written page, not generated. The empty generatedSource is right.
- The 8-bit and HDR path detail is already on the linked page, nearly word for word: docs/concepts/color-management.md:73-79 ("Materials that keep their display color"). That section explains the shader on the 8-bit path, the mask in the HDR final pass, why a blended surface keeps the curve, the `hdr: false` way out, and that the vignette, sRGB encoding and exposure still apply. The cell already links to that page.
- So a details block under the table would copy text that is one link away. Two copies drift apart. The cell only needs the user-facing result and a link to the anchored section.
- One fact in the cell is not on the linked page: the color shows brighter than the same color tone mapped (color-management.md:79 says only that the exposure scales it). Keep that sentence, or move it to the linked page.
- docs/api/materials.md:559. The `contactShadows` cell is about 51 words. Its "use it on grass, leaf cards and thin surfaces" sentence is the reason to use the option. Shadows (docs/concepts/shadows.md:345-349) has the "why". Cutting the cell to one sentence would lose the use case from the reference table. This row is acceptable as it is, or it can drop only the last clause.
- stats.json does not list either cell as a long paragraph. Table cells are not counted there, so the word count in the finding is the reviewer's own count.

## Corrected claim

The `toneMapped` cell (line 558, about 96 words) is too long for a table, and most of it repeats the "Materials that keep their display color" section of Color management. The `contactShadows` cell (line 559) is acceptable.

## Corrected edit

No details block. Shorten the `toneMapped` cell and point the link at the section:

| `toneMapped` | Both | true | With `false`, the tone curve leaves the color alone, so it shows as the display shows it. The exposure still scales it, so it shows brighter than the same color tone mapped. On the HDR path a blended surface keeps the curve. [Color management](../concepts/color-management.md#materials-that-keep-their-display-color) explains each path |

Leave the `contactShadows` row as it is.
