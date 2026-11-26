# guides-2-readability-16

## The finding as given

```json
{
 "page": "guides/phones",
 "anchor": "## Memory, lines 63-87",
 "category": "structure",
 "severity": "medium",
 "claim": "One H2 covers tab death, shared WebAssembly memory, texture budgets, KTX2 encoding, a second engine, object tables and crash recovery in seven paragraphs, four of them long. A reader cannot find 'make textures smaller' or 'what happens after a crash' by scanning.",
 "evidence": "stats.json lines 66, 72, 74, 76 (file 73, 79, 81, 83); line 81 'Encode its mip levels into the file, as `basisu -mipmap` does ... Use UASTC for normal maps ... and ETC1S where the download must stay small.'",
 "proposedEdit": "Add H3s: 'How much memory a tab gets' (65-77), 'Textures' (79-81), 'A second engine on the page' (83), 'Large scenes' (85), 'After a crash' (87). In Textures keep 'Load large textures from KTX2 files' and the size figure; move ASTC/ETC2, basisu -mipmap and UASTC versus ETC1S into <details><summary>Technical details: encoding KTX2 textures for phones</summary>, or link to the asset pipeline.",
 "generatedSource": "",
 "id": "guides-2-readability-16",
 "slice": "guides-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/guides/phones.md:63-87. The Memory section holds a table and nine paragraphs, not seven: lines 65, 73, 75, 77, 79, 81, 83, 85 and 87. The seven topics the finding names are all there.
- stats.json lists four long paragraphs in this section, at stats lines 66, 72, 74 and 76. These are file lines 73, 79, 81 and 83, because the front matter (seven lines) is not counted. The finding has that right.
- The page has no H3 headings. The section's topics do not depend on each other: a second engine (83), the object tables (85) and crash recovery (87) each stand alone. A reader who scans the headings cannot find these topics. That cost is real, so the structure issue holds at medium.
- The KTX2 encoding detail on line 81 is correct, and other pages already give it. docs/api/textures.md:100 says the GPU cannot make mip levels for compressed texels and names `basisu -mipmap`. docs/api/textures.md:87-91 and docs/guides/assets-pipeline.md:138-147 compare UASTC and ETC1S. So a collapsible block or a link loses nothing. Also, `bunx @null3d/cli assets optimize` already writes every mip level (assets-pipeline.md:17), so the `basisu -mipmap` advice only matters for files you encode by hand. That is implementer detail, and a block suits it.
- H3s are normal in guides: performance.md, assets-pipeline.md and custom-passes.md use them. New H3s keep the `#memory` anchor that testing.md:50 links to.
- One part of the proposed edit is wrong. The H3 "How much memory a tab gets" spans lines 65-77, but line 77 is general advice on saving memory (share meshes, use instance batches, `engine.measure`). Line 75 is about the shared WebAssembly memory, not the tab's limit. Also, the proposal moves "ASTC and ETC2" into the block. The main text then needs to keep the fact that the texture stays compressed on the GPU, or the 1.3 MiB figure has no reason.

## Corrected claim

The Memory section of guides/phones covers seven separate topics in nine paragraphs and a table, four of them long (file lines 73, 79, 81 and 83). It has no subheadings, so a reader cannot find texture size, a second engine, object tables or crash recovery by scanning.

## Corrected edit

Add H3s, in sentence case:

- "How much memory a tab gets": lines 65-73 (the table and the budgets).
- "The engine's WebAssembly memory": lines 75-77 (shared memory, `engine.measure`, how to use less).
- "Textures": lines 79-81.
- "A second engine on the page": line 83.
- "Large scenes": line 85.
- "After a crash": line 87.

In Textures, the main text keeps "Load large textures from KTX2 files", the `assets optimize` command, one sentence that says phones keep such a texture compressed on the GPU, and the 1.3 MiB figure. Move these parts of line 81 into one block:

```md
<details>
<summary>Technical details: encoding KTX2 textures by hand</summary>

Phones and tablets have the ASTC and ETC2 formats. The same texture takes 0.7 MiB in ETC2 without alpha. Encode the mip levels into the file, as `basisu -mipmap` does, because the GPU cannot make them for compressed texels. Use UASTC for normal maps and detailed color maps, and ETC1S where the download must stay small. `texture.format` tells which format the device got.

</details>
```

The main text must still read correctly with the block closed, and it keeps the link to [Textures](../api/textures.md#ktx2-files).
