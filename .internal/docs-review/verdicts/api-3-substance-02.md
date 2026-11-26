# Verdict: api-3-substance-02

## The finding as given

```json
{
 "page": "api/terrain",
 "anchor": "## How it works, line 70: \"from a height map held as a `Float32Array`\"",
 "category": "missing-content",
 "severity": "high",
 "claim": "The page has no options table. It never says how large a height map array must be or how its rows run, and never names `resolution`. `splatResolution`, `chunkQuads`, `skirt`, `metalness`, `castShadows` and `receiveShadows` are missing. Line 94 says \"Give `splat` to paint the weights\" but `splat` is a function (x, z, out), not a texture. A reader with a height map is blocked.",
 "evidence": "packages/terrain/src/terrain.ts:31-107 (height: 'a height map of `resolution` samples along each side, row by row from z = -size / 2 upward'; resolution default 256; chunkQuads 16; skirt; castShadows); packages/terrain/src/splat.ts:12 (SplatFunction).",
 "proposedEdit": "Add \"## Options\" after the example: size, height (function, or Float32Array of resolution x resolution samples, rows from -z), resolution (256), layers (map, tile, roughness, heightFrom, contrast), splat (a function that writes four weights into out), splatResolution (256), chunkQuads (16), maxLevel (6), camera, error, bakedNormals, steepFaces, skirt, morph, metalness, castShadows, receiveShadows, maxBlocks, blocksPerUpdate (16). Add a short height-map example.",
 "generatedSource": "",
 "id": "api-3-substance-02",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The written page (docs/api/terrain.md) has no options table, and it never names `resolution`, `splatResolution`, `chunkQuads`, `skirt`, `metalness`, `castShadows` or `receiveShadows`. Line 70 says only "a height map held as a `Float32Array`", with no size or row order. These facts hold.
- The reader is not blocked. Line 118 links to the generated reference page, docs/api/reference/terrain.md. Its `TerrainOptions` table (lines 104-130 of that page) lists every option, with defaults. It gives the height map's shape: "a height map of `resolution` samples along each side, row by row from `z = -size / 2` upward", and "`resolution` ... The default is 256". The `createHeightfield` options (reference lines 57-58) also say "a typed array must hold `resolution * resolution` heights". The source is packages/terrain/src/terrain.ts:31-107.
- The proposed edit breaks a writing rule. AGENTS.md "Writing docs" rule 1 says "One source per fact. The API reference comes from TypeScript doc comments". Rule 5 says that the generated reference page holds the reference, and the written page links to it. A hand-written table of all 19 options with defaults copies the TSDoc text. It would drift from the source when a default changes.
- Line 94 ("Give `splat` to paint the weights yourself") does not say that `splat` is a texture. But it also does not say that it is a function. "Paint" suggests an image, and the next sentence is about textures, so a reader can guess wrong. packages/terrain/src/splat.ts:12 defines `SplatFunction = (x, z, out: number[]) => void`. This part holds as a small clarity issue.
- The severity is too high. The facts are one link away, on the page that the docs rules make the home for option lists. Medium fits: the reader has to go to another page to learn the height map's shape.

## Corrected claim

The written page does not give a height map's size or row order, and it does not name `resolution`. Line 94 does not say that `splat` is a function `(x, z, out)`, and "paint" suggests a texture. The full option list is already on the linked reference page (docs/api/reference/terrain.md, `TerrainOptions`), so the page does not need its own options table. Severity: medium, not high.

## Corrected edit

Do not add a full "## Options" table. It would copy the generated reference and break "one source per fact". Make two small edits in docs/api/terrain.md:

- Line 70: "The height comes from a function of x and z, or from a `Float32Array` height map. A map holds `resolution` × `resolution` heights in meters (256 × 256 by default), row by row from the ground's −z edge. [`TerrainOptions`](reference/terrain.md#terrainoptions) lists every option and its default."
- Line 94: "Give `splat`, a function of x and z that writes the four layer weights into `out`, to set the weights yourself."

A short height-map snippet (for example, the heights decoded from an image into a `Float32Array` and passed with `resolution`) is optional. If it is added, put it in a `<details>` block with the summary "Technical details: a height map from an image", so the main text still reads with the block closed.
