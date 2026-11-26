# Shot and demo-link verdicts: api/reference/materials

Paths below are relative to the generated copy of the repository.

## Caveat for the whole page

This page is generated from the doc comments on the public exports in `packages/engine/src/scene/resources.ts`. Neither `tools/gen-docs.ts` nor `tools/lib/docs.ts` has a way to add an image or a demo link. Today no `docs/api/reference/*.md` page has an image. So each proposal below needs one of these:

- the link or image goes in the export's doc comment, where it also shows in editor hovers and in the published type files (a relative image path does not work there), or
- the generator learns to add a page's pictures and links.

The human-written companion page `docs/api/materials.md` has no demo links at all, so it may be a better home for most of these links.

## Shots

### alpha-modes: reject as proposed, correct it

- The "coverage" panel does not belong under `AlphaMode`. The type is `'opaque' | 'mask' | 'hash' | 'blend'`. Alpha to coverage is the `alphaToCoverage` option of `MaterialOptions` (page line 109), and it works on top of `mask`. The `alpha-coverage` test is the same cards as `alpha-mask` with that option on. Its only change is smoother cut edges under MSAA. At docs size that change does not show.
- The "blend" panel is wrong. `blending.png` is a different scene: additive and multiply glows, a sorted batch of red quads and a glow map. It shows the `Blending` values, not the `blend` alpha mode on the same surface.
- The alt text is wrong. The alpha tests show flat cards with a ring pattern cut by vertex alpha, in front of a blue wall and on a grey floor. Nothing is leafy, and the four panels are not "the same surface".
- The source type is wrong. The steps only compose existing references, so this is a "reference" shot, not a "scripted" one.

Corrected shot: compose `tests/image/references/chrome-real-gpu/webgpu/alpha-mask.png` and `.../webgpu/alpha-hash.png` side by side, labeled "mask" and "hash". These two show the same cards from the same camera. If you want a "blend" panel, add `.../webgpu/transparency.png` (see-through planes and a sphere, drawn farthest first) and label it as a different scene. Alt text: "The same ring-patterned cards cut with the mask alpha mode, with hard edges, and with the hash alpha mode, as a stable dither". Place it under `## AlphaMode`.

`blending.png` could serve its own shot under `## Blending` (additive, multiply and sorted normal blending).

## Demo links

| Concept | Code | Verdict |
| --- | --- | --- |
| materials.shader | `shader-inputs/` | Keep. The code exists. The demo makes three `materials.shader` materials that read instance input, `object.worldMatrix` and `object.id`. |
| clear coat and sheen | `coat-and-sheen/` | Keep. The code exists. The demo uses `clearcoat`, `sheenColor` and `sheenRoughness`. Place it under `## StandardValues`, by the `clearcoat` and `sheenColor` rows (lines 270 to 274). `## StandardOptions` has no member rows. |
| iridescence and anisotropy | `iridescence-and-anisotropy/` | Keep. The code exists. The demo uses `iridescence`, `iridescenceIor`, `iridescenceThicknessRange`, `iridescenceThicknessMap`, `anisotropy`, `anisotropyRotation` and `anisotropyMap`. Place it under `## StandardValues` (lines 275 and 278). |
| transmission | `translucency/` | Reject the label. The translucency demo uses `diffuseTransmission` (light through leaves and a paper lantern), not `transmission` (glass). Keep this link as "diffuse transmission" by the `diffuseTransmission` row (line 266). For glass `transmission`, link `extra-shapes/` (`GLASS` in its sketch sets `transmission: 1`, `thickness` and `attenuationColor`, and the demo has no `code` value) by the `transmission` row (line 261). |
| subsurface | `subsurface/` | Keep. The code exists. The demo uses `subsurfaceRadius` and `subsurfaceColor`. Place it under `## StandardValues` (lines 268 and 269). |
| decals | `decals/` | Keep. The code exists. The demo calls `materials.decal` in `marks.ts`. `## DecalOptions` is the right place. |
| weighted blending | `weighted-transparency/` | Keep the link, move it. `weighted` is a value of `Blending`, not of `AlphaMode`. Place it under `## Blending`. The demo blends panes and smoke with `blending: 'weighted'` and can swap to `'normal'`. |

## Concepts said to have no demo

- `ShadowCatcherValues` (the shadow-catcher material): confirmed. No demo and no comparison under `examples/` uses `shadowCatcher`. The image test `shadow-catcher` has a reference at `tests/image/references/chrome-real-gpu/webgpu/shadow-catcher.png`: shadows of boxes, a sphere and a pole on a plane that draws only the shadows. That reference could illustrate the `shadowCatcher` row under `## Materials`.
