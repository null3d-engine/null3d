# D-200: A per-material tone-mapping flag, and what the HDR path needs for it

Status: decided on 21 October 2026 for the material row's flag and the 8-bit path. The HDR path's per-pixel mask is not built, so `toneMapped: false` has no effect there yet.

Summary: `toneMapped: false` rides in the material's row flags, as `fog: false` does, so it adds no shader build, buffer or draw. The 8-bit path, whose material shaders apply the output transform, encodes the material's color without the tone curve. The HDR path tone maps the whole image once in the final pass, which needs a per-pixel mask before it can honour the flag; the mask is not built.

## Question

three.js applies the tone curve in each material's shader, so `material.toneMapped = false` is one branch there. null3D applies it in two places: in each material's shader on the 8-bit path, and once for the whole image in the final pass on the HDR path. Where does a per-material flag live, and what does it do on each path?

## Rule

- A material setting that needs no new pipeline stays a row flag, so it costs no build, no buffer entry and no draw (D-13, and hard rule 8: pay only for what you use).
- A path honours the flag only if its result is exact, or the difference is written down (hard rule 9: both backends are first-class, and a documented fallback).
- Nothing in a color channel may carry state that another pass reads wrong: the scene color's alpha is coverage, which blending, the transmission copy and the still accumulation read.

## Data

- The 8-bit path applies the output transform in `finish_exposed` (`crates/null3d-shaders/wgsl/lib/mesh.wgsl`), once per fragment, so the flag is a branch in the material's own shader.
- The HDR path writes `limit_hdr(color)` per fragment and tone maps in `final.wgsl`'s `display()`, once per canvas pixel. Its settings hold whole-frame flags only ([`OutputUniform`](D-77-final-pass-order-and-formats.md)).
- Where the scene color is `rg11b10ufloat`, the target has no alpha at all, so no channel of it can carry a per-pixel flag. `rgba16float` is used where the canvas is transparent, and on WebGL2 by default.
- Consumers of the scene color that a marker in it would reach: bloom's threshold, the automatic exposure's meter, the still accumulation's average, the transmission copy and a view copy. A marker in the alpha is read wrong by the accumulation at least, which averages display color as if it were HDR color and tone maps it again.

## Decision

1. The flag is `feature::NO_TONE_MAP`, with the row flag `flag::NO_TONE_MAP`, given as `toneMapped: false` in a material's options. It picks no pipeline and adds no build, buffer or draw.
2. The 8-bit path encodes the material's color without the tone curve, through `finish_unmapped`. The vignette and the sRGB encoding still apply, as they do to every surface, and the exposure scales the material's colors before them, since the engine puts the exposure in the lights (D-60).
3. The HDR path applies the curve to this material's color, and the API page, the concepts page and the three.js mapping say so. A sketch that needs the exact color on such a device draws on the 8-bit path, which `createEngine({ hdr: false })` starts.

## Options rejected

- A marker in the scene color's alpha, read by the final pass. It is read wrong by the still accumulation, and it needs `rgba16float` on devices that would draw `rg11b10ufloat`, which doubles the scene color's memory.
- Inverting the tone curve in the material's shader. AgX's punchy look mixes channels, so a saturated color would not come out exact.
- Drawing the scene on the 8-bit path while a material with the flag lives. Bloom, depth of field and volumetric fog need HDR color, and the last one to turn on would win.

## Consequences

- Code: `feature` and `flag` in `crates/null3d-render/src/materials.rs`, `finish_exposed_material` and `keeps_display_color` in `lib/mesh.wgsl`, `finish_unmapped` in `lib/tonemap.wgsl`, the calls in the lit, unlit, unlit-map, sprite and line shaders, and `toneMapped` in `MaterialFeatures`.
- To finish the HDR path, the final pass needs a per-pixel mask of the surfaces that skip the curve: either a second color target on the scene passes that the flagged materials write, or a mask pass that draws the flagged objects again against the scene depth, as the outline mask pass draws outlined objects (D-36). Both cost work per frame only while a material uses the flag.
- Tests: unit tests of the feature bits and of the row flag. An image test needs GPU references for the 8-bit path, which are not drawn yet.
- Docs: `api/materials`, `concepts/color-management`, the mapping's `tone-mapped-flag` entry and the porting skill's materials reference.
