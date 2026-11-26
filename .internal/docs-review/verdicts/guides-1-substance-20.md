# guides-1-substance-20

## The finding as given

- page: guides/add-ons
- anchor: long paragraphs at lines 33, 35, 55, 59, 71, 73, 117, 153
- category: long-paragraph
- severity: medium
- claim: Long paragraphs pack rules with background. Line 33 repeats itself ('A second add-on that takes the name is refused' and 'The engine refuses a name or a code that another add-on holds') and omits the 2000-9999 range and E1225. Line 117 on shader-data counting is hard to act on.
- evidence: .internal/docs-review/stats.json guides/add-ons; packages/engine/src/scene/namespaces.ts:47, 77, 445-450.
- proposedEdit: Line 33: one list of name rules with the range 2000 to 9999 and E1225. Line 117: keep 'custom materials, effects and tone curves load in files of their own, held to the shader budget', rest in 'Technical details: how the size gate counts shader bytes'. Line 153: heap method in 'Technical details: how the allocation gate measures'.
- generatedSource: (none; hand-written page)

## Verdict: partly

## Evidence

- stats.json lists eight long paragraphs for this page. Its line numbers do not count the 7-line front matter, so stats line 26 is page line 33, and so on. The eight page lines in the finding are correct.
- Line 33 (docs/guides/add-ons.md:33) does repeat itself. "A second add-on that takes the name is refused" and "The engine refuses a name or a code that another add-on holds" say the same thing.
- Line 33 gives only the lower bound ("codes below 2000 are the engine's own"). It does not give the upper bound 9999 or name E1225. The source sets the range as 2000 to 9999 (packages/engine/src/scene/namespaces.ts:47, 77, 80) and throws E1225 for a held name (namespaces.ts:102-104, 445-447). docs/errors/E1225.md exists. The page never links to the Namespaces section of docs/api/features.md (lines 161-187), which does state the range and E1225 (features.md:178, 182). So the gap costs the reader on this page. The claim holds.
- Line 117: the main point is clear, but the second half (whole shaders, sky layers and effect pieces stay in the importing file and count as shader data) is detail for implementers. A block fits it. The link to custom-shaders.md stays in the main text. This holds.
- Line 153: the heap and source-file method is dense. Moving it into a block is right, but the main text must keep that the gate aims at zero bytes and fails only when it cannot measure the add-on's code.
- What does not hold: the finding lists lines 35, 55, 59, 71 and 73 but proposes no edit for them. Line 55 is the densest of these (thresholds of 4,096, 256 and 65,536 triangles, the job-worker planner, the switch-versus-fade rule near one and a half pixels). Lines 71 and 73 pack a list of cases into prose. The edit is incomplete for five of the eight paragraphs.

## Corrected claim

The problems on lines 33, 117 and 153 hold as stated. But the finding names eight long paragraphs and proposes fixes for only three. Lines 35, 55, 59, 71 and 73 also need a break, a list or a block.

## Corrected edit

- Line 33: a list of the name rules: lowercase letters, digits and underscores, starting with a letter; `null3d` belongs to the engine; error codes from 2000 to 9999, with the engine's codes below 2000; a held name, package or code range throws [E1225](../errors/E1225.md); a reload with the same package takes back its namespace. Drop the repeated "refused" sentence. Add a link to [Namespaces](../api/features.md#namespaces) for the full rules.
- Line 35: split after "before it draws." The second paragraph covers the message, where the version comes from and when to widen the range.
- Line 55: keep "A mesh from `geometry.fromArrays` or a generator plans its levels at its first draw when it is large enough. The levels keep the mesh's vertex and triangle order, which raycasts and `updateVertices` read." Move the triangle thresholds, the job-worker planner and the switch-or-fade rule into "<details><summary>Technical details: when a mesh plans its levels</summary>", next to the existing link to concepts/lod.md.
- Line 59: break it into two paragraphs. The first keeps the advice (do not ask for levels mesh by mesh, and why). The second covers the uses of `levels: true`, `buildLevels()` and `levels: { cards: true }`.
- Line 71: make the cases where the engine refuses planned levels a short list: joints, morph targets or `targets`; a flat mesh; a displacement map or custom `vertexOffset`; the first `updateVertices`; levels from `mesh.setLevels`. Keep the closing rule ("still pass `levels: false` ...") as its own sentence after the list.
- Line 73: keep the first three sentences (pieces come with planned levels, so the default needs no change). Put the building-kit, hand-set-level and `levels: 'pieces'` cases in a second paragraph, or in "<details><summary>Technical details: which meshes get pieces</summary>".
- Line 117: as proposed. Keep "A custom material's, effect's and tone curve's builds load on first use in files of their own, held to the larger budget for shader builds", plus the link to custom-shaders.md. Move the rest into "<details><summary>Technical details: how the size gate counts shader bytes</summary>".
- Line 153: keep "The allocation gate counts the bytes that the add-on's own code allocates in each frame, on each preset. Aim at zero, since a frame that allocates feeds the garbage collector. The gate fails only when it cannot measure the add-on's code." Move the heap and source-file method into "<details><summary>Technical details: how the allocation gate measures</summary>".
- All blocks have no headings and no nested blocks, and the main text reads fully with them closed.
