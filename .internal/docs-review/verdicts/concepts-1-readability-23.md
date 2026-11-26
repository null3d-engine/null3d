# concepts-1-readability-23

## Finding as given

- page: concepts/architecture
- anchor: ## The passes of a frame, items 3 (line 93), 8 (line 98) and 14 (line 104)
- category: technical-details-block
- severity: medium
- claim: Item 14 is about 230 words: HDR final pass steps, the two-step split below render scale 1, and the 8-bit path with its exceptions. Items 3 and 8 are about 100 words each. The numbered list stops being scannable.
- evidence: architecture.md:93, 98, 104
- proposedEdit: Cut each item to one or two sentences and a link. Item 14: 'The final pass draws the scene color into the canvas: bloom, vignette, exposure, tone mapping, outlines, grading, sRGB and dither, and FXAA in that mode (The post-processing chain).' Put the render-scale split and the 8-bit path in a block 'Technical details: the final pass on each path' under the list. Item 3: 'Vertex shaders skin most meshes; a compute pass morphs and skins the rest once per frame', with the remaining detail in the same block.

Verdict: partly

## Evidence

- architecture.md:93 (item 3) is about 106 words without link targets, 7 sentences. architecture.md:98 (item 8) is about 104 words, 5 sentences. architecture.md:104 (item 14) is about 172 words, 12 sentences, not 230. The other 11 items are one to three sentences, so these three do break the list's rhythm. The readability problem is real.
- Most of the detail is already on the linked pages: the skinning pass at api/animation.md:422; the two-step split at concepts/post-processing.md:58-72; the 8-bit path and its effects that need a final pass at concepts/color-management.md:67. So a block is a fair home, and a plain cut to a link would also lose nothing.
- The proposed item 14 text drops the "On the HDR path" qualifier. With the block closed, the main text would say that every frame has a final pass that tone maps. On the 8-bit path the scene's shaders tone map, and with MSAA at a lowest render scale of 1 the frame has no final pass at all (architecture.md:104, color-management.md:67). The main text must keep that fact, so the proposed one-liner misleads.
- The proposed list "bloom, vignette, exposure, tone mapping, outlines, grading, sRGB and dither, and FXAA" puts FXAA last. post-processing.md:37 says the single pass smooths edges with FXAA first. Without "in that order" this is only loose, but it is better not to imply an order.
- Item 8 has no concrete proposed text.
- The item 3 one-liner is accurate: api/animation.md:422 says the skinning pass works once per frame.

## Corrected claim

Items 3 and 8 are about 105 words each, and item 14 is about 172 words (not 230). All three are much longer than the other items, so the list is hard to scan. Move their detail into one block under the list. The short item 14 must still say that the 8-bit path tone maps in the scene's shaders and can skip the final pass.

## Corrected edit

3. Skinning, on WebGPU: the vertex shaders of the shadow and scene passes skin most skinned meshes. A compute pass, the skinning pass, morphs and skins the rest once per frame ([Animation](../api/animation.md#skinned-meshes)).

8. The opaque pass draws the objects in view into the scene color and depth, then the background into the pixels that no object covers. With GPU occlusion culling, it first culls against the depth of last frame's large objects ([Culling](culling.md#gpu-occlusion-culling-on-webgpu)).

14. The final pass draws the scene color into the canvas. On the HDR path it blends in bloom, tone maps, draws the outlines, grades, encodes sRGB and dithers ([The post-processing chain](post-processing.md)). On the 8-bit path the scene's shaders tone map, and the frame can skip the final pass ([Color management](color-management.md#the-8-bit-path)).

Then, after the list (no headings inside, no nested blocks):

<details>
<summary>Technical details: skinning, occlusion culling and the final pass</summary>

- Skinning: the vertex shaders skin custom materials' meshes too. The skinning pass handles morphed meshes, which it morphs by their weights first, and meshes that a debug view or a full shader of the sketch's draws. It skins each mesh that some view draws once, into a buffer of skinned vertices that the shadow and scene passes draw. A mesh whose pose did not change keeps its vertices. The pass runs only while the scene has such meshes.
- Opaque pass: it draws 4 samples per pixel in the MSAA mode. With GPU occlusion culling on WebGPU, an occluders' pass draws the depth of the large objects that showed in the camera's last frame. A compute pass builds a depth pyramid from it and culls every object in view against it. The depth prepass and the opaque pass then draw the objects that show.
- Final pass on the HDR path: it also applies the vignette and the exposure, and smooths edges in the FXAA mode. While the render scale can drop below the whole canvas, the work splits in two. The first step draws FXAA, the tone curve and the sRGB encode at the render size. The second step scales the image up and draws the rest ([Below the whole canvas's render scale](post-processing.md#below-the-whole-canvass-render-scale)).
- Final pass on the 8-bit path: with MSAA and a lowest render scale of 1, the scene's render pass averages its samples straight into the canvas. The final pass then runs only when an effect needs it, such as color grading, sharpening, outlines or transmission. The scene's shaders apply the vignette before their tone mapping ([GPU tiers and backends](backends.md#color-and-anti-aliasing-on-each-tier)).

</details>
