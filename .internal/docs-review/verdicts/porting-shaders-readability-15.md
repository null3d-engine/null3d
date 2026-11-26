# porting-shaders-readability-15

## Finding as given

- Page: shaders/surface-functions
- Anchor: ## Cut-out shapes (line 559), lines 574-586; ## Shadows (line 534)
- Category: structure. Severity: medium.
- Claim: After the cut-out example, three paragraphs describe the passes that run the function, then three bullets repeat the same points. Lines 578 and 580 (inputs in each pass, no depth copy) are implementer detail. Shadows comes first but depends on alpha masking, which Cut-out shapes introduces.
- Evidence: surface-functions.md lines 534-586.
- Proposed edit: Put "Cut-out shapes" before "Shadows". Under the example keep the alphaToCoverage and hash sentences, then one list: the shadow keeps the mask's holes; a vertex offset adds a motion build with the same holes; a hashed mask casts a hashed shadow. Move lines 576-580 and line 586 into a technical details block, "Technical details: the passes that run a masked surface".

Verdict: partly

## Evidence

Read docs/shaders/surface-functions.md lines 492-590 in the generated copy.

What holds:
- Order. "Shadows" (534) opens with "A masked custom material cuts its shadow..." and its bullet at 553 names "a surface alpha" as one way to get a caster build. Masking and surface alpha are first explained in "Cut-out shapes" (559, 561, 574). Line 576 links forward to `#shadows` for `fn coverage`. So "Shadows" leans on ideas that come after it. Moving "Cut-out shapes" up, directly after "Vertex offsets", reads better and does not break anything: "Cut-out shapes" also talks about the vertex offset's motion build, so it still follows "Vertex offsets".
- Repetition. Line 576 says the surface function runs in the caster and, with a vertex offset, in a motion build. Bullets 582 and 583 say the same two facts again, as results (holes in the shadow, holes in the motion pass). That is real overlap.
- Lines 578 and 580 are conditional detail (which camera's inputs each pass sees; no depth copy in the caster and motion passes). A reader whose alpha does not read `viewDirection`, `fragCoord`, `sceneDepth` or `sceneDistance` does not need them. A collapsible block suits them.

What does not hold:
- "Three paragraphs ... then three bullets repeat the same points" is too broad. Only line 576 overlaps the bullets. Lines 578 and 580 hold facts that the bullets do not state.
- Line 580 is a user pitfall, not only implementer detail: a surface whose alpha reads the scene depth casts a different shape than it draws. It can go in the block, but the main text should keep a one-line warning that points to it.
- The last sentence of line 576 sets precedence: a material that declares `fn coverage` casts that function's shape, not the surface alpha. A user needs this in the main text, so it must not move into the block. After the reorder it fits as a closing sentence of the cut-out text, or as the opening of "Shadows".
- Line 586 (levels of detail fade; a hashed mask switches levels at once) is not about the passes that run the surface. Putting it in a block titled "the passes that run a masked surface" misfiles it. It is two short sentences with a link; keep it as its own paragraph in the main text.
- The proposal keeps "the alphaToCoverage and hash sentences" from line 574 but does not say what happens to the rest of that paragraph. "Only WGSL that sets or reads the surface's alpha has these builds" and the E1217 / production fallback sentences are user-facing rules and must stay in the main text.

## Corrected claim

"Shadows" comes before "Cut-out shapes" but depends on the masking and surface alpha that "Cut-out shapes" introduces. In "Cut-out shapes", line 576 and bullets 582-583 state the same facts twice. Lines 578 and 580 are conditional detail on which inputs each pass sees.

## Corrected edit

1. Move "## Cut-out shapes" so it sits directly after "## Vertex offsets" and before "## Shadows". Change the `#shadows` link in it to a plain back-or-forward reference as fits.
2. Keep line 574 whole (alphaToCoverage, hash, which WGSL gets these builds, E1217 and the production fallback).
3. Replace line 576 and bullets 582-584 with one list: the shadow keeps the mask's holes and moves with the vertex offset; a vertex offset adds a motion build that cuts the same holes (without one, the motion pass cuts none); a hashed mask casts a hashed shadow and its motion keeps the pattern. Then keep the sentence: a material that declares `fn coverage` casts that function's shape instead, in the light's view (link to "Shadows").
4. Add one main-text sentence: "An alpha that reads the view or the scene's depth can cut a different shape in the shadow and motion passes." Then move lines 578 and 580 into a block:

<details>
<summary>Technical details: the inputs a masked surface sees in each pass</summary>

(lines 578 and 580, unchanged)

</details>

5. Keep line 586 (levels of detail) in the main text as its own paragraph after the block.
