# api-1-substance-12

## Finding as given

```json
{
 "page": "api/animation",
 "anchor": "## Skinned meshes, lines 420-422",
 "category": "unclear",
 "severity": "medium",
 "claim": "Line 420 says the vertex shader skins on both paths, then reports a past comparison ('On WebGPU that was a compute pass'). Line 422 then says WebGPU has a compute skinning pass. A reader cannot tell which meshes take which path. 'skinning builds' is undefined.",
 "evidence": "docs/api/animation.md:420-422.",
 "proposedEdit": "Open with the rule: 'The vertex shader of each pass skins a skinned mesh. On WebGPU, a compute pass skins morphed meshes, and meshes that a debug view or a full shader draws, once per frame instead.' Give the measurement as a present fact with its benchmark, or put it in a details block. Define builds as the compiled variants of the material's shader that skin vertices.",
 "generatedSource": "",
 "id": "api-1-substance-12",
 "slice": "api-1",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/api/animation.md:420 holds the problem. It says the vertex shader skins on "both paths", then: "On the devices that the engine was measured on, this was as fast as skinning once per frame, or faster. On WebGPU that was a compute pass, and on WebGL2 transform feedback." The word "that" means the other approach, the one the engine compared against. A reader can take it to mean what WebGPU does now. Two paragraphs later, line 422 brings in a compute pass that does run on WebGPU. So this part of the claim holds.
- The page never defines "both paths". On this page, "path" mostly means an animation property path (line 140, the table at 142, line 484), so the ambiguity is worse than the finding says.
- Overstated: "A reader cannot tell which meshes take which path." Line 422 names the two kinds of mesh that the compute pass skins: morphed meshes, and meshes that a debug view or a full shader draws. A reader who reads on can tell. The cost is order and wording, not missing facts. The source agrees with line 422: packages/engine/src/gpu/webgpu/backend.ts:1144 says the skinning pass "morphs and skins what they [the vertex-shader skinning builds] cannot". packages/engine/src/page/switches.ts:102-109 says vertex skinning is the default on WebGPU, "as WebGL2 does".
- Overstated: "'skinning builds' is undefined." "Builds" is a term the docs use on many pages (materials.md:512 and 600, lights.md:162, scene.md:246, first-use-shaders.md:54). docs/guides/custom-shaders.md:170 explains "the builds that skin meshes" and the files they ship in. The page needs a link to that explanation, not a new definition. The proposed definition, "compiled variants of the material's shader", is also loose: the builds are shader source that the engine compiles when it first uses them.
- The proposed edit says "with its benchmark", but no benchmark script exists for skinning. The package.json has no bench script for skinning, crowds or animation. The public way to compare the two methods is the `?skinning=compute` switch (testing.md:236), which line 422 already gives. So the "benchmark" half of the edit cannot be done as written.

## Corrected claim

At line 420, "On WebGPU that was a compute pass, and on WebGL2 transform feedback" describes the approach that was measured against, not what the engine does now. Line 422 then brings in a compute pass that WebGPU does use. Also, the page uses "both paths" for WebGPU and WebGL2 without saying so, and elsewhere on the page "path" means an animation property path. Line 422 does list which meshes the compute pass skins, but only after the confusing comparison. The page uses "skinning builds" with no link to the custom-shaders page that explains them.

## Corrected edit

Start line 420 with the rule, naming both GPU APIs:

"On WebGPU and on WebGL2, the vertex shader of each pass that draws a skinned mesh skins it, and the shadow passes skin it again. The one exception is on WebGPU, where a compute pass skins some meshes once per frame (see below)."

Move the comparison out of the main text into a closed block. Keep it as a measured fact and point to the switch, not to a benchmark that does not exist:

<details>
<summary>Technical details: why the vertex shader skins</summary>

On the devices that the engine was measured on, skinning in each pass's vertex shader was as fast as skinning once per frame, or faster. Those measurements skinned once per frame with a compute pass on WebGPU and with transform feedback on WebGL2. `?skinning=compute` makes WebGPU skin every skinned mesh in its compute pass, so you can compare the two methods on your device ([Testing](../guides/testing.md#switches-for-tests)).

</details>

Link "skinning builds" to [the builds that skin meshes](../guides/custom-shaders.md) at custom-shaders.md:170. Do not add a new definition.
