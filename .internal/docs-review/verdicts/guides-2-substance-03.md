# guides-2-substance-03

Finding as given:

- page: guides/performance
- anchor: ### Quality presets, line 93: 'On WebGL2 it sets the depth prepass, occlusion culling and the most morph targets per object.'
- category: contradiction
- severity: medium
- claim: The presets do not vary the prepass or occlusion culling on WebGL2. Every WebGL2 preset draws the prepass and every preset leaves software occlusion off. The same page says so at lines 288 and 298.
- evidence: packages/engine/src/quality/presets.ts:362-366 (softwareOcclusion presets [false,false,false,false]); presets.ts:457-461 (depthPrepass webgl2 [true,true,true,true]); performance.md:288 'every preset leaves it off'; :298 'On WebGL2, every preset draws the prepass'.
- proposedEdit: 'On WebGL2 it sets the most morph targets per object. WebGL2 draws the depth prepass on every preset, and no preset turns on occlusion culling there.'

Verdict: survives

Evidence:

- presets.ts:362-366: `softwareOcclusion.presets` is `[false, false, false, false]`. No preset turns WebGL2 occlusion culling on.
- presets.ts:457-461: `depthPrepass.webgl2` is `[true, true, true, true]`. Every WebGL2 preset draws the prepass.
- presets.ts:487-491: `morphTargets.presets` is `[8, 16, 32, 64]`. Only this one of the three settings changes between presets.
- performance.md:288 and :298 state the fixed values, so line 93 reads against the page's own later text. A reader who reads "the preset sets X" next to settings that do change (pixel ratio, shadows, bloom) will expect the prepass and occlusion culling to change between presets too.
- The one thing that turns the WebGL2 prepass off is the lowest quality tier (concepts/quality-presets.md:220, :321). That tier is below the four presets and is not a preset, so it does not save the line.
- Pedantic defence that fails: the preset object does carry a value for both settings, so "sets" is true in a narrow sense. But the value is the same on every preset, so the sentence gives the reader no useful fact and implies a wrong one.

Optional refinement to the edit: line 93 says nothing about WebGPU's GPU occlusion culling, which does change between presets (presets.ts gpuOcclusion `[false, false, true, true]`). The edit can name it, so the reader learns which occlusion setting the preset does vary:

'On WebGL2 it sets the most morph targets per object. WebGL2 draws the depth prepass on every preset, and no preset turns on its occlusion culling. On WebGPU, High and Ultra turn on GPU occlusion culling for desktops.'
