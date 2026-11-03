# D-310: one plant shader shows each leaf in its record's colours, and lights bark along its own branch

Status: decided. The plant shader, its constants texture, the materials, the page's texture loading
and the calibration, bark frame and download tests are built. The download test waits for a second
species with texture files. Task: none.

Summary: one WGSL file draws wood, shoot rows, cards, merged foliage and extras. A leaf's texel is
divided by its face's texture mean and scaled by the record's colour, and the share of light that
passes through comes back out of the base colour. One oak leaf, drawn from the oak's shipped
textures, shows its record's reflectance front-lit, its transmittance back-lit and both under an
even sky within 2.5 per cent on WebGPU, compatibility mode and WebGL2. The audit measured 38 to 58
per cent for the first generator's leaves.

## Question

How does one shader draw every part of every species so that a leaf shows the colours of its
reference, its underside its own picture, and bark its relief along each limb, on all three GPU
paths, within the six textures and 26 numbers that a custom material has?

## Rule

The plant core's acceptance for the material ([D-305](D-305-plant-core-three-scales.md)): leaf
calibration within 3 per cent of the record's reflectance, transmittance and sky value on the three
paths; bark relief lit along a lying limb; six textures and at most 26 numbers; the shader pack
compiles it; the wind block copy test passes; a page fetches only what it places.

## Data

The calibration record keeps the oak's texture means as its reflectances (upper 0.043, 0.086,
0.019; lower 0.234, 0.297, 0.232) and a transmittance of 0.07, 0.12, 0.025. One leaf a metre long
draws at 256 pixels to the metre, so it reads the texture's 256-texel level, beside reference
squares of the engine's standard material lit by the same light. The test reads the leaf's pixels
two pixels in from its edge, and scales each reference by the texture's own mean over the same
inner texels against its whole-blade mean (upper 0.98, 1.01, 1.07; lower 1.01, 1.01, 1.02), and
not its highlight, which a black glossy square measures. Apple M5 Max, Chrome, real GPU.

| Leaf against its reference (red, green, blue) | WebGPU | Compatibility | WebGL2 |
| --- | --- | --- | --- |
| Upper face, sun in front | 1.005, 0.998, 0.997 | 1.004, 1.002, 1.008 | 1.017, 1.012, 1.025 |
| Upper face, sun behind | 0.994, 0.995, 1.003 | 0.996, 0.997, 0.999 | 0.986, 0.988, 0.983 |
| Upper face, even sky | 1.000, 0.995, 1.003 | 1.000, 1.000, 1.003 | 0.994, 0.997, 0.991 |
| Lower face, sun in front | 0.998, 0.998, 1.008 | 1.002, 1.002, 1.003 | 0.992, 0.995, 0.992 |
| Lower face, sun behind | 0.993, 0.995, 0.995 | 0.994, 0.995, 0.994 | 0.997, 1.002, 0.999 |
| Lower face, even sky | 1.004, 1.007, 0.998 | 1.001, 1.001, 1.003 | 0.998, 1.002, 1.000 |
| Contrast under the sky over the texture's (upper, lower) | 0.94, 0.93 | 0.94, 0.93 | 0.93, 0.92 |

| Bark frame: a limb with ridges along it, standing and lying, mean brightness difference in steps of 255 | WebGPU | Compatibility | WebGL2 |
| --- | --- | --- | --- |
| Lying, turned back a quarter turn, against standing | 0.46 | 0.45 | 0.46 |
| Ridged against flat relief, standing | 24.1 | 24.3 | 24.3 |

The oak's leaf colour file keeps its coverage at every mip level: 0.364 of the texels at 1,024,
0.364 at 256, 0.379 at 16. Its decoded means are within 1 per cent of the manifest's in every
channel at levels 0 to 3.

How the data was produced: `tests/image/plant-calibration.spec.ts` and
`tests/image/plant-bark-frame.spec.ts`, which print these figures, and a decode of
`leaf-color.ktx2` with the asset tool's Basis Universal build.

## Look

Two faults the owner saw in the leaves package's first oak leaf came from its preview, which drew
the reference pictures with the standard material. Its pale, see-through rim was the source
picture's soft alpha under alpha to coverage; the shader sharpens the shipped texture's coverage
to a one-pixel edge at the cutoff, so a blade draws solid to its cut. Its grey, flat underside was
too much light and gloss on a mirrored picture; the shader reads the lower layer at the upper's
coordinates and scales it to the record's lower colour, so the underside keeps its picture's
colour and 92 to 93 per cent of its contrast.

## Decision

- **One file, five roles.** A `mode` uniform picks wood, shoot rows, cards, merged foliage or
  extras. Every texture read in a branch uses explicit gradients or a level, so each role samples
  in uniform control flow on every path. The six textures are the wind field, the records, two
  arrays (colour and relief) and two 2D slots whose meaning each role sets; the uniforms are nine
  numbers.
- **Leaf light.** Per face, base colour = texel × reflectance / face mean / (1 − share), with
  share = mean transmittance over mean reflectance plus transmittance; the light through is
  transmittance / share × texel / face mean. The engine keeps one less the share for the front and
  passes the share, so the averages come out as the record's. The light through is divided by one
  less the gloss's directional albedo (Karis's fit), which the engine keeps from it, and the leaf's
  light by its relief normal's cosine, since the record's colours were seen on leaves with their
  relief. Autumn mixes both colours toward the record's autumn ones by the `season` uniform, or by
  a merged leaf's own browning in its second coordinates' y, so a dying frond browns in summer.
- **Normals.** A tangent frame from screen derivatives of position and texture coordinates, for
  every role; the lower face reads the relief inverted. The mapped normal's spread widens the
  roughness. Bark relief therefore runs along each limb.
- **Sky light and occlusion.** Shoot rows take their sky visibility and bent normal from their row,
  through `s.ambientNormal` and `s.occlusionByMinimum` ([D-304](D-304-sky-normal-and-occlusion-once.md)).
- **Records texture in half floats.** A data texture is `rgba8unorm` or `rgba16float`, not the
  design's 32-bit floats. A half float keeps whole numbers only to 2,048, so a wind record's parent
  id goes as a high byte in the first texel's fourth number and a low byte in the fourth texel's
  fourth, and the species box as a high half and a remainder each for its corner and its size.
- **Quantised parts.** Wood, cards, merged foliage and extras keep their 16-bit positions; the vertex
  offset turns them into metres from the header's box, so a copy's transform places them. A batch of
  them sets `setBoundingRadius(plantBoundingRadius(box))`.
- **A matte.** `matte: true` draws the plant black with its cut-outs and sway, for the review's
  silhouettes.
- **Every role masks.** One WGSL file declares the coverage function, and the engine refuses it on
  an unmasked material, so wood is masked too, with an alpha that is always whole.

Options rejected:

- A vein mask that passes less light through veins. Its clamp lifted the average of the light
  through by 3 to 4 per cent on the oak's upper face; light through pale veins shows pale, as the
  texel over its mean gives, and keeps the average exact.
- Dividing by the manifest's mean alone, without the gloss and relief terms: the light through came
  out 3 per cent low on every path.
- A separate WGSL file for wood, without a coverage function, so wood could stay unmasked. The
  design keeps one shader; the cost of masked wood is for the near pool package to measure.

## Consequences

- `packages/vegetation/src/render/{plant.wgsl,material,records,textures}.ts` hold the shader, the
  materials, the header and the page's loading. `PlantMaterials` gains `extras`;
  `PlantMaterialOptions` gains `matte`.
- The engine's vertex variants list each attribute once: a custom material whose vertex offset reads
  the vertex colours and whose material turns them on built a WebGPU pipeline with the colours
  twice, which WebGPU refused (`packages/engine/src/gpu/vertex-format.ts`).
- The near table is read by sampling at texel centres: WebGL2 cannot both fetch and sample one
  texture, and the wood role samples the same slot.
- The near pool package (N1) writes shoot rows' value x, a wind id up to 65,000, split as the
  records are, since a WebGL2 device may keep row values at half precision.
- The download test skips until two species ship texture files.
- The tangent frame is a port of three.js's `getTangentFrame`, so `@null3d/vegetation` ships a
  `THIRD-PARTY-NOTICES.txt` with three.js's MIT licence. The notices guard refuses a package whose
  shipped code names three.js without one (`tools/lib/notices.ts`).
