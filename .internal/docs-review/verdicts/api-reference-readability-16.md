# api-reference-readability-16

## Finding as given

- page: api/reference/geometry
- anchor: 69 H2 exports; long paragraphs lines 141, 229, 369, 388, 457, 498, 524; `buildLevels` cell line 492
- category: split-page
- severity: medium
- claim: The page mixes three topics letter by letter: engine shape options, @null3d/geometry curves and shapes, and levels of detail. It also has 7 long paragraphs and a 462-word cell.
- evidence: stats.json geometry: 7 long paragraphs, 69 headings. BoxOptions, ArcCurve, BuildLevelsOptions, levelAt, Shape interleave. buildLevels 462 words, setLevels 204, updateVertices 190.
- proposedEdit: Group the index into 'Shapes', 'Curves and paths (@null3d/geometry)' and 'Levels of detail'; if the site shows long pages poorly, move the levels-of-detail exports to their own reference page. buildLevels: keep the first 2 sentences and the automatic-levels paragraph; move part sharing, pieces and frame spreading into @details. MeshArrays (line 457): one list item per array.
- generatedSource: packages/engine/src/scene/resources.ts

Verdict: partly

## Evidence

What holds:
- The page is long (9,538 words, 69 H2 exports) and sorts shape options, @null3d/geometry curves and levels-of-detail exports together by name (ArcCurve, BoxOptions, BuildLevelsOptions, ... levelAt, LevelBounds ... Shape).
- stats.json lists 7 long paragraphs (file lines 141 Curve, 229 GeneratedArrays, 369 levelDistances, 388 LevelsOption, 457 MeshArrays, 498 MeshLevel, 524 MorphTargets).
- The buildLevels member cell (line 492) is about 470 words; setLevels (491) about 215, updateVertices (489) about 208.

What does not hold:
1. "Group the index" has no target. The page has no index. The generator sorts every export of every reference page by name (tools/lib/api-docs.ts:471) and prints them flat (renderReference, api-docs.ts:505). Grouping is a generator change for all 38 reference pages in tools/lib/api-docs.ts, not an edit in resources.ts. The mix is by design: each reference page mirrors one written page (AGENTS.md "Writing docs" rule 5), and the written page docs/api/geometry.md already groups the topics (Generators, Extra shapes, Levels of detail, ...).
2. A separate LOD reference page needs a new written api/ page: the generator writes a reference page only beside an existing written page (tools/lib/docs.ts:575-576). concepts/lod is a concepts page, not an api page.
3. A details block cannot go in the buildLevels cell. Member docs render as one table cell (api-docs.ts:498), and every summary is flattened to one line (api-docs.ts:74 `flat`, :120-123). The block format needs blank lines and a Markdown body, so it breaks the table.
4. "MeshArrays: one list item per array" misreads the paragraph and cannot render. The paragraph at line 457 is about value types (floats or glTF quantized integers, GPU type, integer scale, buffer sharing), not about each array. Each array already has its own table row with its accepted types. The summary is also flattened to one line, so a list cannot survive.
5. The source list is incomplete: the exports come from packages/engine/src/scene/resources.ts, packages/engine/src/scene/level-rule.ts (levelAt, levelDistances, LevelView, ...) and packages/geometry/src/*.ts.
6. The edit names only two of the seven long paragraphs.

The detail the finding wants to fold (part sharing, pieces, frame spreading) is already on the written page, docs/api/geometry.md lines 226-260 ("Levels of detail"), with the automatic-levels rule and the `levels` option table.

## Corrected claim

The reference page is long and its name order mixes shape options, @null3d/geometry curves and levels-of-detail exports. Seven summaries are long, and the buildLevels, setLevels and updateVertices member cells repeat at length what the written Geometry page already explains. The name order and the one-page layout come from the generator and the one-reference-page-per-written-page rule, not from this page's comments.

## Corrected edit

In packages/engine/src/scene/resources.ts, cut the buildLevels TSDoc to its contract: what it plans, when the promise resolves or rejects (E1221, E1406), E1101, and a pointer to the Geometry page's "Levels of detail" section. Drop the part sharing, pieces and frame spreading sentences from the comment, because docs/api/geometry.md already holds them. If that section needs more depth, put a details block there, in the written page, not in a table cell. Trim setLevels and updateVertices the same way.

For the long summaries (Curve and GeneratedArrays in packages/geometry/src; levelDistances in packages/engine/src/scene/level-rule.ts; LevelsOption, MeshArrays, MeshLevel, MorphTargets in resources.ts), keep one or two sentences each and drop facts that the written page or the member rows hold. For MeshArrays, keep "Each array holds its values for vertex 0, then vertex 1, and so on; the engine copies them" and point to "Integer attributes" for types and scale.

Grouping exports under topic subheadings is optional and low priority. It would be a cross-page generator feature in tools/lib/api-docs.ts.
