# Verdict for api-1-substance-06

## The finding as given

- Page: api/feature-draws
- Anchor: ## Limits, third bullet (line 151)
- Category: contradiction. Severity: medium.
- Claim: The page says a large splat scene needs another hook (compute instances), not this one. The engine's own splats add-on draws with scene.addFeatureInstances from this page. It also passes sceneInputs, an option the page does not list.
- Evidence: docs/api/feature-draws.md:151; packages/splats/src/system.ts:242-257 (addFeatureInstances with sceneInputs: ['sceneDepth']).
- Proposed edit: Drop 'as a large splat scene needs'. Say 'A set whose live count a compute pass writes on the GPU, such as grass that the GPU culls, needs compute instances.' Add one line under ## The payload for sceneInputs, with a link to the materials section on the scene behind a surface.

Verdict: survives

## Evidence

- docs/api/feature-draws.md:151 says "A compact buffer of many copies that a shader expands, as a large splat scene needs, is not this hook: compute instances draw ...".
- packages/splats/src/system.ts:242-258 draws the splats with `ctx.scene.addFeatureInstances(...)`, with `alphaMode: 'blend'`, `depthWrite: false` and `sceneInputs: ['sceneDepth']`. The rows are packed on the CPU side by `draw.batch.createChunkRows()` (line 263), not expanded by a shader from a compact buffer.
- The contradiction is worse than the finding says. docs/api/feature-instances.md:11, 28, 89 and 143 say compute instances record at the opaque point only, and the adapter "places no transparent instance draw". Splats are blended. So the page sends a reader who builds a splat scene to a hook that cannot draw it.
- The page's own line 112 already names Gaussian splats as the use of the 'resolve' frame point, which is a frame that only this page's hooks take. Line 151 contradicts the page itself too.
- sceneInputs: `FeatureDrawOptions` extends `Omit<ShaderOptions, 'wgsl'>` (packages/engine/src/scene/feature-draws.ts:52-53), and `addFeatureInstances` options extend `FeatureDrawOptions` (line 91). So the option is accepted. Line 104 covers it in general ("the material's values, such as ... with the same names and meanings as materials.shader"), but it does not name it. A splat or water add-on author needs it, so naming it is worth one clause.

## Refinement of the edit

- Merge the second half of line 150 ("or whose copies the GPU chooses, needs another hook") with line 151, since both point to the same hook. Suggested text for the two bullets:
  - "A draw has one shape and one material, repeated once for each row. A scene that draws a different shape for each copy needs another hook."
  - "An opaque set whose live count a compute pass writes on the GPU, such as grass that the GPU culls, needs [compute instances](feature-instances.md). Those draw at the opaque point only, so a blended set such as splats stays with this hook."
- For sceneInputs, add it to the list on line 104 instead of a new paragraph: "... such as `color`, `alphaMode`, `blending`, `depthWrite`, `doubleSided`, `map` and `sceneInputs` ...", then one sentence: "`sceneInputs: ['sceneDepth']` lets a blended draw read the opaque scene's depth behind it ([Materials](materials.md#the-scene-behind-a-surface))."
