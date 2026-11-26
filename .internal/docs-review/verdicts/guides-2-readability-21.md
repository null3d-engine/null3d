# guides-2-readability-21

## The finding as given

- page: guides/multiple-views
- anchor: ## Cost, lines 98-108; ## What a view leaves out, lines 110-114
- category: structure
- severity: medium
- claim: Line 102 under 'Cost' is about what a view draws (shadows, background, fog, no AO, no SSR) and line 106 is about which GPU paths draw views. A reader looking for what a view does not show finds half the answer under Cost and half under 'What a view leaves out'. Line 106 also uses a semicolon join and dense 8-bit path detail.
- evidence: line 102 'Its objects take no ambient occlusion or screen-space reflections, which shade the camera's view.'; line 106 '...draws it to the canvas; the picture looks the same as on the HDR path'.
- proposedEdit: Keep lines 100, 104 (first sentence) and 108 under Cost. Move line 102 into 'What a view leaves out' as two lists: draws (camera's shadows, background, environment light, fog, lights it sees); leaves out (AO, SSR, objects that show a pass texture). Rename that section 'What a view draws and its limits'. Put line 106 and the depth-target sentence of 104 into <details><summary>Technical details: how views draw on each GPU path</summary>.

Verdict: partly

## Evidence

- docs/guides/multiple-views.md:102 does mix one cost fact ("The shadows cost nothing more") with three sentences about what a view shows and leaves out. The "no ambient occlusion or screen-space reflections" limit sits under Cost, while the other limit (objects that show a pass texture) is at :112 under "What a view leaves out". The split the finding describes is real.
- docs/guides/multiple-views.md:106 is about GPU paths, not cost, and it has the semicolon join the finding quotes.
- No page links to #cost or #what-a-view-leaves-out (grep over docs, skills, packages/*/src and tools). Only #picking-in-a-view is linked (docs/api/cameras.md:143, docs/api/raycast.md:106), so the rename breaks no link.
- stats.json lists no long paragraphs for this page, so this is a structure finding only.

## What does not hold in the proposed edit

1. The edit says "Keep lines 100, 104 (first sentence) and 108 under Cost". But the first sentence of 104 is the depth-target sentence, and the edit also moves that sentence into the block. The sentence that stays under Cost is the second one, about render scale, which is a real cost fact.
2. Moving all of line 102 out of Cost loses its one cost fact: a view reuses the shadow maps that the camera's view made, so shadows add no cost. That clause belongs under Cost.
3. The proposed "draws" list leaves out the camera's volumetric fog and outline. Line 102 says they are added after the views draw, so they reach a view's rectangle. A reader who wants to know what a view shows needs that fact.
4. Putting all of line 106 in a closed block hides a fact that every reader needs: views work on both GPU paths (WebGPU and WebGL2) and in every thread mode. The main text must make sense with every block closed, and a WebGL2 user should not have to open a block to learn that the feature works for them. Only the detail about where culling runs and how the 8-bit path writes color belongs in the block.

## Corrected claim

Line 102 mixes what a view shows and leaves out with the cost of shadows. So the "no ambient occlusion or screen-space reflections" limit sits under Cost, apart from the pass-texture limit under "What a view leaves out". Line 106 is about GPU support, not cost, and joins two clauses with a semicolon. The move is right, but the shadow-cost clause, the render-scale sentence and the "works on both GPU paths" sentence must stay in the main text.

## Corrected edit

Under "## Cost": keep line 100. Then add "The shadows cost nothing more: a view reuses the sun's cascades and the point and spot lights' shadows that the camera's view made." Then keep the render-scale sentence of line 104, and line 108.

Rename "## What a view leaves out" to "## What a view draws and its limits". Open it with "Views draw on both GPU paths, in every thread mode." Then add two lists:

- A view draws: the shadows of the camera's view, the background, the environment's light, the material fog and the lights it sees. The camera's volumetric fog and outline are added to the whole image after the views draw, so they also reach a view's rectangle.
- A view leaves out: ambient occlusion and screen-space reflections, which shade only the camera's view, and any object whose material shows a render pass's texture (keep the reason and the workaround from line 112).

Keep line 114 (the 32-view limit) after the lists. End the section with:

<details>
<summary>Technical details: how views draw on each GPU path</summary>

A view has a depth target of the canvas's size. The engine makes it once in a frame and shares it with the other views when their turns do not overlap. The scene culling runs on the GPU on WebGPU and on the job workers on WebGL2, as it does for the camera. On the 8-bit path a view writes display color into the camera's image. The resolve pass or the final pass then draws it to the canvas. The picture looks the same as on the HDR path, with no bloom, as the 8-bit path has none.

</details>
