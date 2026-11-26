# api-2-substance-15

## Finding as given

- Page: api/materials
- Anchor: ## Changing a material (line 526), 'A value that takes more than one number, as ... ior and attenuationDistance do, goes through set'
- Category: wrong-claim. Severity: medium.
- Claim: To the user, ior and attenuationDistance are single numbers (Standard values table, lines 85 and 92). They go through set because the engine stores each as several internal parameters. A reader will think the table is wrong.
- Evidence: docs/api/materials.md:85, 92, 526; packages/engine/src/scene/resources.ts:3355-3389 (comment: 'a value that takes more than one parameter, as ... the index of refraction do'; ONE_VALUE_PARAMS has neither name).
- Proposed edit: 'setUniform takes the values listed below. Every other value, such as uvTransform, normalScale, clearcoatNormalScale, angleFade, ior and attenuationDistance, goes through set.' List the names from ONE_VALUE_PARAMS. Move the paragraph on how the browser boxes numbers into <details><summary>Technical details: why set can allocate</summary>.

Verdict: partly

## Evidence

- docs/api/materials.md:85 and :92 give `ior` as "1 or more" and `attenuationDistance` as "Above 0". Both are one number to the user. Line 526 says they "take more than one number". To a reader, that sentence contradicts the table. This part of the finding holds.
- packages/engine/src/scene/resources.ts:3362-3390: neither `ior` nor `attenuationDistance` is in the list of names that `setUniform` takes. `writeOneValue` (resources.ts:3431-3443) throws E1216 for any other name. So the page is right that both go through `set`. Only its reason is wrong.
- The finding's own reason is only half right:
  - `ior` writes two core parameters: the head-on reflectance computed from it, and the index itself (resources.ts:3252-3260).
  - `attenuationDistance` writes ONE core parameter. `set` converts the value first, because the core stores 0 for Infinity (resources.ts:3261-3268). So it is not "several internal parameters". It is a value that the engine converts before it stores it.
- The sentence on line 526 has a bigger gap than the finding names. These table values are one number or one color too, but `setUniform` refuses them with E1216, and the page does not say so: `bumpScale`, `displacementScale`, `displacementBias` (resources.ts:2439, 2953-2964, handled with the map transforms), `diffuseTransmissionColor`, `subsurfaceColor`, and also the pair `iridescenceThicknessRange`. A reader who follows the page's rule ("it takes a number ... or a color") will call `setUniform('bumpScale', x)` and get an error. Listing the accepted names, as the proposed edit says, fixes this too.
- This page is written by hand. No generator makes it, so the edit goes into docs/api/materials.md itself.

## Corrected claim

The page gives a rule: `setUniform` takes any value that is one number or one color, and `set` takes the rest. That rule is wrong. `ior` and `attenuationDistance` are one number each, yet `setUniform` refuses them. `ior` sets two internal values. `attenuationDistance` is converted before the engine stores it. `setUniform` also refuses `bumpScale`, `displacementScale`, `displacementBias`, `diffuseTransmissionColor` and `subsurfaceColor`, and the page does not say so. The page should list the names that `setUniform` takes, not give a rule.

## Corrected edit

Replace the rule sentences in line 526 with a list, and keep the per-frame advice in the main text:

"Change values in every frame with `setUniform(name, value)`, which allocates nothing: `material.setUniform('roughness', 0.5 + 0.1 * Math.sin(t))`. On a standard material it takes these numbers: `opacity`, `alphaCutoff`, `metalness`, `roughness`, `emissiveIntensity`, `aoMapIntensity`, `lightMapIntensity`, `specularIntensity`, `envIntensity`, `transmission`, `thickness`, `dispersion`, `diffuseTransmission`, `subsurfaceRadius`, `clearcoat`, `clearcoatRoughness`, `sheenRoughness`, `iridescence`, `iridescenceIor`, `anisotropy`, `anisotropyRotation` and, on a decal, `edgeFade`. It also takes these colors: `color`, `emissive`, `specularColor`, `attenuationColor` and `sheenColor`. Give a color in an array that you change in place. Every other value goes through `set`, and `setUniform` throws E1216 for it. A custom material's `setUniform` also changes one of its WGSL uniforms, by the name in its `struct Uniforms`."

Then put the boxing reason in a block after that text:

<details>
<summary>Technical details: why set can allocate</summary>

`set` reads each number from a field of the options object that you pass. The browser boxes such a read when it cannot keep the field's number unboxed. This happens when the object's fields hold other kinds of value too, and when one call site sees objects of more than a few shapes. `setUniform` takes the value itself, so nothing is read from an object.

</details>

The main text still makes sense with the block closed: it says to use `set` for setup and `setUniform` in every frame. Name the E1216 code with a link to ../errors/E1216.md, as the page does for E1101.
