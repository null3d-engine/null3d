# api-2-readability-14

## Finding as given

- page: api/objects
- anchor: ## Mesh calls, lines 109-123; setPose bullet line 48
- category: structure
- severity: medium
- claim: The eleven-call list mixes one-line and paragraph-long bullets: setOccluder is 129 words and setBounds about 100. Line 123 then repeats which calls rebuild the draw tables, so the reader must match two lists.
- evidence: line 121 (129 words); line 118; line 123 '`setMaterial`, `setMesh`, `setBounds`, ... rebuild the draw tables'.
- proposedEdit: Make a table: call | what it does | rebuilds draw tables | more. Put the occluder detail in <details><summary>Technical details: occluders on WebGL2 and WebGPU</summary>. In line 48, keep 'Give it the arrays that a pose lives in', and move the browser-inlining reason to a details block.

Verdict: partly

## Evidence

- docs/api/objects.md lines 111-121 hold eleven bullets. Word counts: line 121 (setOccluder) 129 words, line 118 (setBounds) 99 words, line 48 (setPose) 82 words. Bullets such as line 116 (setMorphWeight) and line 117 (setFrustumCulled) are one short sentence. The claim about mixed lengths holds.
- Line 123 is the only place that says which calls rebuild the draw tables. No bullet says so, apart from setOccluder, which says "it needs no rebuild". So it is not a repeat, but the reader must still match nine names in line 123 against eleven bullets. The cost to the reader holds.
- The code agrees with line 123: packages/engine/src/scene/scene.ts setLevelBias TSDoc says a change rebuilds the tables (around line 1815); setOccluder TSDoc says it needs no rebuild (around line 1786); setRenderOrder sends a plain command (line 1804).
- setBounds (line 118) says "which every object has". It is a call on every object, not only a mesh (scene.ts line 1523 on the base object class), so it sits in the mesh list only by its link to culling.
- The table proposal is weak. A GFM table cell holds one line of inline text. A <details> block cannot sit in a cell, and the website's collapse handling works on blocks. Cells with links and two or three sentences (setBounds, setLevelBias, setCastShadows) make an eleven-row table hard to read at phone width. The proposed edit also does not say where the occluder block goes.
- The setPose reason (line 48: "The calls above pass each number on its own. A number passed to a call that the browser does not inline becomes an object of its own.") is correct, dense implementer detail, and fits a details block. But a details block inside a bullet needs list indentation and is fragile; it is safer after the list.

## Corrected claim

The Mesh calls list mixes one-line bullets with long ones (setOccluder 129 words, setBounds 99 words), and the only note on which calls rebuild the draw tables is a separate list of nine names after the bullets, so the reader must match them. The setPose bullet (82 words) carries a browser-inlining reason that is implementer detail.

## Corrected edit

Keep the bullet list; do not make a table.
1. Split the mesh calls into two lists under one lead sentence each: "These calls rebuild the draw tables, so call them at setup or behind a loading screen:" (setMaterial/setMesh, setCastShadows/setReceiveShadows, setOutlined, setFrustumCulled, setBounds, setLevelBias, setDrawRange) and "These calls cost nothing during play:" (shaderId, setRenderOrder, setMorphWeight, setOccluder). Keep the outline-on-click sentence and the performance guide and culling links after the lists. Drop the separate list of names in line 123.
2. Cut setOccluder to: what it does on WebGL2, that WebGPU needs no mark, and the Culling link. Cut setBounds to: what it does, when to use it, the Culling link. After the lists, add one block:
   <details>
   <summary>Technical details: occluders and bounds</summary>
   (WebGL2: software occlusion culling, off in every preset; blockers from `assets optimize`; up to 4,096 triangles; meshes that blend, use an alpha mask or a custom material, or are skinned never block. WebGPU: every opaque mesh may hide what lies behind it, `setOccluder(false)` keeps one out. Bounds: center relative to the origin and before scale; a group needs a sphere where one is read, such as the hero shadow; a negative radius throws E1108 in development builds.)
   </details>
3. setPose (line 48): keep "Give it the arrays that a pose lives in, and no number crosses the call. The controls write a camera's pose this way in every frame." Put the reason (numbers passed one by one to a call the browser does not inline each become an object) in a details block after the list in that section, for example "Technical details: why setPose takes arrays".
