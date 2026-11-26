# Finding api-2-substance-21

- page: api/objects
- anchor: ## Mesh calls, setOccluder(true) bullet (line 121)
- category: unclear
- severity: medium
- claim: The bullet says the mesh blocks the view "while software occlusion culling runs, which every preset leaves off". So by default the call does nothing, but the reader learns this only in the middle of a 160-word bullet that mixes WebGL2 and WebGPU rules.
- evidence: docs/api/objects.md:121; docs/concepts/culling.md:159
- proposedEdit: Open with the condition: "setOccluder(true) matters only on WebGL2 with softwareOcclusion: true, which every preset leaves off. On WebGPU, GPU occlusion culling picks occluders itself, and setOccluder(false) keeps a mesh out of them." Move the blocker, triangle-limit and material rules into <details><summary>Technical details: which meshes can block</summary>.

Verdict: partly

## Evidence

- docs/api/objects.md:121. The "every preset leaves off" fact is in the FIRST sentence of the bullet, not in the middle: "`setOccluder(true)` makes the mesh block the view on WebGL2: the objects wholly behind it skip the GPU while software occlusion culling runs, which every preset leaves off." The claim that the reader learns it "only in the middle" is wrong.
- The bullet is long (about 150 words, eight sentences) and does mix the WebGL2 rules with the WebGPU rule. The WebGPU sentence comes last, after the WebGL2-only detail. That part of the finding holds, but the cost is moderate: low, not medium.
- The proposed opening sentence is not quite right. "matters only on WebGL2" is false. On WebGPU, `setOccluder(true)` undoes an earlier `setOccluder(false)` or `occluder: false` (packages/engine/src/scene/scene.ts:1789-1797 sets FLAG_OCCLUDER and clears FLAG_NOT_OCCLUDER). The TSDoc at scene.ts:1776-1786 and the `occluder` option at scene.ts:234-238 say false keeps the mesh out on WebGPU.
- GPU occlusion culling on WebGPU is also off by default on phones and tablets, and on Low and Medium (packages/engine/src/quality/presets.ts:469-473, presets [false, false, true, true]). So "On WebGPU, GPU occlusion culling picks occluders itself" is true only where it runs.
- The detail the edit moves into a block (asset-tool blockers, 4,096-triangle limit, which materials never block) is already in docs/concepts/culling.md:119-155, which the bullet links, and in the generated reference row docs/api/reference/objects.md:36. A block is fine, but trimming to the link is also acceptable here, because nothing is lost.
- A <details> block inside a Markdown list item needs indentation to stay in the item. That works in GitHub Flavored Markdown, but it is fragile. A block placed after the list, or a trim, is safer.

## Corrected claim

The bullet opens with the condition (software occlusion culling on WebGL2, off in every preset), but at about 150 words it mixes WebGL2-only rules with the WebGPU rule. The WebGPU rule, which applies to most desktop users by default, comes last. Severity: low.

## Corrected edit

Rewrite the bullet as:

"`setOccluder(true)` makes the mesh block the view on WebGL2 while software occlusion culling runs, which every preset leaves off. On WebGPU, GPU occlusion culling needs no mark where it runs: every opaque mesh may hide what lies behind it. There, `setOccluder(false)` keeps a mesh out, and `setOccluder(true)` lets it back in. The `occluder` option of `createMesh` and `instantiate` sets it at the start, and a change needs no rebuild. [Culling](../concepts/culling.md#gpu-occlusion-culling-on-webgpu) explains both methods."

Then put the WebGL2 rules in a block after the list (not inside the list item):

<details>
<summary>Technical details: which meshes block on WebGL2</summary>

Mark large, solid meshes of up to 4,096 triangles, such as buildings. A model that `assets optimize` gave blockers starts with those meshes blocking, and each draws its blocker in place of its mesh. Meshes that blend, use an alpha mask or a custom material, or are skinned never block on WebGL2.

</details>

Or drop those three sentences, since docs/concepts/culling.md covers them in full.
