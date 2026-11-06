# D-328: the oak's bark carries its photograph's color, and the review lights a bark close-up from the camera

Status: decided and built. The oak record, the plant shader's lichen mask, the young-bark radius,
the texture tool's bark smoothing, the plant review's bark views and its patch measure, and the
oak's Mac picture references carry it. The round-7 review is pending. Task: none.

Summary: the oak's bark carried a 4.5 brightness multiplier that offset the review's dim daylight.
It drove every sunlit limb to near-white. Removing it and lighting the two bark close-ups from the
camera takes the bark texture pair from 11.7 to 4.8 color steps by the middle-third measure, and the
winter wood from 20.7 to 3.8. The bark tile's middle matches its source to 0.3 of a step. The
close-ups now average nine patches, and the fixed trunk view reads 5.96 at the old base and 5.93 at
the merged base, so the figure follows the material rather than the framed window. Lichen now sits
in separate sage patches, and the young-bark tile covers thin wood at its own scale.

## Question

The bark read chalk-white on the limbs, the bark close-up read 11.7 color steps off its picture, and
the young-bark picture showed no lenticels. Which change makes a bark surface keep its photograph's
color in the review, and show its own figure at close range?

## Rule

The review compares a surface with a picture of that surface. So the render must show the texture's
own color under a light that leaves a face turned to the camera as its albedo. The leaf texture
views already do this. The better look wins where two options differ ([hard rule 40](../../AGENTS.md#hard-rules)).

## Data

Color steps are CIEDE2000 between the middle third of each picture, as the review measured it before
this record's last commit. The plant is seed 11, variant 0, preset high, and the pictures are the
oak's reference set.

| Measure | Base | Final |
| --- | --- | --- |
| `26-bark-texture` surface | 11.67 | 4.78 |
| `28-young-bark` surface | 9.22 | 3.44 |
| `20-winter-branch-architecture` bark | 20.74 | 3.84 |

The base is run `refit-full` at `99b001ae8`. The middle column is run `bark-final2` at
`47c0f417c`, which is that base plus this record's commits. The right column is run `bark-merged1`
at `c6710d413`, which merges `pkg/s0`'s thicker bole, camera anchor fix, twig camera, heavier
collar and outline masks. Every figure was drawn on the Mac's GPU with the same seed, variant and
preset. The reviewer's own winter-wood figure at the first base was 15.9, from the same wood region.

| Measure | Base `99b001ae8` | At `47c0f417c` | Merged base `c6710d413` |
| --- | --- | --- | --- |
| `01` bark | 1.25 | 9.22 | 7.46 |
| `02` bark | 17.07 | 27.1 | 27.76 |
| `18` bark | 1.13 | 1.13 | 1.48 |
| `26` surface | 11.67 | 4.78 | 7.29 |
| `28` surface | 9.22 | 3.44 | 7.10 |
| `20` bark | 20.74 | 3.84 | 4.68 |

The middle-third figures moved with the base while the bark material did not. The thicker bole frames
another phase of the tiled bark, and the young view picks another thin limb. A window that catches
more furrows reads darker, and a limb that faces the stand light reads brighter. So the close-up
measure takes nine patches now: each is a fifth of the picture a side, centred at a fifth, a half and
four fifths each way. The patches do not overlap, they cover different phases of the tile, and their
mean is one number per texture source. Re-compared from the saved pictures, with the new measure:

| Measure | Old base `47c0f417c` | Merged base `c6710d413` |
| --- | --- | --- |
| `26` surface | 5.96 | 5.93 |
| `28` surface | 5.71 | 1.06 |

The fixed trunk view moves by 0.03 between the bases, which is the stability the patch average
buys. The young view moved more because its sample changed: the new tree's thin-limb request picks
another limb, against another background. The material did not change. The bark tile's middle third
is CIELAB 46.4, 1.5, 3.3 against reference `26`'s 46.1, 1.5, 3.8. The young tile's mean is 51.1,
−2.0, 8.8 against reference `28`'s 50.1, −1.7, 9.9.

| Step | 26 | 28 | 20 bark |
| --- | --- | --- | --- |
| Base: bark tint 4.5, bark close-ups in daylight | 11.67 | 9.22 | 20.74 |
| Bark tint 2.8, bark close-ups in daylight | 14.79 | 8.63 | 13.63 |
| No tint, both bark close-ups in the copy-stand light | 4.49 | 8.26 | 3.65 |
| Smooth 8-texel bark relief | 3.8 | 9.9 | 3.63 |
| Lichen patches and the young-bark view on thin wood | 4.78 | 3.44 | 3.84 |

The tint caused the white wood. The bark texture's mean is 0.207, 0.192, 0.183 in linear light. The
tint made it 0.93, 0.87, 0.82, so a limb in the sun sat at the top of the range. The winter
skeleton's middle third read lightness 70 against the reference's 43. Its blue-yellow axis read −5
against +14. Lowering the tint alone darkened the close-up away from its picture. So the close-up
needs a light that leaves the surface as its albedo, not more albedo.

The bark figure's fine crackle came from the relief map. The height field read every small crack of
the photograph as a ridge, and the lit result read as a cellular herringbone. The picture shows
long vertical plates. A blur of 8 texels at a 1024 tile before the height field keeps the plates and
drops the cracks. The bark tile's color is unchanged.

The young-bark picture framed a limb of 0.25 m radius. That is above the 4 cm radius that the young
layer covered, so the layer never showed. The view now picks the exposed limb whose radius at the
framed point is nearest the thickness it asks for. It stands outside the plant, and it frames one
young tile. The young layer now covers wood under an 8 cm radius, which includes the winter
skeleton's twigs.

The copy-stand light was fixed to one world direction, so a view turned away from it drew almost
black. It now points along the camera's own view, as its comment said. A view at turn 0 is
unchanged, so no close-up figure moved for that reason alone. The light itself was never the
problem: the earlier trial that rejected it put it on bark whose albedo was 4.5 times the texture.

Lichen was near-white at 0.9 amount, in 2 cm grains: a wash. It is now a sage green of 0.38, 0.45,
0.34 in linear light. It sits in 4 cm grains on the plate crests and the upward faces, with a sharp
edge.

## Look

The physical bark color is the better look. The limbs read grey-brown with their own ridges and
lichen. The white silhouette lost the species' character and hid the furrows. The bark close-up
shows the picture's long plates, and the young stem shows its pale lenticels. The reference pictures
agree: they show a warm grey-brown bark, not a white one.

## Stated limits

**The whole-view trunk tone.** The bark measure of a whole summer view is the mean color of the
plant below the crown. It moved from 1.25 to 7.46 on `01`, and from 17.07 to 27.76 on `02`, at the
merged base. The cause is the light, not the bark color: the review's daylight is dim, and the dense
crown shades the trunk in those views. The reference trees stand in open sun, so their trunks read
pale. A tint that lifts the shaded trunk back to the reference's tone is the same tint that whitens
the sunlit limbs, which is the fault this record removes. This stays a stated limit.

The shared daylight was tested rather than assumed. Runs `sun19`, `sun26`, `sun34`, `sky15` and
`sky20` at the merged base measured the same four figures together on the Mac's GPU:

| Light | `01` bark | `01` foliage | `26` surface | `20` bark |
| --- | --- | --- | --- | --- |
| Sun 1.9, the current light | 7.46 | 10.79 | 5.93 | 4.68 |
| Sun 2.6 | 7.44 | 10.23 | 5.93 | 5.17 |
| Sun 3.4 | 7.40 | 9.64 | 5.93 | 6.42 |
| Sky ×1.5, sun 1.9 | 5.82 | 8.49 | 5.93 | 8.14 |
| Sky ×2, sun 1.9 | 4.73 | 6.48 | 5.93 | 12.45 |

The sun cannot reach the shaded trunk, so `01`'s bark barely moves as the sun rises. The sky term
reaches it: doubling the sky takes `01`'s bark to 4.73, still far from 1.25, while the winter wood
falls from 4.68 to 12.45. No shared light level both closes `01` and holds `20`. The bark close-up
is independent of the shared daylight, since its view uses the copy-stand light, so it stays at
5.93 in every run.

**The close-up measure is stable.** The nine-patch average reads 5.96 on the old base and 5.93 on
the merged base for the fixed trunk view. The young view's sample changed with the tree (another
limb against another background), so its two figures do not compare one sample. The materials are
unchanged, and their albedos match their sources.

The row 8 evidence is the close-ups and the winter skeleton. At the merged base the close-ups read
5.93 and 1.06 by the patch measure, and the winter wood reads 4.68 by the bark measure. The winter
skeleton's wood had a median lightness of 45.9 against the reference's 43.3 at the previous base.
Its blue-yellow axis read 7.0 against 14.2, so the wood is a little cool.

## Decision

Take the physical bark color and light the two bark close-ups from the camera.

Rejected: the copy-stand light while the tint stayed at 4.5. It read 24.0 and 27.5, because the
rendered albedo was 4.5 times the texture. Rejected: lowering the tint alone, which took the
close-up to 14.8 and away from its picture. Rejected: raising the albedo further, which saturates
sunlit limbs to white and leaves no room for lichen to read. Rejected: keeping the fine relief
bands, which turn a photograph's cracks into ridges over the plates.

## Consequences

- The oak's bark zone carries no tint, its young-bark radius is 8 cm, and its lichen is a sage green
  at full amount.
- `BarkLayerConfig` gains `smooth`, the texels of blur before the height field. The oak's trunk
  layer sets 8. The oak's bark relief file shrinks by 22 KB, and the shipped full set from 850.3 to
  833.9 KB. No measured file grows.
- The plant review's bark close-ups use the copy-stand light, and that light follows the camera. The
  limb view gains a `thin` request, the meters of radius it frames, and picks the limb by thickness.
- The plant review's bark texture sources compare nine non-overlapping patches spread over the
  picture's central eighty per cent, not its middle third. `patchLab` in
  `tools/lib/plant-review/compare.ts` makes the measure, and its test holds a tiled picture's figure
  still under a phase shift where one window moves by nine steps.
- The oak's three Mac picture references are redrawn at the previous base. The merged base moves the
  plant picture again, so the plant picture set needs one central redraw. The SwiftShader set is owed
  from CI's drawing.
