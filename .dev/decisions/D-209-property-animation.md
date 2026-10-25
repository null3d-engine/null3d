# D-209: Property animation samples on the sketch's thread

Status: decided. Date: 21 October 2026. Task: M3-G1.

Summary: `scene.animateProperty` and glTF's `KHR_animation_pointer` move a value of a light, a camera, a material or an object from keyframes. The tracks sample on the sketch's thread from the clip times and weights in the animation table, not in the core's joint-lane pose path, so a file with only property tracks takes a skeleton of one joint that moves nothing. A value at less than full weight mixes with the value that the file gave the property, as three.js's mixer mixes it, and a value stays within the range that its setter takes, because a cubic key can overshoot.

## Question

Where should a property track be sampled, and how should it follow a clip's time, speed, fades and weights?

## Rule

- The engine core holds one skeleton per model, and each clip's keys in joint lanes of four, as SIMD groups ([Animation](../implementation-notes.md)). A property is one to four numbers that live in the scene's objects, not in a pose.
- A clip at less than full weight keeps its share of the value that the property had before any clip moved it, as three.js's `PropertyMixer` does, so a fade looks the same in both engines.
- A value that a file or a sketch animates never makes a setter throw: a cubic key overshoots, and an opacity of 1.02 is a shade, not a fault.

## Data

| Measure | Behind the core pose step | On the sketch's thread |
| --- | --- | --- |
| A property track's keys | Rework `resample`, `Clip` and `Pose`, which store joints in SIMD groups | Two arrays of keys, read at the clip's time |
| How a track reaches a light's intensity | The core would need the light table's addresses, and the setters' rules | The track calls the setter that a sketch calls |
| A file that moves only a material's color | Needs a skeleton that moves nothing either way | One joint at rest |

The Khronos `AnimatedColorsCube`, `LightVisibility`, `CubeVisibility` and `AnimationPointerUVs` samples and a spot light made in code give the values in `tests/pages/lib/gltf-properties.json`, which `bun bench/three-fixtures.ts` records from three.js r186 with `@needle-tools/three-animation-pointer`. The engine's animator samples the same values at the same times within 1e-5 of them through `propertySample`. `tests/image/gltf-properties.spec.ts` compares those sampled values. `packages/engine/src/scene/scene.test.ts` also reads what the material received: a track that names one map writes that map's two matrix rows and leaves every other map's, which is the check that the shared transform failed.

## Decision

1. The tracks sample in TypeScript, after the job workers advanced the clips, from each sample slot's clip, time and weight in the animation table. The engine steps them once a frame, before the transform update and the frame's draw lists. A value that a track writes costs a few key lookups, and a page that animates nothing pays one check a frame.
2. A clip's length, and so its looping, comes from the core's tracks. A clip whose properties run past its own tracks, or which has no tracks at all, takes a joint at rest with one constant translation track across the clip's length. Nothing is skinned to that joint.
3. A blend mixes a property's tracks by their weights and leaves the rest of the weight to the binding's base, which the loader takes from the file's own values. A sketch's own animation writes at full weight.
4. The writer keeps each value within the range that its setter takes, and writes nothing for a value that is not a number or a target that was destroyed. A material's variants, which a primitive with vertex colors or without tangents draws with, all take the same value, because the engine's one material is the file's material.
5. `KHR_animation_pointer` moves node transforms and morph weights as the clip's joint tracks, which the core already does, and moves material and light values, and a node's visibility under `KHR_node_visibility`, as property tracks. A pointer that the engine does not read leaves its value as the file has it, with a note in development builds.
6. A base color texture's or an emissive texture's `KHR_texture_transform` offset and scale move that map's own transform, through the `uvOffset` and `uvScale` values, which take two numbers and name one map. These are the four transforms that three.js's animation-pointer plugin moves. Every map keeps a transform of its own, as three.js keeps one for each texture: the base color map's two matrix rows sit in the material row's values that every shader reads, and the maps of the other slots keep two rows each in the row's block of map transforms. A file's own `KHR_texture_transform` places each of its maps, so a view that its texture info gives no transform reads the coordinates that the mesh gives. A clip that moves two maps of one material plays both. A sketch's own `uvOffset` and `uvScale` still move every map of the material together, because they describe the material rather than one file texture.

## Consequences

- The loader reads no glTF cameras, so a file's camera pointers are noted rather than played ([D-29](D-29-gltf-loader.md)). A camera that a sketch creates animates through `scene.animateProperty`. Playing a file's camera pointer needs cameras that the file creates, which is a feature of its own: the prefab template, `instantiate` and a way to reach a copy's camera. No Khronos animation-pointer sample animates a camera, so this milestone leaves camera pointers out of reach.
- The engine leaves out a camera's values, an animated texture transform's rotation, and an animated transform of every texture but a base color or an emissive one. That is the set that three.js's animation-pointer plugin moves, so the two engines compare on the same values, and the sample's other channels name no value that either engine plays. A file's own transform rotation stays: the row keeps a full 2 x 3 matrix, so the parser's rotation reaches the shader. Adding an animated rotation later needs one pointer path and one number per map, with no change to the row. The engine also leaves out a light's inner cone angle, `normalTexture/scale`, and the pointers of `KHR_materials_ior`, `KHR_materials_volume`'s attenuation color and distance, and `KHR_materials_iridescence`'s thickness range. It leaves out the values of extensions that it does not draw, each with a note in development builds.
- The properties page and its fixture compare the engine with three.js at the sampled times for every Khronos animation-pointer sample whose values three.js's plugin moves: AnimatedColorsCube, LightVisibility, CubeVisibility and AnimationPointerUVs. PotOfCoalsAnimationPointer stays out of the fixture: it moves only two texture rotations, which neither engine moves, so it would prove only that its clip loads.
- The demo `examples/property-animation` shows a lamp, a material and a camera animated in code.
- The fixture gives three.js a stand-in of one texel for each image, because a texture track binds to the texture, and the test reads values, not pixels.
- AnimationPointerUVs takes about 8 MB with its images, so it lives in the sample content with the other large models, and the sample content's pin moves for it. CubeVisibility takes 4 KB and stays beside the other two small Khronos samples.

## Addendum, 2026-10-25: each map keeps its own transform

Status: decided, 2026-10-25, in M3-G1.

**Question.** The engine kept one texture transform for each material, where three.js keeps one for
each texture. A clip that moved a base color transform and an emissive transform apart played the
first. A file that placed a normal, occlusion or sheen map apart from its base color map drew every
map with the base color map's transform.

**Rule.** Each of the eight map slots keeps two matrix rows in the material row. The base color
map's rows stay in the values that every shader reads, and the other seven slots follow the light
map's transform. A map's transform goes to the row slot that holds its texture. A clear coat, a
sheen, iridescence, an anisotropy, a transmission or a thickness map shares the light or a specular
slot, and a bump or displacement map takes the normal map's slot. `uvTransform` writes all eight
slots, so it still places every map. `mapUvTransforms` gives one map a transform of its own, and the
loader fills it from each map's `KHR_texture_transform`
([D-29](D-29-gltf-loader.md#addendum-2026-10-25-each-map-keeps-its-own-transform)).

**Figures.** The row grows from eighteen `vec4f`s to thirty-two, which is 288 bytes to 512. The
material table grows with it, by 224 KiB at its 1,024 rows, on both GPU paths. On WebGL2 the
material data texture's rows grow from thirty-four texels to forty-eight, the sixteen columns of the
split-sum table included. The shader's table column moves from 18 to 32. The fragment shader reads a
map's two rows inside the branch that samples that map, and applies them there: two dot products
place the coordinate and four carry its changes across the pixel. A material pays that for each map
it samples, and nothing for a map it lacks.

**Rejected: keep one transform per material and note the second as unplayed.** It fails intent
parity with three.js and with the files. `SheenCloth` scales its sheen maps by 30 and leaves its
occlusion map at 1. `SheenChair` places its normal map apart from its base color map.

**Rejected: a second matrix array in a buffer of its own.** It needs a binding of its own, a place
in every template's layout and an upload of its own. The material row reaches both stages of both
GPU paths in one upload.
