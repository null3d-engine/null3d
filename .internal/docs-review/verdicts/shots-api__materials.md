# Shot and demo-link verdicts: api/materials (slice api-2)

Page checked: docs/api/materials.md (the hand-written materials page, not docs/api/reference/materials.md).
All reference paths below are under tests/image/references/chrome-real-gpu/.

General note: every demo reference picture (demo-*.png) is 320 x 180 pixels. Test-page pictures are 480 x 270 or 640 x 360. The demo pictures show their subject, but fine detail (parallax depth, the beetle's film) is hard to see at that size. If the website shows them wider than about 320 px, capture the demo again at a larger size.

## Shots

| Shot | Keep | Verdict |
| --- | --- | --- |
| standard-grid | yes, change source | The picture exists: webgpu/standard-grid.png (480 x 270). It shows 3 rows x 5 columns of one color: roughness changes across, metalness down. It suits "Standard values". The source is wrong: it is a stored reference, not a scripted capture. Use source "reference", referenceImage webgpu/standard-grid.png. |
| coat-and-sheen | yes | webgpu/demo-coat-and-sheen.png exists and shows the red car on a plinth, rain on the cobbles and the velvet seat. Caption and alt match. |
| iridescence-and-anisotropy | yes | webgpu/demo-iridescence-and-anisotropy.png exists and shows the beetle on a brushed metal plinth with soap bubbles. Small, but the subject reads. |
| translucency | yes | webgpu/demo-translucency.png exists and shows backlit leaves and petals under a low sun, with the paper lantern. |
| subsurface-on-off | no, replace | The test pages are not wax and jade. "subsurface" shows two skin-colored panels crossed by a shadow bar: left plain, right with scatter. "subsurface-off" shows both plain. The caption and alt are false. Also, the two-page side-by-side is not needed: webgpu/subsurface.png alone already shows off (left) and on (right). Replacement: reference webgpu/demo-subsurface.png (candles, jade knot, soap egg by candlelight), alt "Wax candles, a jade knot and a soap egg that glow softly by candlelight". If an on/off comparison is wanted, use webgpu/subsurface.png alone with alt "Two skin-colored panels crossed by a shadow; on the right, light spreads red into the shadow". |
| decals | yes | webgpu/demo-decals.png exists and shows the zebra crossing, road paint, puddles and posters on a dusk street. |
| relief | yes | webgpu/demo-relief.png exists and shows hills, boulders, the brick wall and the wireframe frame. Parallax depth is hard to see at 320 px. A pair with the demo's Parallax choice On and Off would show it better, if recaptured larger. |
| alpha-modes | yes, correct it | All four pictures exist as references, so nothing needs capturing. But the content is wrong. The alpha test page draws ring-shaped cards, not leaves. "blending" is a different scene (additive and multiply blending, sorted quads, render order), not the blend alpha mode on the same cards, and the alpha test page has no blend mode. "alpha-coverage" looks the same as "alpha-mask" at this size. Use two panels: webgpu/alpha-mask.png and webgpu/alpha-hash.png. Alt: "Ring-shaped cut-out cards drawn with the mask mode and with the hash mode". |
| weighted-vs-moments | no, replace | The three references exist (webgpu/moment-sorted.png, moment-weighted.png, moment-layer.png), so "scripted" is wrong. Worse, the three pictures look almost the same: five flat colored panes, with only small tint changes. A reader learns nothing from them side by side. Replacement for "Weighted blending": reference webgpu/demo-weighted-transparency.png (stained glass panes and smoke in a pavilion), alt "Crossing panes of stained glass and smoke blended in any order". |
| shader-inputs | yes | webgpu/demo-shader-inputs.png exists and shows the ring of crystals and three banded stones. Matches "Custom materials". |

## Demo links

All codes below exist. depth-only and extra-shapes have no code field in examples/demos.ts, so "<name>/" is the right form.

| Concept | Code | Keep | Reason |
| --- | --- | --- | --- |
| Clear coat and sheen | coat-and-sheen/ | yes | Code in demos.ts; the sketch builds clear-coated paint, wet cobbles and velvet sheen. |
| Iridescence and anisotropy | iridescence-and-anisotropy/ | yes | Code in demos.ts; beetle film and brushed-metal plinth. |
| Diffuse transmission | translucency/ | yes | Code in demos.ts; backlit leaves, petals and a lantern. |
| Subsurface light | subsurface/ | yes | Code in demos.ts; wax, jade and soap with subsurface scatter. |
| Decals | decals/ | yes | Code in demos.ts; projected decals on a street. |
| Bump, displacement and parallax | relief/ | yes | Code in demos.ts; displacement, parallax and bump maps, with a Parallax switch. |
| Weighted blending | weighted-transparency/ | yes | Code in demos.ts; crossing panes and smoke with weighted blending. |
| Custom materials | shader-inputs/ | yes | Code in demos.ts; custom material that reads per-row and per-object inputs. |
| Scene depth behind a surface | water/ | yes, with care | The demo shows the result (shallow color and foam at the shore), but its sketch never calls the scene-depth function. The call lives in the water add-on's shader (packages/water/src/water.wgsl). The link text must say the water add-on does this, so a reader does not hunt for the call in the sketch. |
| Invisible surfaces that hide | depth-only/ | yes | No code field, so depth-only/ is right. The sketch uses colorWrite: false on a holdout plane in front of a page. |
| Dispersion in glass | extra-shapes/ | yes | No code field, so extra-shapes/ is right. The sketch gives one glass material dispersion: 0.6. |

## Concepts said to have no demo

| Concept | No demo? | Demo that shows it |
| --- | --- | --- |
| Shadow catchers | confirmed | none; no example uses the shadow catcher material |
| Light maps and directional light maps | confirmed | none; no example uses lightMap |
| Wireframe | wrong | relief/: a geodesic frame drawn with wireframe: true stands on the hill and casts a shadow of lines (examples/relief/sketch.ts) |
| Depth bias | confirmed | Only the island showcase (showcase/island/) uses it, on one window material deep in town.ts. Nothing in the picture shows it, so it is not a useful demo link. |
| forceSinglePass | wrong | depth-only/: its double-sided blended glass panes use forceSinglePass: true. Link it under "Double-sided blended surfaces". (coat-and-sheen/ also uses it, on the rain, which is less clear.) |
