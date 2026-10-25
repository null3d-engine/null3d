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

The Khronos `AnimatedColorsCube`, `LightVisibility`, `CubeVisibility` and `AnimationPointerUVs` samples and a spot light made in code give the values in `tests/pages/lib/gltf-properties.json`, which `bun bench/three-fixtures.ts` records from three.js r186 with `@needle-tools/three-animation-pointer`. The engine's animator samples the same values at the same times within 1e-5 of them through `propertySample`. `tests/image/gltf-properties.spec.ts` compares those sampled values; the material's written state is not read.

## Decision

1. The tracks sample in TypeScript, after the job workers advanced the clips, from each sample slot's clip, time and weight in the animation table. The engine steps them once a frame, before the transform update and the frame's draw lists. A value that a track writes costs a few key lookups, and a page that animates nothing pays one check a frame.
2. A clip's length, and so its looping, comes from the core's tracks. A clip whose properties run past its own tracks, or which has no tracks at all, takes a joint at rest with one constant translation track across the clip's length. Nothing is skinned to that joint.
3. A blend mixes a property's tracks by their weights and leaves the rest of the weight to the binding's base, which the loader takes from the file's own values. A sketch's own animation writes at full weight.
4. The writer keeps each value within the range that its setter takes, and writes nothing for a value that is not a number or a target that was destroyed. A material's variants, which a primitive with vertex colors or without tangents draws with, all take the same value, because the engine's one material is the file's material.
5. `KHR_animation_pointer` moves node transforms and morph weights as the clip's joint tracks, which the core already does, and moves material and light values, and a node's visibility under `KHR_node_visibility`, as property tracks. A pointer that the engine does not read leaves its value as the file has it, with a note in development builds.
6. A base color texture's or an emissive texture's `KHR_texture_transform` offset and scale move the material's one transform, through the `uvOffset` and `uvScale` values, which take two numbers. These are the four transforms that three.js's animation-pointer plugin moves. Every map of a material shares its transform, because the core keeps one, so a clip that moves two transforms of one material plays the first and notes the other.

## Consequences

- The loader reads no glTF cameras, so a file's camera pointers are noted rather than played ([D-29](D-29-gltf-loader.md)). A camera that a sketch creates animates through `scene.animateProperty`. Playing a file's camera pointer needs cameras that the file creates, which is a feature of its own: the prefab template, `instantiate` and a way to reach a copy's camera. No Khronos animation-pointer sample animates a camera, so this milestone leaves camera pointers out of reach.
- The engine leaves out a camera's values, a texture transform's rotation, and the transforms of every texture but a base color or an emissive one. It leaves out a light's inner cone angle, `normalTexture/scale`, and the pointers of `KHR_materials_ior`, `KHR_materials_volume`'s attenuation color and distance, and `KHR_materials_iridescence`'s thickness range. It leaves out the values of extensions that it does not draw, each with a note in development builds.
- The properties page and its fixture compare the engine with three.js at the sampled times for every Khronos animation-pointer sample whose values three.js's plugin moves: AnimatedColorsCube, LightVisibility, CubeVisibility and AnimationPointerUVs. PotOfCoalsAnimationPointer stays out of the fixture: it moves only two texture rotations, which neither engine moves, so it would prove only that its clip loads.
- The demo `examples/property-animation` shows a lamp, a material and a camera animated in code.
- The fixture gives three.js a stand-in of one texel for each image, because a texture track binds to the texture, and the test reads values, not pixels.
- AnimationPointerUVs takes about 8 MB with its images, so it lives in the sample content with the other large models, and the sample content's pin moves for it. CubeVisibility takes 4 KB and stays beside the other two small Khronos samples.
