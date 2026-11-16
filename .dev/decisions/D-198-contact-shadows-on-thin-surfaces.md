# D-198: Contact shadows on thin surfaces

Status: decided by the grass helper of M2-EX8 with the coordinator's agreement, for the owner's review. Built: the face rule in the lit shader, the `contactShadows` material option and its row flag, Creek's grass, the `contact-faces` browser test and the `contact-shadows-opted-out` image test. Task: M2-EX8.

Summary: A face that the camera sees from the side away from the sun takes no contact shadow, and a material with `contactShadows: false` takes none at all. Otherwise the sun's contact shadows make 6.4% of Creek's swaying grass pixels flicker per frame, against 1.3% with them off. Creek's grass uses the option, which brings its flicker to 1.6%.

## Question

With contact shadows on every face, Creek's grass shimmers while the camera holds still and the blades sway: a flicker over the blades and the ground between them. A close-up of pale, back-lit blades shows dark, grainy blocks of 2 x 2 pixels that flicker. Is the engine at fault, and how does a scene keep its grass still?

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

The same views with and without the rules, against the same build of the core: the shader set without the rules, then the one with them. The frames are 1920 x 1760, as the page draws at a pixel ratio of 2. "Face rule alone" gives the grass contact shadows again, so the face rule works by itself.

| View | Without the rules | With both rules | Contact shadows off | Face rule alone |
| --- | --- | --- | --- | --- |
| The owner's view, the grass | 6.2% | 1.6% | 1.3% | 2.2% |
| The owner's view, the tree leaves | 0.12% | 0.08% | 0.08% | 0.09% |
| The owner's view, the middle, grass and a plant | 8.6% | 2.2% | 2.0% | 3.0% |
| Back-lit close-up at Midday, blades within 30 cm | 1.34% | 0.68% | 0.64% | 0.91% |
| Back-lit close-up at Golden | 1.14% | 0.89% | 0.88% | 0.98% |

In the owner's view the grass's luma is 41.7 with the rules and 25.6 without, against 43.2 with contact shadows off. The leaves barely flicker either way: D-135's rule for masked surfaces keeps contact shadows off them. A close-up crop of the back-lit blades shows the dark grain without the rules and none with them.

The contact faces sketch stands three green cards, lit from behind, on a gray ground, and gives them grass's upward normal. Without the face rule, contact shadows change 99.96% of the cards' pixels on WebGPU, 99.77% in compatibility mode and 99.96% on WebGL2. With it, they change 0.12%, 0.10% and 0.12%, which is the output's dither. About 2,900 pixels of the ground in front of the cards keep their contact shadows either way.

How the data was produced: a probe page, outside the repository, wrapped the Creek sketch, held its camera, and set each configuration. It started the engine once per frame in hold mode, and measured the frames in the page. Runs went through the Mac's job queue, at loads of 40 to 120.

## Decision

Both chosen rules are built. The face rule is the engine's default, and it costs a derivative pair, a cross product and two dot products per lit pixel. `contactShadows: false` is a bit of the material's row flags, which the lit shader tests with no new build. The Creek's grass sets it. With both, the owner's view flickers 1.6% per frame against 1.3% with contact shadows off, and the back-lit close-up is within 0.04 points of contact shadows off.

## Consequences

- The lit shader reads the contact shadows only on a face that the camera sees from the sun's side, and only for a material without the flag.
- The core gives the flag `NO_CONTACT_SHADOWS` (bit 20 of the row flags) for the material feature of the same name. `contactShadows` sits with the standard options, so custom materials take it too.
- docs/concepts/shadows.md gives both rules and a section on grass and other thin surfaces. docs/api/materials.md lists the option with the options fixed at creation. The develop skill's quick reference and shader notes say when to set it.
- Tests: the `contact-faces` spec draws the cards with contact shadows on and off on every GPU path. It leaves out the pixels at the cards' edges, which blend a card with the ground behind it, whose contact shadows change. The `contact-shadows-opted-out` image test draws the contact shadow scene with every material opted out, against the reference of `contact-shadows-off`.
- The rules move no reference but the Creek demo's. The `contact*`, `alpha-mask*`, `shadows-contact*` and `row-values*` image tests, the forest and contact shadow demos and `contact-shadows-opted-out` passed with them: 48 runs on the Mac's GPU and 48 on SwiftShader. The face rule leaves those scenes' pictures within their tolerances, as their surfaces that face away from the sun take little of its light anyway. The Creek demo's Mac reference changes with its brighter grass, and is redrawn with the Creek's other changes. Its SwiftShader run draws Low, which has no contact shadows.
