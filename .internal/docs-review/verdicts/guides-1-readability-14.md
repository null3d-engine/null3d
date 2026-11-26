# guides-1-readability-14

## The finding as given

- Page: guides/add-ons
- Anchor: lines 33, 35, 55, 59, 71, 73, 117, 153
- Category: long-paragraph. Severity: medium.
- Claim: Eight long paragraphs; four in a row in '## Give every mesh levels of detail'. The author's rule (use fromArrays or a generator, leave levels out, pass levels: false with a comment only for the table's cases) is buried under thresholds, refusal cases and pieces rules.
- Evidence: stats.json lines 26 (74 words, 5 sentences), 28 (69, 5), 48 (102, 5), 52 (93, 7), 64 (102, 6), 66 (131, 8), 110 (98, 7), 146 (106, 6).
- Proposed edit: Line 33: list the naming rules. Line 35: split, end with the 'widen the range' action. Lines 55-59: open with the rule from line 57; move thresholds, the 1.5-pixel fade and vertex order into <details><summary>Technical details: when a mesh plans its levels</summary>. Line 71: list the automatic refusals. Line 73: move pieces rules into a details block, keep one sentence on levels: 'pieces'. Line 117: keep 'custom shaders load on first use and take the shader budget'; move the shader-data accounting into details. Line 153: keep 'counts the add-on's own bytes per frame, aim at zero'; move heap and file matching into details.

Verdict: partly

## Evidence

- The eight long paragraphs are facts (stats.json; its line numbers are 7 lower than the page's, because of the front matter). They are real and the finding is right to group them.
- "Four in a row" is loose. Lines 55 and 59 sit beside the short rule paragraph at line 57; the table (lines 63-69) separates them from lines 71 and 73. Not four in a row.
- "The rule is buried under thresholds, refusal cases and pieces rules" is wrong in part. Only line 55 (thresholds, fade, vertex order) comes before the rule at line 57. The refusal cases (71) and the pieces rules (73) come after the rule and after the table. They do not bury the rule.
- Line 35 already ends with "Widen the range only after the add-on works with the wider interface." The "end with the widen action" part of the edit asks for what is there.
- Line 33 says the same thing twice: "A second add-on that takes the name is refused" and "The engine refuses a name or a code that another add-on holds." A list should merge them.
- Most of the detail the edit moves into details blocks is already on the pages the add-ons page links to. A details block would make a third copy:
  - Thresholds (4,096 / 256 / 65,536), the job-worker plan and the shared planner: docs/concepts/lod.md:29, which line 55 links.
  - The fade past about one and a half pixels: docs/concepts/lod.md:166 and :178.
  - Vertex and triangle order for raycasts and updateVertices: docs/concepts/lod.md:37 and :129.
  - The pieces rules (pieces with planned levels, smaller meshes many copies draw, hand-set levels, levels: false gets none, levels: 'pieces' for merged far cells): docs/concepts/lod.md:129, which line 73 links.
  - Allocation gate heaps, source-file naming, node_modules copy, page figure, when it fails: docs/cli/null3d.md:442, linked from Related pages.
  - Shader data versus code budget: docs/cli/null3d.md:427 (sizes gate) and docs/guides/custom-shaders.md:166, which line 117 links.
- The edit would drop points a reader must keep in the main text:
  - Line 59: the leaf-card exception, `levels: { cards: true }`, is an action for an add-on author. It must stay in the main text.
  - Line 73: "A mesh with `levels: false` gets none" is a cost of opting out. It must stay beside the opt-out advice.
  - Line 153: "The gate fails only when it cannot measure the add-on's code" tells the reader when the check exits with 1. The edit keeps only "counts own bytes, aim at zero".

## Corrected claim

Eight paragraphs on the page are long (fact). In the levels section, only the paragraph at line 55 comes before the author's rule at line 57. The refusal and pieces paragraphs (71, 73) come after the rule and the table, so they make the section long but do not bury the rule. Most of the dense detail in lines 55, 73, 117 and 153 repeats text on linked pages (concepts/lod, cli/null3d, guides/custom-shaders).

## Corrected edit

- Line 33: a short list of the naming rules (form of the name, stable package value, `null3d` and codes below 2000 reserved). Keep one sentence on refusal, not two.
- Line 35: split after "before it draws." Keep the widen sentence last, as it is now.
- Lines 55-59: open the section with the rule from line 57. Cut line 55 to one sentence: a mesh from fromArrays or a generator plans its levels at its first draw when it is large or many copies draw it, with the link to Levels of detail. Cut the thresholds, the fade and the vertex order; concepts/lod.md:29, :166 and :37 hold them. Use a details block only if a fact is missing from that page. In line 59, keep the leaf-card exception and the `buildLevels()` uses in the main text.
- Line 71: list the automatic refusals (joints, morph targets or a vertex record, flat mesh, displacement map or vertexOffset, first updateVertices, setLevels). Keep the last sentence on passing `levels: false` anyway.
- Line 73: cut to three sentences: a mesh that takes the default gets pieces with no change; a mesh with `levels: false` gets none; a large mesh with no levels that spans the view, such as a merged far cell, asks for `levels: 'pieces'`. Link to concepts/lod.md#pieces-of-a-large-level for the rest. No details block, since that page holds the rules.
- Line 117: keep the first two sentences and the link. Put the shader-data accounting (whole shader, sky layer, effect pieces counted as shader data in the importing file) in a details block, "Technical details: how the check counts compiled WGSL", or cut it to a link to the sizes gate in cli/null3d.md.
- Line 153: keep "counts the bytes the add-on's own code allocates per frame on each preset", "aim at zero" and "fails only when it cannot measure the add-on's code". Cut the heap and source-file matching and link to cli/null3d.md#check-addon, which states them at line 442.
