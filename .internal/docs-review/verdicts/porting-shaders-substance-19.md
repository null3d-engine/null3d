# porting-shaders-substance-19

## Finding as given

```json
{
 "page": "shaders/library",
 "anchor": "stats lines 397, 681, 743, 775, 883, 969, 1021, 1129, 1169, 1353, 1361",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Eleven entries open with what the function gives, then run into derivations, Filament constants or storage layout. A reader looking up a function needs the signature and the first sentence.",
 "evidence": "stats.json longParagraphs for shaders/library (for example dfg_lut at 681, fog at 883)",
 "proposedEdit": "Let the generator split each doc comment at a marker line such as '/// Details:' and render the rest as <details><summary>Technical details: how <name> works</summary>. Mark the eleven comments.",
 "generatedSource": "tools/lib/shader-library.ts; crates/null3d-shaders/wgsl/lib/*.wgsl",
 "id": "porting-shaders-substance-19",
 "slice": "porting-shaders",
 "role": "substance"
}
```

Verdict: partly

## Evidence

The eleven long paragraphs are real. The stats line numbers sit about 7 lines above the current page, but each opening matches. In docs/shaders/library.md:

- 404 `limit_hdr`, 688 `dfg_lut`, 750 `specular_aa_kernel`, 782 `ambient_irradiance`, 976 `fog_height_ratio`, 1176 `distance_code`, 1368 `reflection_uv`: these 7 are item entries.
- 890 `null3d::fog`, 1028 `null3d::vertex`, 1136 `null3d::depth`, 1360 `null3d::reflection`: these 4 are module introductions, not function entries. The claim that all eleven "open with what the function gives" is wrong for these 4.

Not every paragraph holds detail that can be hidden:

- `null3d::depth` (57 words): reversed depth, with 1 at the near plane, and negative view-space z in front of the camera. A shader author needs both facts to use any depth helper. Keep it in the main text. No block.
- `null3d::reflection` and `reflection_uv`: which way the rows run on each path, how to get the clip position, and the warning "Read a reflection pass's texture with it, and no scene pass's, which would look flipped". These are usage rules. Hiding them would mislead. Split the paragraphs instead.
- `dfg_lut`: "A shader that calls this function binds the texture of its path there too." This is a requirement for the caller, so it must stay visible. Only the table's shape, filtering and `textureLoad` detail can go into a block.
- `null3d::vertex`: drawing relative to the camera is the core idea behind `move_transform` and `to_clip`. Keep it visible. Only the 3 x 4 row storage can go into a block.

There is a better mechanism than a new marker. The sources already mark paragraph breaks with blank comment lines, but the generator flattens them:

- tools/lib/shader-library.ts:56-61, `commentText` joins every comment line with a space. A blank `///` or `//` line becomes an empty string. So the page shows a double space at the break, with no new paragraph.
- crates/null3d-shaders/wgsl/lib/color.wgsl:28-34: the `limit_hdr` comment has a blank `///` line before "The NaN test reads the bits". The page shows "so it draws black.  The NaN test" at line 404.
- crates/null3d-shaders/wgsl/lib/fog.wgsl:3-10: the module comment has a blank `//` line before "Per pixel, the fog costs". The page shows "encoding.  Per pixel" at line 890.

In both cases the author already put the break at the exact point where the technical detail starts. A '/// Details:' marker adds a second convention when the first one already works.

## Corrected claim

Seven item entries (`limit_hdr`, `dfg_lut`, `specular_aa_kernel`, `ambient_irradiance`, `fog_height_ratio`, `distance_code`, `reflection_uv`) and four module introductions (`fog`, `vertex`, `depth`, `reflection`) are over the limit. About six of them hold derivations or internals that can go into a block: the second paragraph of `limit_hdr`, the table layout of `dfg_lut`, the `specular_aa_kernel` derivation, the `ambient_irradiance` sum, the fog cost paragraph, the `fog_height_ratio` series, and the 8-bit step size of `distance_code`. `depth`, `reflection`, `reflection_uv`, the `dfg_lut` binding rule and the core idea of `vertex` are usage rules and must stay visible. The generator also flattens the paragraph breaks that the sources already have.

## Corrected edit

1. In tools/lib/shader-library.ts, make `commentText` keep blank comment lines as paragraph breaks. Today it joins every line with a space.
2. Render an item's or module's first paragraph as the main text. Render the later paragraphs inside `<details><summary>Technical details: how <name> works</summary>` ... `</details>`, with blank lines around the body. No headings inside the block. Keep the module table's first-sentence summary as it is.
3. In crates/null3d-shaders/wgsl/lib/*.wgsl, add a blank comment line before the detail in `dfg_lut` (after the binding rule), `specular_aa_kernel`, `ambient_irradiance`, `fog_height_ratio`, `distance_code` and `vertex.wgsl` (before the row storage). `limit_hdr` and `fog.wgsl` already have the break.
4. Do not move the `depth` introduction, the `reflection` introduction or `reflection_uv` into a block. Split the reflection introduction into two plain paragraphs, one for what the pass draws and one for the row direction and how a surface reads it.
5. Before you choose the rule "every later paragraph goes into a block", check the other blank `///` and `//` lines in the library sources (`mesh.wgsl` has 11, and there are a few in about 20 other files). Make sure none of them starts a paragraph that callers need to see.
