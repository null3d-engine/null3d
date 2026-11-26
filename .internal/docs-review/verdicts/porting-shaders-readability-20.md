# porting-shaders-readability-20

## Finding as given

- Page: shaders/builtins
- Anchor: ## What the inputs cost, line 106 (stats line 99)
- Category: long-paragraph. Severity: medium.
- Claim: Six sentences in 112 words cover three ideas: unused values are free, how the plugin finds the fields it reads, and what happens when a mesh lacks an input. The table they lead into comes after all three.
- Evidence: stats.json shaders/builtins longParagraphs line 99: 112 words, 6 sentences.
- Proposed edit: Lead with "A value that a material does not read costs nothing. The inputs in this table cost something, so only WGSL that reads them gets them." Then the table. After it: "A mesh that lacks an input that the material reads does not draw with it. A mesh without second texture coordinates gives its first set." Move how the plugin finds the fields (the type rule, your own tangent field) into a technical details block.

Verdict: partly

## Evidence

- docs/shaders/builtins.md:106 is one paragraph that mixes three ideas: what costs nothing, how the plugin detects a read (only on a value of the input's type, so your own structure's `tangent` or `colors` field costs nothing), and what a mesh without an input does. It then ends with a colon that leads into the table at lines 108-115. stats.json confirms 112 words and 6 sentences. The diagnosis holds.
- The plan holds: lead sentence, then the table, then what a mesh without an input does, with the detection rule in a details block. The main text still makes sense with the block closed. The detection rule is real detail for people who write WGSL, so a block is better than cutting it.
- The proposed wording of the mesh sentence is wrong. The page names three inputs that stop a mesh from drawing: vertex colors, the vertex record and the tangent. The proposed sentence says the same of every input the material reads. That is false for `uv1`: the engine falls back to the first texture coordinates (packages/engine/src/gpu/vertex-format.ts:96-105). It also makes no sense for `instance`, `object.id` and the object matrices, which are not mesh data. As written, the first new sentence contradicts the second.
- Small point: the page line 117 sentence ("The pixel's position, the camera's values and `object.position` cost nothing.") already sits after the table. The new lead sentence repeats part of it. Keep both, because the lead is general and line 117 names the free values, or join them.

## Corrected claim

The paragraph is too long and should be split as proposed. But the sentence about a mesh that lacks an input must keep the three inputs the page names.

## Corrected edit

Before the table:
"A value that a material does not read costs nothing. The inputs in this table cost something, so only WGSL that reads them gets them."

The table, then the existing line about what costs nothing, then:
"A mesh that lacks the vertex colors, the vertex record or the tangent that a material reads does not draw with that material. A mesh without second texture coordinates gives its first set in their place."

Then:

<details>
<summary>Technical details: how the plugin finds the inputs a material reads</summary>

The plugin finds which fields the WGSL reads when it builds the material. It counts a field only where the WGSL reads it from a value of the input's type, such as the `input: VertexInput` parameter. So a structure of your own may name a field `tangent` or `colors` at no cost.

</details>
