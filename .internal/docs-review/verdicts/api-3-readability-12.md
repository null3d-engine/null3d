# Verdict on api-3-readability-12

## The finding as given

```json
{
 "page": "api/textures",
 "anchor": "lines 107, 126, 224, 228, 236, 242, 254, 258, 260, 268",
 "category": "technical-details-block",
 "severity": "medium",
 "claim": "Ten paragraphs are over the limit. Texture-array growth rules (line 224, 163 words), the WebGL2 map-drop order (line 228, 141 words), the transcoder (107) and the memory figures (258) are correct, dense detail. Only readers who debug memory or a missing map need it.",
 "evidence": "stats.json longParagraphs for api/textures.",
 "proposedEdit": "Line 224: keep three sentences plus the advice of line 226, and put growth, cap, shrink and own-array rules in <details><summary>Technical details: how arrays grow, shrink and split</summary>. Line 228: keep 'On WebGL2 a standard material samples at most six maps. Past six, it drops the maps that change its look least.', and put the drop order in <summary>Technical details: which maps WebGL2 drops first</summary>. Line 258: a table Format | Bytes per texel with the 1024 x 1024 example under it. Line 126: numbered steps for refresh(rect). Others: break at the fourth sentence.",
 "generatedSource": "",
 "id": "api-3-readability-12",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The ten long paragraphs are facts from stats.json. Its line numbers are 7 lower than the file's, because it skips the front matter. The anchor's lines (107, 126, 224, 228, 236, 242, 254, 258, 260, 268) are the file's own lines in docs/api/textures.md. The page is written by hand, so no generated source applies.
- The detail is correct. crates/null3d-render/src/textures.rs:103 (MAX_LAYERS = 256), :108 (FIRST_ARRAY_BYTES = 8 MiB), :112 (ARRAY_BYTES_CAP = 128 MiB), :1974 (shrink_arrays). crates/null3d-gpu/src/drawlist.rs:1910 (SHARED_MAP_UNITS = 6). crates/null3d-render/src/materials.rs:1011-1024 (SHARING_ORDER ends Light, SpecularColor, SpecularIntensity, so specular intensity drops first, then specular color, then the light map). packages/engine/src/generated/core.ts:274-277 (transmission maps reuse the specular slots).
- The block idea holds for lines 224, 228 and 258.

## What does not hold

1. The line 228 edit would mislead. The proposed main text says "a standard material samples at most six maps". The code limits six shared texture units, not six maps (drawlist.rs:1910, materials.rs:1711). Maps in one array that sample the same way share one unit. A reader with eight maps of one size would wrongly expect two maps to drop. The edit also hides the facts a reader acts on: maps of one size share a unit, each compressed map takes a unit of its own, and a glTF material passes six only when its seven maps all differ.
2. The line 224 edit contradicts itself. The first three sentences hold the cap and the growth rule, and the edit moves "growth, cap" into the block. The main text also needs one fact that the block would hide: compressed textures, data textures of several layers and `rgb9e5ufloat` textures each get an array of their own. Without it, the common-sizes advice of line 226 looks like it helps every texture. It does not help compressed ones. Line 228 also says "Each compressed map takes one of its own".
3. Line 126 is not a sequence of steps. It says where the rectangle's coordinates start and what uploads. Numbered steps give it the wrong form. Split it into two paragraphs, or move the coordinate sentence into the bullet list after the code, next to "The rectangle must lie inside the canvas".
4. Line 107 is not detail for debugging only. A developer who deploys a build must serve the transcoder's files, or loads throw E1406. Keep it in the main text and split it after "never downloads it."

## Corrected claim

Ten paragraphs are over the limit. Lines 224, 228 and 258 hold correct, dense detail (array growth and shrink, the WebGL2 drop order and its reason, and the bytes of each format). Most readers do not need it, so it can move into collapsible blocks. The main text must keep what a reader acts on: the per-array cap, which textures get an array of their own, and that six shared units (not six maps) limit a WebGL2 material. Lines 107, 126, 236, 242, 254, 260 and 268 only need a split.

## Corrected edit

Line 224, main text:

> An array holds at most 256 layers and at most 128 MiB. When a size has more textures than an array holds, another array holds the rest. A compressed texture, a data texture of several layers and an `rgb9e5ufloat` texture each have an array of their own.

Then `<details><summary>Technical details: how arrays grow and shrink</summary>` with: the 256-layer reason (the iPad's limit), the 8 MiB start, doubling and the GPU copy, both arrays held for one frame, the shrink below a quarter, and why compressed and `rgb9e5ufloat` textures cannot share (compatibility mode and WebGL2 cannot copy them). Keep line 226 as it is.

Line 228, main text:

> On WebGL2, one standard material samples its maps through at most six texture units. Maps in one array that sample the same way share one unit, and each compressed map takes a unit of its own. A glTF material needs more than six only when its seven maps all differ in size, format or sampling. Past six, the material draws without the maps that change its look least.

Then `<details><summary>Technical details: which maps WebGL2 drops first</summary>` with: the 16 units that WebGL2 promises each stage, the two-unit example, the drop order (specular intensity, specular color, light map), and the transmission and thickness maps taking the specular maps' places.

Line 258: keep the proposed table (Format | Bytes per texel: `rgba8unorm` 4, `rgba16float` 8, `rgb9e5ufloat` 4, compressed 1, `etc2-rgb8unorm` 0.5). Keep the mip-level third and the 1024 x 1024 example (5.3 MiB, then 1.3 or 0.7 MiB from KTX2) under it. Keep the sentences on free layers and `textures.memoryBytes` in the main text.

Line 126: split after "and gives its width and height." Do not use numbered steps.

Lines 107, 236, 242, 254, 260, 268: split at a sentence boundary near the fourth sentence. For example, 107 after "never downloads it.", 236 after "one band per frame." and 268 after "on any device ([Page API](engine.md#options))."
