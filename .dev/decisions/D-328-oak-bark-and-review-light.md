# D-328: the oak's bark carries its photograph's colour, and the review lights a bark close-up from the camera

Status: decided and built. The oak record, the plant shader's lichen mask, the young-bark radius,
the texture tool's bark smoothing, the plant review's bark views and the oak's Mac picture
references carry it. The round-7 review is pending. Task: none.

Summary: the oak's bark carried a 4.5 brightness multiplier that offset the review's dim daylight
and drove every sunlit limb to near-white. Removing it and lighting the two bark close-ups from the
camera takes the bark texture pair from 11.7 to 4.8 colour steps and the winter wood from 20.7 to
3.8. Lichen now sits in separate sage patches and the young-bark tile covers thin wood at its own
scale.

## Question

The bark read chalk-white on the limbs, the bark close-up read 11.7 colour steps off its picture,
and the young-bark picture showed no lenticels. Which change makes a bark surface keep its
photograph's colour in the review and show its own figure at close range?

## Rule

The review compares a surface with a picture of that surface. The render must therefore show the
texture's own colour under a light that leaves a face turned to the camera as its albedo, as the
leaf texture views already do. The better look wins where two options differ ([hard rule 40](../../AGENTS.md#hard-rules)).

## Data

Colour steps are CIEDE2000 between the middle third of each picture, as the review measures it. The
plant is seed 11, variant 0, preset high, and the pictures are the oak's reference set.

| Measure | Base | Final |
| --- | --- | --- |
| `26-bark-texture` surface | 11.67 | 4.78 |
| `28-young-bark` surface | 9.22 | 3.44 |
| `20-winter-branch-architecture` bark | 20.74 | 3.84 |

The base is run `refit-full` at `99b001ae8`. The final figures are run `bark-final2` at the head that
holds this record, drawn on the Mac's GPU. The reviewer's own winter-wood figure at the base was
15.9, from the same wood region.

| Step | 26 | 28 | 20 bark |
| --- | --- | --- | --- |
| Base, bark tint 4.5, bark close-ups in daylight | 11.67 | 9.22 | 20.74 |
| Bark tint 2.8, bark close-ups in daylight | 14.79 | 8.63 | 13.63 |
| No tint, both bark close-ups in the copy-stand light | 4.49 | 8.26 | 3.65 |
| Smooth 8-texel bark relief | 3.8 | 9.9 | 3.63 |
| Lichen patches and the young-bark view on thin wood | 4.78 | 3.44 | 3.84 |

The cause of the white wood was the tint. The bark texture's mean is 0.207, 0.192, 0.183 in linear
light; the tint made it 0.93, 0.87, 0.82, so a limb in the sun sat at the top of the range. The
winter skeleton's middle third read lightness 70 against the reference's 43, and its blue-yellow
axis read −5 against +14. Lowering the tint alone darkened the close-up away from its picture, so
the close-up needs a light that leaves the surface as its albedo, not more albedo.

The bark figure's fine crackle came from the relief map. The height field read every small crack of
the photograph as a ridge, and the lit result read as a cellular herringbone rather than the
picture's long vertical plates. A blur of 8 texels at a 1024 tile before the height field keeps the
plates and drops the cracks. The bark tile's colour is unchanged.

The young-bark picture framed a limb of 0.25 m radius, above the 4 cm radius that the young layer
covered, so the layer never showed. The view now picks the exposed limb whose radius at the framed
point is nearest the thickness it asks for, stands outside the plant, and frames one young tile.
The young layer now covers wood under an 8 cm radius, which includes the winter skeleton's twigs.

The copy-stand light was fixed to one world direction, so a view turned away from it drew almost
black. It now points along the camera's own view, as its comment said. A view at turn 0 is
unchanged, so no close-up figure moved for that reason alone.

Lichen was near-white at 0.9 amount, in 2 cm grains: a wash. It is now a sage green of 0.38, 0.45,
0.34 in linear light, in 4 cm grains on the plate crests and the upward faces, with a sharp edge.

## Look

The physical bark colour is the better look. The limbs read grey-brown with their own ridges and
lichen, where the white silhouette lost the species' character and hid the furrows. The bark
close-up shows the picture's long plates, and the young stem shows its pale lenticels. The
reference pictures agree: they show a warm grey-brown bark, not a white one.

## Decision

Take the physical bark colour and light the two bark close-ups from the camera.

Rejected: the copy-stand light while the tint stayed at 4.5, which read 24.0 and 27.5, because the
rendered albedo was 4.5 times the texture. Rejected: lowering the tint alone, which took the
close-up to 14.8 and away from its picture. Rejected: raising the albedo further, which saturates
sunlit limbs to white and leaves no room for lichen to read. Rejected: keeping the fine relief
bands, which turn a photograph's cracks into ridges over the plates.

## Consequences

- The oak's bark zone carries no tint, its young-bark radius is 8 cm, and its lichen is a sage green
  at full amount.
- `BarkLayerConfig` gains `smooth`, the texels of blur before the height field; the oak's trunk
  layer sets 8. The oak's bark relief file shrinks by 22 KB.
- The plant review's bark close-ups use the copy-stand light, and that light follows the camera. The
  limb view gains a `thin` request, the metres of radius it frames, and picks the limb by thickness.
- The oak's three Mac picture references are redrawn. The SwiftShader set is owed from CI's drawing.
