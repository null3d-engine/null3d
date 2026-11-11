# D-324: one plant shader shows each leaf in its record's colours, and lights bark along its own branch

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

The plant core's acceptance for the material ([D-323](D-323-plant-core-three-scales.md)): leaf
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

**Wind motion.** The review measures how much of a plant's outline changes between the frames of the
oak's wind clip. It does so in six bands from the base. The reference reads 0.039, 0.040, 0.021,
0.029, 0.036 and 0.072. The stand-in's records read 0.130, 0.057, 0.023, 0.024, 0.040 and 0.151. The
built records alone read 0.129, 0.056, 0.022, 0.024, 0.040 and 0.155, so where each branch turns
changes the motion little. The species' trunk sway moves the oak's top from 40 cm to 3 cm. It moves
the base band by 0.001, because the trunk leans with the gusts and does not swing between frames. A
render with the leaf flutter off reads 0.128, 0.056, 0.020, 0.022, 0.035 and 0.137. The leaves add at
most 0.019, in the top band.

The base band is the low crown's foliage on the branch chain. The render's foliage outside the trunk
changes 36 per cent of its pixels between frames. The reference's changes 13 per cent, and it covers
twice the reference's area. A branch's sway angle is the same at every length. So a long drooping
limb of the finest order swings as far as a short twig. The stiffness curve is by order, so it cannot
tell them apart, because both are the finest order here.

The oak's curve holds the great limbs and stiffens the twigs: 0.99 at the stem, 0.95 at the middle
order and 0.8 at the finest. The reference's own record describes the same: clumped foliage rocking
on stiff twigs, with heavy limbs still. It reads 0.065, 0.031, 0.015, 0.017, 0.028 and 0.105. The
base falls to 1.7 times the reference and the top to 1.5 times. Every band sits within about 1.7
times either way, and the middle is a little stiller than the reference.

## Look

Two faults the owner saw in the leaves package's first oak leaf came from its preview, which drew
the reference pictures with the standard material. Its pale, see-through rim was the source
picture's soft alpha under alpha to coverage; the shader sharpens the shipped texture's coverage
to a one-pixel edge at the cutoff, so a blade draws solid to its cut. Its grey, flat underside was
too much light and gloss on a mirrored picture; the shader reads the lower layer at the upper's
coordinates and scales it to the record's lower colour, so the underside keeps its picture's
colour and 92 to 93 per cent of its contrast.

## Stated limit: the crown's colour under the review's light

The whole-tree crown cannot reach 3 colour steps on every view at once. The review draws the tree
under its own sun, and the photographs were taken in sunlight from a different direction. A leaf
colour that matches the sunlit crowns over-brightens the leaf-face stills; a colour that matches the
leaf faces leaves the crowns dark. The targets pull opposite ways, so no albedo or transmittance
value moves all of them inside 3.

Measured on the oak, seed 11, variant 0, stills and turn (colour steps, CIEDE2000; lower is better):

| Leaf transmittance (red channel) | Crown 01 | Crown 02 | Cluster still 11 | Oak turn |
| --- | --- | --- | --- | --- |
| 0.091 (kept, `4cb4659f6`) | 9.3 | 7.8 | 2.5 | 3.4 |
| about 0.15 | 2.6 | 1.6 | 9.4 | not measured |
| 0.238 (reverted) | 1.9 | 3.3 | 16.0 to 19.4 | 8.7 |

The kept record value is `[0.091, 0.195, 0.0195]`, which is 1.3 times the earlier
`[0.07, 0.15, 0.015]`; the table gives its red channel. The raise answers the crown's grain, which
crowds the sprays at the limb ends and so darkens the crown. Measured on its own, before the bark
work, the raise took the two crowns from 9.7 and 7.8 to 8.3 and 6.5. On the current base the raise
and the crowd act together, and the larger leaf since then adds about a step. The leaf-face stills
use the copy-stand light, which has no light behind the leaf, so they read 2.3 and 2.4 on both faces
(`24` and `25`) at every setting.

**Limit.** The record keeps its transmittance. The crown reads about 9 steps at `01` and 8 at `02`;
the leaf faces read 2.3, the cluster 2.5 and the turn 3.4. Closing the crown to 3 costs the cluster
up to 19.4 and the turn 8.7, which is refused. This is a stated limit, not open work.

A fine-leaved crown reads further from its photograph than the oak's, for a second reason that no
record answers. A drawn card texel covers about four fifths of its footprint with leaf at the whole
view, and the cutoff draws all of that footprint as leaf. So the crown's mean colour is its leaf's
own colour, where the photograph mixes leaf and sky inside a pixel: a third of the ash's crown
pixels are pale blends. The ash reads about 11 steps at its two whole views against the oak's 8.9.
A ray through our crown crosses about two and a half times the leaf area that the photograph
implies, so the crown's colour and its sky gap cannot both match the same picture. A crown as thin
as the photograph's is the grown shoots' count, which is the record's work.

The gaps cannot simply show the sky's light instead. The sky's radiance is about three times a
sunlit leaf's, so a fifth of a texel taken from the sky adds more light than the leaf it replaces,
and the crown washes out pale.

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
- **A card's alpha is its coverage.** A card texel's alpha is the share of the texel that its leaves
  cover, and a mip level's alpha is that share over the level's footprints. The material raises the
  alpha with the mip level, so a far card's thinnest leaves stay over the cutoff instead of falling
  under it. The rise is small, because a large one draws leaves that the level does not hold. At the
  whole view the ash's cards read mip 0.7 to 2.4, weighted to 1.5.
- **Records texture in half floats.** A data texture is `rgba8unorm` or `rgba16float`, not the
  design's 32-bit floats. A half float keeps whole numbers only to 2,048, so a wind record's parent
  id goes as a high byte in the first texel's fourth number and a low byte in the fourth texel's
  fourth, and the species box as a high half and a remainder each for its corner and its size.
- **Quantised parts.** Wood, cards, merged foliage and extras keep their 16-bit positions; the vertex
  offset turns them into metres from the header's box, so a copy's transform places them. A batch of
  them sets `setBoundingRadius(plantBoundingRadius(box))`.
- **A matte.** `matte: true` draws the plant black with its cut-outs and sway, for the review's
  silhouettes.
- **The whole plant's sway.** The trunk bends at its species' own size and rate. The records
  texture's header carries the sway that the species record names: the metres its top moves in the
  field's base wind speed, and the cycles a second. The offset grows with the air's speed, so a
  species that names a small sway holds its trunk nearly still while its branches carry the motion.
  A stem that leaned a fixed share of its length moved the oak's top 40 cm at 4 m/s, where its
  record names 3 cm.
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

## Addendum: the crown's shade on bark

The wood role takes the crown's baked sky visibility as its occlusion. That occlusion darkens the
ambient, hemisphere and environment light, but not the sun. The bake keeps a mean of 0.31 of the sky
on the holm oak's nearest wood. It keeps 0.37 on the weeping willow's and 0.52 on the common
alder's. So a bark view drawn in daylight loses most of its sky light under the crown.

The holm oak's base view drew 24.36 L against its photograph's 37.27. The copy-stand bark views take
no ambient light, so the term did not reach them. Their flat bark source read 2.65 and their mid
trunk 0.93, both inside the band. The shader now mixes the wood's occlusion toward full by
`WOOD_SHADE` (0.35). Bark therefore keeps about a third of the crown's shade.

Two runs at `4ad6bff87`, `dirty: true`, measure it. `holm-shade35` moves the holm oak's base from
11.26 to 7.28 steps. `alder-shade35` moves the common alder's base from 8.64 to 7.39. The willow's
limb stays at 16.91. Every mid-trunk keeps its figure, and the copy-stand frames are byte-identical.
A third run, `holm-shade0`, switches the term off and reads 6.11. The remaining 3.7 L and 3.9 a are
the base zone tint's green, which the species record owns. A tint must not answer it, because the
record's two tint attempts split the stool. The meshes are unchanged: the holm oak and the willow
hash the same before and after through `tools/plant-mesh-hash.ts`.
