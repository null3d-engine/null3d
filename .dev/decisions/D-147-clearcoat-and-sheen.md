# D-147: Clearcoat and sheen

Status: decided by the helper of M2-EX30 on 12 October 2026, for the owner's review. The owner approved the map slots' trade-off on 11 October 2026 ("The owner's ruling"), and the look of the demo, `examples/coat-and-sheen`, on 12 October 2026. Built: the clear coat and the sheen are on main (`ca28c9fdd`). The owner's review of the rest of the design is pending. Date: 2026-10-11. Task: M2-EX30.

Summary: The standard material takes a clear coat and a sheen layer, with the names and formulas of three.js's `MeshPhysicalMaterial`, and the glTF loader reads `KHR_materials_clearcoat` and `KHR_materials_sheen` into them. The sheen's loss of energy comes from three.js's curve fit, a stated approximation that needs no table. One permutation bit, `COAT_SHEEN`, gives both layers shader builds that load on first use. The layers' maps take three map slots that a layered material cannot use otherwise, so no GPU path binds a texture more.

## Question

The showcase scenes need car paint, wet stone, cloth uniforms and velvet ([D-132](D-132-showcase-look-and-features-2026-10-11.md)). On the evening of 11 October 2026 the owner moved clearcoat and sheen into the work before 1.0, to make the demos as good as they can be. glTF files describe them with two extensions that the engine ignores today, so a port of a product scene loses its look. How does the standard material take a coat and a sheen? How do their maps fit in the texture bindings that every GPU path allows, and what do materials without them pay?

## Rule

- The intent of the two glTF extensions, with three.js's `MeshPhysicalMaterial` and `GLTFLoader` (0.186.1) as the reference ([D-52](D-52-intent-parity.md)). The best technique is the default, and an approximation is stated with its error.
- One look on all three GPU paths, with image references on the Mac's GPU and on SwiftShader.
- Zero cost while no material has a layer: no download, no bind group change, no new row reads, and the builds of other materials stay bit for bit the same.
- WebGPU's default limit of 16 sampled textures per shader stage holds, with room for the parallax builds of M2-J4. WebGPU never picks a map's texture with a switch: in Chrome on Apple GPUs with MSAA, such a switch made every textured draw many times slower ([D-89](D-89-webgl2-texture-units.md)).
- No allocation per frame ([AGENTS.md](../../AGENTS.md#hard-rules), hard rule 1). New shader code loads on first use, each file within 32 KB after Brotli ([D-56](D-56-first-use-shader-files.md)).

## What three.js does

`GLTFLoader` makes a `MeshPhysicalMaterial` for either extension:

| glTF | three.js |
| --- | --- |
| `clearcoatFactor`, default 0 | `clearcoat` |
| `clearcoatTexture` (red) | `clearcoatMap`, linear |
| `clearcoatRoughnessFactor`, default 0 | `clearcoatRoughness` |
| `clearcoatRoughnessTexture` (green) | `clearcoatRoughnessMap`, linear |
| `clearcoatNormalTexture`, with its `scale` | `clearcoatNormalMap`, `clearcoatNormalScale` (the scale on both axes) |
| `sheenColorFactor`, default black, linear | `sheenColor`, with `sheen` set to 1 |
| `sheenColorTexture` (RGB) | `sheenColorMap`, sRGB |
| `sheenRoughnessFactor`, default 0 | `sheenRoughness` |
| `sheenRoughnessTexture` (alpha) | `sheenRoughnessMap`, linear |

Its shader (`lights_physical_pars_fragment`, `meshphysical.glsl.js`) then does this:

- The coat is a second GGX lobe with a reflectance of 0.04 head on and 1 at grazing angles. It lights with the coat's own normal: the mesh's normal, or the coat normal map in the base normal map's tangent frame. Its roughness is raised to at least 0.0525, plus the geometry's roughness, as the base layer's is. The environment's prefiltered light at the coat's normal and roughness gives its indirect light, through the split-sum table. The occlusion map darkens that light.
- Everything below the coat, emitted light and sheen included, is scaled by `1 - clearcoat * F`, where `F` is the coat's Fresnel term at the view angle. The coat's light, times `clearcoat`, is added on top.
- The sheen is the Charlie distribution (Estevez and Kulla) with Neubelt's visibility term, per light, times the sheen color. Each light's irradiance on the base layer is scaled by `1 - max(sheen color) * max(E(v), E(l))`, where `E` is the sheen's directional albedo. The sheen's indirect light is the irradiance times the sheen color times `E(v) / pi`, and the base layer's indirect light is scaled by `1 - max(sheen color) * E(v)`.
- `E` comes from a curve fit (`IBLSheenBRDF`), not a table.

## Options

### The sheen's albedo

| Option | Verdict |
| --- | --- |
| A: three.js's curve fit of the albedo | Chosen. It matches the reference renderer pixel for pixel, costs a few instructions and needs no texture |
| B: a table of the albedo, integrated from the Charlie lobe, as the Khronos sample viewer and Filament use | Rejected for now. The light would differ from three.js's at grazing angles, and the table would need a channel of the split-sum table. That table is RGBA, and its blue and alpha channels are spare on both GPU paths, so this stays open at no binding cost |
| C: a prefiltered Charlie environment, as the Khronos sample viewer uses | Rejected. It needs a second filtered cube per environment, its generation, and a texture binding that the budget does not have |

The fit's error, against a numerical integral of the Charlie distribution with Estevez and Kulla's visibility term at a sheen color of 1, is in "Data". It removes too little energy from the base layer at grazing angles, so the base shows slightly brighter there under a strong sheen, and the environment's sheen shows slightly dimmer. three.js draws the same.

### The material API

| Option | Verdict |
| --- | --- |
| A: options of `materials.standard` with three.js's names: `clearcoat`, `clearcoatRoughness`, `clearcoatNormalScale`, `sheenColor`, `sheenRoughness`, and five maps | Chosen |
| B: a new factory, `materials.physical` | Rejected, as [D-122](D-122-transmission.md) rejected it for transmission. One material model stays one material |
| C: three.js's `sheen` too, which multiplies the sheen color | Rejected. The sheen color alone sets the layer, and black, its default, gives no sheen. Three numbers for one color invite a material whose sheen never shows, since three.js's `sheen` defaults to 0. The mapping tells a port to multiply them |

Any of the layer options, given when the material is created, gives the material its layers, even with a coat of 0 and a black sheen. This picks the shader builds, so it is fixed, as transmission is. `set` changes the values later.

### The maps and the texture budget

The WebGPU fragment stage of the standard material's maps build reads 15 of its 16 textures today: 7 in the frame's group and 8 map slots. M2-J4's parallax builds add the displacement map, which makes 16. The layers bring five maps.

| Option | Textures in the WebGPU fragment stage | Verdict |
| --- | --- | --- |
| A: a binding for each layer map | 20, 21 with parallax | Rejected: past the limit |
| B: the layer maps share a few bindings, picked by a switch, as WebGL2's units are | 16 or 17 | Rejected: the switch is the cause of D-89's slowdown, and it still passes the limit with parallax |
| C: a pass that packs each material's layer maps into one texture on the GPU | 16, 17 with parallax | Rejected: a pass, a copy in memory of each map, and maps of other sizes, samplers and texture coordinates to reconcile |
| D: a raised limit where the device has one | 20 | Rejected: it needs a capability flag, and a fallback that would draw the same file differently |
| E: the three map slots of the light map and the two specular maps hold the layers' maps in a layered material | 15, 16 with parallax | Chosen |

With option E, a layered material's slot 5 holds the coat map, with the coat in red and its roughness in green. Slot 6 holds the coat normal map. Slot 7 holds the sheen map, with the sheen color in RGB and its roughness in alpha. That is how glTF packs them: an sRGB texture keeps its alpha linear, so one texture serves the sheen's color and roughness. The bindings, the bind group layouts, the texture store and WebGL2's six shared units stay as they are. On WebGL2, past six units, the coat map keeps its unit before the sheen map, and both before the coat normal map. The material's row flags say which channels of each map apply.

So a layered material takes no light map and no specular maps. Its specular values still apply. Development builds throw E1217 for a material that asks for both, with the fix in its message. Production builds skip that check, so there the material leaves those maps out, rather than read a light map as a coat map. The coat and coat roughness maps must be one texture, and so must the sheen color and roughness maps. The glTF loader keeps the first map of a pair whose textures differ, and notes the other. It also notes a specular map on a layered material. Of the 14 Khronos sample models with either extension, none has such a pair, none has a light, specular or transmission map beside the layers, and none has both layers in one material. Three of them use the specular extension's values with a sheen, which draw.

### Shader builds

One permutation bit, `COAT_SHEEN`, builds both layers, in the standard material's templates with and without maps. A layer that a material does not use is skipped in a branch that every pixel of the draw takes the same way. Two bits would make three times the builds, for a cost that only materials with one layer save. The builds load on first use, in the `coat_sheen` feature's files. A build that needs another feature too, such as skinning, goes into files of its own ([D-56](D-56-first-use-shader-files.md#addendum-2026-10-12-builds-that-need-several-features)), so no feature's files hold builds that only pages with another feature draw. A layered material's row grows by two `vec4f`s, which only the `COAT_SHEEN` builds read.

Custom materials get the layers too. The surface record gains `clearcoat`, `clearcoatRoughness`, `clearcoatNormal`, `sheenColor` and `sheenRoughness`. Only WGSL that names them builds the `COAT_SHEEN` builds, as only WGSL that names `transmission` builds the transmission builds. A wet stone can then set its coat from a wetness of its own.

The layers' math runs at full precision in the `HALF` builds, which keep the base layer at half precision. The shadow of the sun is looked up where either the surface's normal or the coat's normal faces the sun.

### Test time in CI

The bit joins every other bit of the lit templates, so it took the engine's WebGL2 programs from 3,404 to 5,996, and its builds with half precision held the fault that "Data" names. Each material bit that joins every other bit about doubles the WebGL2 programs that the shaders page compiles, and adds first-use files. The next such bit needs the same look at test time and at the files' sizes.

The shaders page grew from 9 parts to 15, which put the Safari shard that runs them at 12.0 minutes of pages in the model, past the limit of 10. A sixth Safari shard would wait for a second turn on GitHub's 5 macOS machines, and keeping the coat apart from some bits would drop those pairs for users. So CI's Safari compiles the builds without the bit and one part of a sample of those with it: the 192 programs that pair the coat only with shadows, row values, masks, normal maps' tangents, tone mapping, the draw index and half precision. Firefox on Linux compiles every build. [Device sessions](../devices.md#browser-apps-on-the-mac) has the rule.

### Cost and the quality governor

A material without layers pays nothing. A layered material pays, per pixel and per light, a GGX lobe for the coat and a Charlie lobe for the sheen, each skipped when its layer is off, and one more read of the environment for the coat. No preset turns a layer off, since that changes the material's look. The governor's render scale already bounds the cost.

### The owner's ruling

On 11 October 2026 the owner approved option E: the coat and sheen maps take the light map's and the specular maps' slots, so a coated or velvet material cannot also have a light map or specular maps. The owner asked that the engine say so clearly when a material asks for both. `materials.standard` and `materials.shader` throw E1217 in development builds, naming the map and the fix. The glTF loader warns in development builds and names the specular textures that it leaves out.

## Data

Measured on 11 and 12 October 2026 in Chrome on the Mac's GPU (Apple M5 Max), and on SwiftShader on the Mac for CI's images.

- The sheen fit: three.js's curve against the integral of the Charlie lobe with Estevez and Kulla's visibility. It is within 0.06 where the view's cosine is 0.5 or more and the roughness 0.3 or more. At grazing views it is low: 0.2 to 0.3 below at cosines of 0.05 to 0.1, and 0.81 below at worst, at roughness 0.1 and cosine 0.05. The mean difference over the grid is 0.13. The split-sum table's spare channels can hold a true albedo table later at no binding cost.
- Parity with three.js r186, nine Khronos model scenes on three tiers: 27 of 27 pass. On WebGPU, 0.000% to 0.018% of the pixels differ, and on WebGL2 0.000% to 0.020%. In compatibility mode, the clear coat test differs in 0.135% of the pixels, all on bright edges over black that compatibility mode's 8-bit path averages. Its scene takes a limit of 0.2%, like the instanced cubes. The toy car differs in 0.106% there, under the 0.18% by which three.js's two renderers differ.
- The stained-glass lamp (`gltf-ktx2`) now draws its clear coat: 0.16% to 0.18% of its pixels differ from three.js, down from 0.27% to 0.39%. Its image references did not change.
- Image tests: 1,020 per set on the Mac's GPU and on SwiftShader, after the last merge of main. All pass, with the demo's references made again for its approved look. Before the layers, the 922 tests of that time drew as before, and the 36 new ones (12 tests on three tiers) have references in both sets. The custom material that keeps the default surface draws the standard material's image. The layers turned off draw within one step of 8-bit color of a material without them.
- The behavioural check of the layers (`coat-sheen.spec.ts`) measures the mean channel difference between the scene drawn with the layers and the same scene with them turned off, and the share of channels that differ by more than 8 steps. The punchy AgX tone curve, the default since 13 to 14 October 2026, keeps that change in the mid-tones: the figures are 0.00905 to 0.00916 and 0.0505 to 0.0506 on every GPU path of both sets. A shader that skipped the layers would draw two identical images, so both figures would be 0. The floors, 0.004 and 0.025, are each half the smallest measured figure, so such a fault fails each by the whole floor. The floors were 0.01 and 0.05 when the tests were written on 12 October 2026, before that curve was the default.
- Shader files: the first-use files of the layers are 16.9 to 19.9 KB after Brotli, under the 32 KB limit. A build that needs another first-use feature too, such as skinning, goes into files of its own ([D-56](D-56-first-use-shader-files.md#addendum-2026-10-12-builds-that-need-several-features)), which are 17.1 to 22.2 KB, so no other feature's files grow. The start's JavaScript grew in `page-renderer.js` (+2.3%), `gltf-worker.js` (+3.1%) and `render-worker.js` (+2.4%), and the combos tables of each GPU path split by the half-precision bit, each under 3.8 KB after Brotli ([D-56](D-56-first-use-shader-files.md#addendum-2026-10-16-the-combos-tables-split-by-the-half-precision-bit)).
- Allocation: S1 with every box coated and sheened, on WebGPU, allocates 238.9 bytes per frame in the sketch worker and 561.5 in the render worker, within the budgets. On WebGL2 they allocate 220.7 and 162.7 bytes. A first WebGL2 sample put the sketch worker's clock reads 2.4 bytes over their budget of 4, at a place that the layers do not touch, and a second sample passed.
- GPU check: S4 and S6 at Medium and High changed by -0.5% to +0.9%, within the noise. After the last merge of main, they changed by -0.7% to +0.4%.
- Names that GLSL reserves: in a build that joins the coat with half precision, the half and full precision forms of the GGX visibility term each held a local `gl`. naga's GLSL writer named the second `gl_1`, which GLSL ES reserves, so all 2,592 WebGL2 builds with the bit failed to compile in CI's Chrome, Firefox and Safari. The locals have other names now, and the GLSL build fails on any name that starts with `gl_` and is no built-in (AGENTS.md hard rule 26).
- Cost in S1, with every box of the swarm coated and sheened, 3 runs of 10 s: on WebGPU the GPU time rose from 2.92 to 3.70 ms per frame (+0.78 ms, +27%). The CPU time stayed at 1.63 to 1.65 ms. On WebGL2 the GPU figure went from 4.66 to 4.12 ms, within its spread from run to run, so it shows no cost that it can measure.

## Consequences

- Code: the bit and the feature in `crates/null3d-gpu/src/drawlist.rs`; the row, its values and the map slots in `crates/null3d-render/src/materials.rs`; the draw key in `frame.rs`; the shaders `lib/coat_sheen.wgsl`, `lit.wgsl`, `lib/lights.wgsl`, `lib/globals.wgsl` and `lib/mesh.wgsl`, with the `coat_sheen` feature in the shader manifest; the custom materials' detection in the shader crate; the options in `packages/engine/src/scene/resources.ts`; the glTF reader.
- Docs: `api/materials`, `concepts/materials`, `shaders/surface-functions`, `api/assets` and `concepts/assets`, and the mapping entries `mat-physical`, `mat-clearcoat` and `mat-sheen`.
- Skills: the develop skill's quick reference and materials notes, and the port skill's materials notes.
- Tests: unit tests of the row, the builds, the options and the glTF reader; image tests of the layers, their maps, a custom material and the Khronos models; parity scenes with three.js; the first-use download test; a `--coat-sheen` switch for `bench:allocation`, and a `coatSheen` switch for the benchmark pages.
- Sample content: the Khronos models ClearCoatTest, ClearCoatCarPaint, ClearcoatWicker, SheenChair, SheenCloth, SheenTestGrid and ToyCar join the sample-assets repository.
