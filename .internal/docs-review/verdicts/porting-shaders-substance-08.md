# porting-shaders-substance-08

## Finding as given

- page: porting/threejs-postprocessing, porting/threejs-mapping, porting/threejs-unsupported
- anchor: postprocessing line 67 'null3D has no SMAA, SSAA or TAA.'
- category: contradiction
- severity: medium
- claim: The mapping says SMAA 1x smooths the moment transparency layer's edges and a still view blends jittered frames by itself. The unsupported page says the same for a still view. The post-processing page says none of these exist, so a reader porting TAARenderPass on a still product view gets three answers.
- evidence: docs/porting/threejs-mapping.md:255; docs/porting/threejs-unsupported.md:31
- proposedEdit: 'null3D has no SMAA pass, no SSAA and no TAA of a moving view. A view that holds still blends jittered frames by itself, so TAARenderPass and SSAARenderPass on a still camera need no pass ([The post-processing chain](../concepts/post-processing.md)).'

Verdict: partly

## Evidence

- docs/porting/threejs-postprocessing.md:67 says "null3D has no SMAA, SSAA or TAA." The page says nothing else about a still view.
- docs/porting/threejs-mapping.md:255 says SMAA 1x smooths the moment transparency layer's edges, and that TAARenderPass and SSAARenderPass need no pass on a still camera because a still view blends jittered frames.
- docs/porting/threejs-unsupported.md:31 lists only "TAARenderPass with a moving camera" as unsupported, because "a still view blends jittered frames".
- docs/concepts/post-processing.md:390-400 ("Still-camera accumulation") confirms the still-view blend: sub-pixel offsets, 63 frames blended into a history, then the GPU rests.
- docs/concepts/quality-presets.md:212 and packages/engine/src/gpu/webgpu/pipelines.ts:61-63 (moment SMAA edges, blend and resolve layouts) confirm SMAA 1x exists, only on the moment transparency layer.

So the contradiction is real: the post-processing page flatly denies what the other two pages and the source describe.

## What does not hold

- "Three answers" overstates it. The mapping and unsupported pages agree. Only the post-processing page disagrees, so there are two answers.
- The proposed edit drops a caveat that matters most on this page. concepts/post-processing.md:398 says views with bloom, outlines, automatic exposure, volumetric fog, particles, custom effects, custom materials, the physical sky or sharpening never blend. A reader on the post-processing porting page almost always ports some of these. The edit's "on a still camera need no pass" would then mislead them.
- "No SMAA pass" is slightly off: the engine has an SMAA 1x pass, for the moment transparency layer only. "No SMAA over the whole image" is exact.
- The link should point at the section, not the page top: ../concepts/post-processing.md#still-camera-accumulation.

## Corrected claim

The post-processing porting page says null3D has no SMAA, SSAA or TAA. The mapping and unsupported pages say a still view blends jittered frames by itself, and the mapping says SMAA 1x smooths the moment transparency layer. A reader who ports TAARenderPass on a still product view gets two answers.

## Corrected edit (row at docs/porting/threejs-postprocessing.md:67, third cell)

null3D has no SMAA over the whole image, no SSAA and no TAA of a moving view. A view that holds still blends jittered frames by itself, so TAARenderPass and SSAARenderPass on a still camera need no pass. Bloom, outlines, automatic exposure, custom effects and sharpening stop that blend ([Still-camera accumulation](../concepts/post-processing.md#still-camera-accumulation)).
