# concepts-2-substance-25

Finding as given:
- page: concepts/post-processing, concepts/quality-presets
- anchor: post-processing line 60 ("exactly as before the split"), 158 and 358 ("where it could be thrown away before"), 398 ("as before"); quality-presets line 287 ("which the pass ... always did")
- category: wrong-claim, severity: low
- claim: These phrases tell what changed, not what holds now.
- evidence: AGENTS.md: every file states what holds now.
- proposedEdit: "At the whole canvas's scale one pass does that work." "The scene's render pass keeps its depth for the setup and the composite." "Those views draw every frame." "the first draws at the render size and smooths edges with FXAA".

Verdict: partly

Evidence:
- All five phrases are on the pages as cited (post-processing.md lines 60, 158, 358, 398; quality-presets.md line 287).
- AGENTS.md line 156 (hard rule 41) and line 235: docs state what holds now and never keep a log of what happened. "Before the split", "before" and "always did" refer to an older engine state that the reader never saw. The claim holds for all five.
- Two of the proposed edits drop facts:
  - post-processing line 60: the edit drops "while the scale cannot drop below 1". That condition is the real rule. Line 37 says the final pass is one pass "while the render scale cannot drop below the whole canvas", and the first sentence of line 60 ties the two steps to "while the render scale can drop below 1". "At the whole canvas's scale" alone suggests the scale value at a given frame decides it, which is not what the page says.
  - quality-presets line 287: the edit drops the fact that the single pass at the whole canvas's scale also runs FXAA (post-processing line 37 confirms it). That fact tells the reader that FXAA is not new to the two-step path. Keep it in the present tense.
- The edits for lines 158, 358 and 398 are fine. Line 358 needs its own sentence; the finding gives only the line 158 wording.

Corrected edit:
- post-processing line 60: "While the render scale cannot drop below 1, one pass does that work."
- post-processing line 158: "The scene's render pass keeps its depth for the setup and the composite."
- post-processing line 358: "The scene's depth stays in memory after the scene's render pass."
- post-processing line 398: "Those views draw every frame."
- quality-presets line 287: "the first draws at the render size and smooths edges with FXAA, as the single pass at the whole canvas's scale does, and the second ..."
