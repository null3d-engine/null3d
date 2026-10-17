# D-142: Eleven more techniques move into M2, and the other rulings of 11 October

Status: decided by the owner on 11 October 2026, at about 17:25 (UTC+8). It extends [D-132](D-132-showcase-look-and-features-2026-10-11.md). The techniques are tasks M2-EX26 to M2-EX36. Each one's design and figures go into a record of its own when it is built (D-143 to D-153). This record also lists six other rulings of the same day, five by the owner and one by the coordinator. Their own records hold them in full.

Summary: The owner said "make the demos as amazing as possible". So eleven techniques move into M2, most of them from M3 or after 1.0. They are physical sky and atmosphere, projected decals, area lights, a light probe grid, and clearcoat and sheen. They are also automatic exposure, box-projected reflection probes, weighted blended transparency, impostors and merged far geometry, terrain, and subsurface and foliage translucency. The same day, the owner turned software occlusion culling off on WebGL2 and kept AgX as the default curve. TAA waited until after 1.0, and motion vectors came before it; on 15 October 2026 the owner left TAA to M3-A11 (D-179). Low's bloom base is 64, and joint overrides join M2.

## Question

D-132 set a look bar for every demo, showcase scene and comparison, and moved six features before 1.0. The technique review of October 2026 still placed eleven more techniques in M3 or after 1.0. Each of them adds a look that the best scenes people share have, and that the showcase scenes and comparisons lack. Should they wait, or should they come now?

## Rule

The owner rules. The input is what the technique review ranked and placed, and what the showcase scenes need for D-132's look bar.

## Data

The techniques, with their place before this decision. The gap ranks are those of [Technique review, October 2026](../technique-review-2026-10.md#gaps-ranked):

| Technique | What the scenes use it for | State on 11 October | Place before this decision | Task now |
| --- | --- | --- | --- | --- |
| Physical sky and atmosphere | Skies of Creek, Battle and Night town, with distant objects tinted by the sun's angle | three.js's analytic sky, and the environment light made from it ([D-118](D-118-sky-environment.md)) | After 1.0 (gap 24) | M2-EX26 |
| Projected decals | Craters and scorch marks in Battle, street paint and puddles in Night town, moss on Creek's rocks | Not built | M3 ([D-53](D-53-technique-defaults.md) ruling 21; gap 13) | M2-EX27 |
| Area lights | Shop windows and neon in Night town, studio light | Not built | After 1.0 ([D-53](D-53-technique-defaults.md) ruling 20; gap 22) | M2-EX28 |
| Light probe grid | Colored bounce light in Night town, light under Creek's trees | Environment light only, from the built-in room or the sky | M3 (gap 21) | M2-EX29 |
| Clearcoat and sheen | Car paint, wet stone, cloth and velvet leaves | `KHR_materials_specular` and `KHR_materials_ior` are built. Clearcoat and sheen are not | M3 (gap 17) | M2-EX30 |
| Automatic exposure | Changes of mood in Creek, and the step from a lit street into shadow in Night town | Exposure set by the sketch ([D-53](D-53-technique-defaults.md) ruling 12) | After 1.0 (gap 25) | M2-EX31 |
| Box-projected reflection probes | Reflections of streets and rooms, with screen-space and planar reflections | Environment light and planar reflections ([D-120](D-120-planar-reflections.md)) | M3 ([D-53](D-53-technique-defaults.md) ruling 21; gap 16) | M2-EX32 |
| Weighted blended transparency | Smoke and fire in Battle, and glass | Sorted blending only | After 1.0, opt-in for particle scenes (gap 27) | M2-EX33 |
| Impostors and merged far geometry | Creek's forests, Night town's skyline, Battle's hills | LOD groups in progress (M2-I4, [D-132](D-132-showcase-look-and-features-2026-10-11.md)) | After 1.0, first in line among the rendering techniques | M2-EX34 |
| Terrain | Battle's hills and Creek's valley | Terrain made in code by each scene | After 1.0, as a package of its own (gap 31) | M2-EX35 |
| Subsurface and foliage translucency | Sunlit leaves and petals in Creek, and characters' skin | Not built | Not placed | M2-EX36 |

How the data was produced: the states come from the docs and the code on main on 11 October 2026. The places come from the technique review and D-53, and from the design's list of rendering techniques for after 1.0. The uses come from the plans for Creek, Battle and Night town.

## Decision

The owner ruled on 11 October 2026, in the evening, at about 17:25 (UTC+8).

1. **Eleven techniques move into M2.** The owner said: "make the demos as amazing as possible". Each technique is a task of priority P1:
   - M2-EX26, physical sky and atmosphere, from after 1.0;
   - M2-EX27, projected decals, from M3;
   - M2-EX28, area lights, from after 1.0;
   - M2-EX29, a light probe grid, from M3;
   - M2-EX30, clearcoat and sheen, from M3;
   - M2-EX31, automatic exposure, from after 1.0;
   - M2-EX32, box-projected reflection probes, from M3;
   - M2-EX33, weighted blended transparency, from after 1.0;
   - M2-EX34, impostors and merged far geometry, from after 1.0;
   - M2-EX35, terrain, from after 1.0;
   - M2-EX36, subsurface and foliage translucency, which had no place before.
2. **They start in waves.** The tasks start as helpers come free. The Mac's queue of browser runs limits how many run at once.

### The day's other rulings

Six more rulings came on 11 October 2026, between about 14:05 and 17:16 (UTC+8). The owner made five of them, and the coordinator one. Their records hold the figures and the detail.

| Ruling | Who and when | Record | What changes |
| --- | --- | --- | --- |
| Software occlusion culling is off on every WebGL2 preset | The owner, about 16:48 | [D-22](D-22-occlusion-presets.md) | In S6 it cost the job workers at least 3.5 times the render time it saved, on three phones and the iPad. It stays an option that a scene can turn on |
| AgX, with its punchy look, is the default tone curve | The owner, about 16:48, after a before and after page of 21 demos | D-79, which M2-E7 adds | Two demos keep ACES: morph-flowers and walk-and-fly |
| No temporal anti-aliasing (TAA) for 1.0. Per-object motion vectors move before 1.0 | The owner, about 16:48 | [D-129](D-129-temporal-anti-aliasing.md) | FXAA on Low and MSAA 4x from Medium up stay. Motion vectors are task M2-EX25 (D-140), the base for a later TAA attempt and for motion blur in M3 |
| Low's bloom base is 64. The Pixel 11 is a known exception to bloom's cost rule | The owner, about 14:05 for the 64 test, about 16:48 for the ruling | [D-21](D-21-effect-chain.md) | On the Pixel 11 no base of 64 or more costs as little as `UnrealBloomPass`'s steps did. A base of 64 comes closest |
| Joint overrides: game code sets or blends a skinned object's joint rotations each frame, on top of its animation | The owner, about 15:05 | D-139, which M2-EX24 adds | A small look-at helper comes with it. Battle's soldiers aim with it |
| A feature demo's sketch stays under 150 lines. Scenery may live in a sibling file in the demo's folder | The coordinator, about 17:16, under D-132's look bar. The owner may change it | This record, and [Examples](../examples.md#layout) | The sketch keeps the feature in view. The first such file is the particles demo's glade |

## Consequences

- **Tasks:** `m2-breakdown.md` gains M2-EX24 to M2-EX36. Each new technique ships the way any engine feature does, as [D-117](D-117-showcase-features-before-1-0.md#consequences) and D-132 say:
  - a design note and a decision record with its figures, D-143 to D-153 in task order;
  - tests and image references on all three GPU paths, or a fallback that its docs state;
  - docs, skills and the three.js mapping;
  - allocation and size checks, its cost per preset, and near zero when no scene uses it;
  - a feature demo at the look bar of the generators demo.
- **Add-ons:** terrain is an add-on module, a package of its own as before. Each technique with heavy machinery of its own follows [D-54](D-54-addon-modules.md). The others load their shaders on first use ([D-56](D-56-first-use-shader-files.md)).
- **Texture units on WebGL2:** area lights, a probe grid, reflection probes and decals each add per-pixel inputs. The rules in [Technique review, October 2026](../technique-review-2026-10.md#webgl2-texture-units) apply. All probe grids share one 3D texture, and reflection probes share one 2D array. The area lights' two tables are one 2-layer array.
- **Earlier records:** D-53's ruling 20 (area lights after 1.0) and ruling 21 (decals and box-projected probes in M3) point here. So does [D-14](D-14-js-budget.md)'s row for the area lights' tables.
- **Technique review:** the rows for these techniques in [Technique review, October 2026](../technique-review-2026-10.md#gaps-ranked) point here. A line under the table adds impostors and translucency, which have no row.
- **Examples guide:** the table of engine features for the showcase in [Examples](../examples.md#engine-features-for-the-showcase) gains the eleven techniques, motion vectors and joint overrides. Its layout table gains the scenery file.
- **README:** the roadmap's 0.2 step gains the eleven techniques.

## Addendum, 15 October 2026: TAA and the techniques after 1.0

The owner ruled on 15 October 2026 to settle every item that was set for after 1.0 ([D-179](D-179-technique-rulings-2026-10-15.md)). TAA no longer waits for after 1.0: M3-A11 decides it, and a "no" drops it ([D-129](D-129-temporal-anti-aliasing.md)). The light probe grid of this record's M2-EX29 becomes M3's global illumination, with a validity mask and a sky-occlusion term.
