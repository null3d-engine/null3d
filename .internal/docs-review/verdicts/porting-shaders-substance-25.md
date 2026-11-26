# porting-shaders-substance-25

## Finding as given

- page: shaders/builtins
- anchor: ## What the inputs cost, stats line 99 (112 words, 6 sentences)
- category: long-paragraph
- severity: low
- claim: The rule is 'costly inputs reach only WGSL that reads them'. The plugin's field matching and mesh fallbacks are detail.
- evidence: stats.json longParagraphs for shaders/builtins
- proposedEdit: Keep the first two sentences and the table. Move 'It counts a field only where the WGSL reads it...' through '...gives its first set in their place' into <details><summary>Technical details: how the plugin finds the inputs a material reads</summary>.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- stats.json gives one long paragraph for shaders/builtins: line 99, 112 words, 6 sentences. In the page file it is line 106 (the front matter shifts the count).
- docs/shaders/builtins.md:106 holds three ideas: (a) the rule, sentences 1-2; (b) how the plugin finds the fields the WGSL reads (by the input's type, so your own structure can name a field `tangent` or `colors` for free), sentences 3-5; (c) what happens on a mesh that lacks an input: no draw for vertex colors, vertex record or tangent, and the first texture coordinates in place of the second set, sentences 6-7.
- Part (b) is implementer detail. The main text reads fine without it. Moving it into a block is right.
- Part (c) is not cost detail. It is a pitfall: the mesh silently draws nothing. Hiding it in a collapsed block called "how the plugin finds the inputs" puts a cause of a missing mesh where readers will not look.
- Part (c) is only partly said elsewhere. docs/shaders/surface-functions.md:512-513 gives the second-texture fallback and the no-draw rule for vertex colors, and :557 says a mesh must carry its vertex record. The no-draw rule for a mesh without a tangent appears only on this page, at line 106.
- The paragraph ends in a colon that leads into the table. Moving the last five sentences out leaves sentence 2 to lead the table, so it needs a short lead-in.

## Corrected claim

The plugin's field matching (sentences 3-5) is detail and fits a collapsible block. The mesh rules (sentences 6-7) are reader-facing behavior: a mesh that lacks vertex colors, a vertex record or a tangent that the material reads does not draw. They must stay in the main text. For the tangent, this page is the only place that says so.

## Corrected edit

Keep sentences 1-2 and end them with a lead-in to the table, for example: "The values above that a material does not read cost it nothing. A few inputs cost something, so only WGSL that reads them gets them:". Keep the table as it is. After the table, keep the existing line about the free inputs and add a short paragraph that stays outside any block: "A mesh that lacks the vertex colors, the vertex record or the tangent that a material reads does not draw with that material. A mesh without second texture coordinates gives its first set in their place." Then add:

<details>
<summary>Technical details: how the plugin finds the inputs a material reads</summary>

The plugin finds which fields the WGSL reads when it builds the material. It counts a field only where the WGSL reads it from a value of the input's type, such as the `input: VertexInput` parameter. So a structure of your own may name a field `tangent` or `colors` at no cost.

</details>
