# D-198: Contact shadows on thin surfaces

Status: decided by the grass helper of M2-EX8 on 20 October 2026, with the coordinator's agreement on the same day, for the owner's review. Built: the face rule in the lit shader, the `contactShadows` material option and its row flag, Creek's grass, the `contact-faces` browser test and the `contact-shadows-opted-out` image test. Date: 2026-10-20. Task: M2-EX8.

Summary: The sun's contact shadows made Creek's swaying grass shimmer. With the camera still and the wind on, 6.4% of the grass pixels flickered per frame, against 1.3% with contact shadows off. A face that the camera sees from the side away from the sun now takes no contact shadow, and a material with `contactShadows: false` takes none at all. Creek's grass uses the option.

## Question

On 20 October 2026 the owner saw Creek's grass shimmer while the camera held still and the blades swayed: a flicker over the blades and the ground between them. A close-up of pale, back-lit blades showed dark, grainy blocks of 2 x 2 pixels that flickered. Is the engine at fault, and how does a scene keep its grass still?

## What causes it

The contact shadows' march ([D-135](D-135-contact-shadows.md)) runs at half the render size. From each texel's surface it steps toward the sun through the depth copy. A step that lies behind a surface by more than a bias and less than half the reach, 0.15 m by default, counts as blocked. One depth layer cannot tell a blade 2 cm wide from a wall. So in dense grass most blades take a contact shadow from the blades in front of them. The march samples 8 jittered points on High, at fixed places in the screen, with no smoothing between frames. As the blades sway, the steps that land on a blade change from frame to frame, and each blade's shadow switches on and off.

A blade seen against the light shows a second fault. Creek's grass lights both faces as an upper face, so the sun lights the face that the camera sees even when the sun stands behind the blade. The march starts from that face and runs through the blade itself, so it always finds the blade in its way, with the jitter's grain.

## Rule

- No shimmer on the default settings where nothing in the scene shimmers by itself.
- Keep contact shadows on the surfaces that need them: floors, ground and buildings, double-sided or not.
- No new texture or pass, and no cost that the GPU timer can see.

## Options

| Option | Verdict |
| --- | --- |
| Double-sided surfaces skip contact shadows | Rejected. Many ground planes are double-sided: the walk-and-fly demo's sand, the glTF model demo's ground, and most glTF files that Blender writes, as its backface culling is off by default. They would lose every contact shadow, with no warning. |
| Surfaces with a vertex offset skip them | Rejected. Still grass would stay dark and grainy, and a mesh that a vertex offset shapes, such as a terrain, would lose them. |
| A thinner march, or a test of each occluder's width | Rejected. One depth layer cannot tell a blade from a wall, and a near blade is wide on the screen, so it passes any width test. |
| Smoothing between frames | Rejected for now. It needs history textures and reprojection, a large change. |
| A face seen from the side away from the sun takes none | Chosen, as the default. The march from such a face runs through the surface itself, so its hits say nothing. |
| `contactShadows: false` on a material | Chosen, for thin surfaces that crowd together. Filament has a switch per object for receivers, and Unreal Engine one for casters. |

## Data

Each figure comes from frames that the engine held at sketch times 1/60 s apart, one engine start per frame, as the shadow stability check draws them, in Chrome on the Mac's GPU (WebGPU, High, 960 x 880, a pixel ratio of 1). The camera holds still and the wind runs. A pixel flickers when its luma rises and then falls, or falls and then rises, by more than 3 of 255 over three frames. The figure is the share of pixels of the grass that flicker per frame.

| Creek, the owner's view, Afternoon | Flicker | Grass luma |
| --- | --- | --- |
| Everything on | 6.4% | 26.0 |
| Wind off | 0.06% | 24.4 |
| Ambient occlusion off | 6.2% | 29.0 |
| Contact shadows off | 1.3% | 44.6 |
| The sun casts no shadows | 1.2% | 47.0 |
| The grass casts no shadows | 6.4% | 26.3 |
| The grass receives no shadows | 1.5% | 44.9 |
| Shadow filter 3 instead of 5 | 6.4% | 26.0 |
| Ambient occlusion, contact shadows and the sun's shadows off | 1.2% | 49.4 |
| 4 steps | 5.7% | 32.4 |
| 16 steps | 6.4% | 20.5 |
| Reach 0.15 m | 5.9% | 27.4 |
| Reach 0.08 m | 5.5% | 28.4 |

The contact shadows make four fifths of the flicker, and they darken the grass by about 40%. No step count or reach removes it. The 1.2% that is left with every shadow off is the blades' own sway across the pixels.

The measurements of the rules themselves, the back-lit close-up at Midday and Golden, the leaves and the petals follow.
