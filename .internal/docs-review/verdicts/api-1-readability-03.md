# Verdict on api-1-readability-03

## The finding as given

```json
{
 "page": "api/animation",
 "anchor": "whole page; ## Skinned meshes (line 416) to ## Morph targets (line 453); ## Property animation (line 124)",
 "category": "split-page",
 "severity": "medium",
 "claim": "At 6,712 words with 24 long paragraphs, this is the longest page in the slice. It mixes four topics: playing clips, animating properties, GPU skinning and morph targets. A newcomer who wants to play a clip scrolls past GPU memory limits and three.js comparisons.",
 "evidence": "stats.json gives 6,712 words and 24 long paragraphs. animation.md:416-467 is about drawing, not the animator API.",
 "proposedEdit": "Keep the animator on api/animation: models, play, weights, inertial transitions, 1D blends, layers, additive clips, joint overrides, events and errors. Move 'Skinned meshes', 'Crowds', 'Limits of skinning' and 'Morph targets' to a new page api/skinning ('Skinned meshes and morph targets'), linked from 'Models from glTF files'. Move 'Property animation' and 'Files with KHR_animation_pointer' under one H2 at the end, or to api/property-animation. Put 'Clips', 'Blending' and 'Speed compared with three.js' (lines 389-478) under one H2 'How the animator works' near the end.",
 "generatedSource": "",
 "id": "api-1-readability-03",
 "slice": "api-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The counts hold: stats.json gives 6,712 words and 24 long paragraphs.
- "Longest page in the slice" is wrong. The api-1 slice also has api/debug, at 6,807 words (stats.json).
- "A newcomer who wants to play a clip scrolls past GPU memory limits and three.js comparisons" is wrong. "Playing clips" is at line 66, the third H2. "Limits of skinning" is at line 444 and "Speed compared with three.js" at line 469. A reader meets play, crossFade and stop before any of them.
- The real cost to a reader is in a different place. "Property animation" and "Files with KHR_animation_pointer" (lines 124-184) sit between "Playing clips" and "Clip weights". They break the run of animator calls: play, then weights, inertial transitions, blends and layers. This part of the finding holds.
- "416-467 is about drawing, not the animator API" is only partly true. "Crowds" (line 426) documents `animator.setUpdateInterval` and `animator.updateInterval`. Those are methods of the animator class (packages/engine/src/scene/animation.ts:816, in the api/animation category). "Morph targets" (line 453) also covers clips that animate weights, and layers and joint masks on weights. Moving these to api/skinning would split the animator's own API across two pages.
- A new page costs a lot for this gain. 16 links in 10 other pages point at this page's sections: #skinned-meshes (geometry, architecture, backends, testing), #morph-targets (assets, geometry, objects, backends, cookbook), #crowds (quality-presets, performance), #limits-of-skinning (performance, and this page's E1501 row). A new page also needs an entry in PAGES in tools/lib/docs.ts. The tree review (findings/tree-structure.md, item 14) keeps api/animation as one page. For a page this size, the split is a matter of taste. api/materials (13,672) and api/scene (8,672) are much longer.
- Most of the weight in the skinning and clip sections is dense, correct detail for implementers. Examples: the skinning pass on WebGPU (around line 420), the cost of a character that stands still (line 435), the byte counts in Limits of skinning, the key storage bullets in Clips, the interpolation error in Blending, and the load timings in Load cost. That detail fits the new collapsible block. Cutting or moving it does not.

## Corrected claim

At 6,712 words with 24 long paragraphs, api/animation is long, and one section is out of place. "Property animation" (lines 124-184) sits between "Playing clips" and "Clip weights", so it breaks the run of animator calls. The later sections on skinning, crowds, limits, clip storage and blending hold dense detail for implementers in the main text. The order itself is sound: playing clips comes third, before any GPU or three.js material. "Crowds" and "Morph targets" document animator and morph-weight calls, so they are more than drawing.

## Corrected edit

Keep one page and keep every heading and its anchor.

1. Move "Property animation" and its H3 "Files with KHR_animation_pointer" to after "Events" (line 376), before "Clips".
2. Put the dense implementer detail into `<details>` blocks with a `Technical details: ...` summary. No headings go inside a block. The main text must make sense with every block closed:
   - Load cost: the KayKit Knight timings and size figures.
   - Clips: the key-rate, byte and constant-track bullets, and the cubic spline paragraph.
   - Blending: the eight-slot replacement rule and the interpolation accuracy.
   - Skinned meshes: the WebGPU skinning-pass paragraph and the culling-sphere paragraph. Keep in the main text the sentence that every material skins, and the `await scene.warmUp()` advice.
   - Crowds: the paragraph on what an idle character at interval 1 still costs.
   - Limits of skinning: the per-vertex and per-joint byte arithmetic. Keep in the main text the bullet that a scene past the limit draws nothing and gives E1501.
   - Morph targets: the WebGL2 and WebGPU loading paragraph.
3. Optionally, put "Clips", "Blending" and "Speed compared with three.js" under one H2, "How the animator works", as H3s. No other page links to #clips or #blending, but the #speed-compared-with-threejs anchor would change. Check for links to it first.

Do not create api/skinning or api/property-animation.
