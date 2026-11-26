# concepts-2-substance-02

## Finding as given

- page: concepts/post-processing, guides/custom-passes, guides/lens-kit
- anchor: "## Below the whole canvas's render scale", line 70; "## Custom effects and tone curves", line 217
- category: wrong-claim, severity: high
- claim: The page says that while the render scale can drop, custom effects do not join and each draws its own pass at every scale. The renderer joins effects at every scale. Only the fold of the last effect into the final pass stops. Low, Medium and High all let the scale drop, so most readers are told their effects never join. Line 60 also says the default presets allow the drop, but Ultra keeps minRenderScale at 1.
- evidence: crates/null3d-render/src/frame_graph.rs:2692-2698; crates/null3d-render/src/effects.rs:511-534; docs/concepts/quality-preset-tables.md:47. Same claim in docs/guides/custom-passes.md:216 and docs/guides/lens-kit.md:109.
- proposedEdit: Line 70: "While the scale can drop, the last custom effect does not fold into the final pass: it draws a full-screen pass of its own. Effects still join each other." Line 217: "The engine joins an effect that reads only its own pixel into the pass of the effect before it, at every render scale. While the scale cannot drop below the whole canvas, with bloom and FXAA off, the last pass also folds into the final pass." Line 60: "which Low, Medium and High allow". Same fix in custom-passes.md:216 and lens-kit.md:109.

Verdict: survives

## Evidence

- docs/concepts/post-processing.md:70 says "While the scale can drop, custom effects do not join into fewer passes ... Each runs in a full-screen pass of its own, at every scale." Line 217 says joins happen only "while the render scale cannot drop below the whole canvas". docs/guides/custom-passes.md:216 and docs/guides/lens-kit.md:109 say the same.
- crates/null3d-render/src/frame_graph.rs:2690-2711 (plan_effects): the only scale-dependent step is `fold.filter(|_| !self.two_step_declared)`. The joins (`self.effect_joins`) go to `effects::plan_units` unchanged. The comment at 2692-2697 says "The sketch's joins run at every render scale ... a sketch whose scale can drop does not fold".
- crates/null3d-render/src/effects.rs:511-534 (plan_units): groups depend only on the joins, on the built pipelines and on the fold place. There is no scale test.
- crates/null3d-render/src/frame_graph.rs:5316-5339 (request_effect_joins): the groups' "built" test has no scale test. Only the fold is gated, by may_fold (2719-2726), which needs `!self.two_step_declared` and the full canvas size.
- packages/engine/src/scene/effects.ts:465-495 (sendJoins): groups are sent whenever `this.join` is true (the default; only ?join=off turns it off). There is no render-scale test.
- packages/engine/src/quality/presets.ts:78-82: minRenderScale presets are [0.5, 0.6, 0.75, 1]. Ultra keeps 1, so "the default presets allow" the drop (post-processing.md:60) is true only for Low, Medium and High.
- So the pages tell users of three of the four presets that their effects never join. That is wrong and leads to wrong cost estimates, and may lead a reader to join effects by hand. The custom-passes text at line 218 (nothing folds while the scale can drop, also at scale 1) is correct and stays.

## Corrected edit (small refinements to the proposal)

- post-processing.md:70: "While the scale can drop, the last custom effect does not fold into the final pass, even in frames at scale 1, so it draws a full-screen pass of its own. Effects still join each other at every scale."
- post-processing.md:217: "The engine joins an effect that reads only its own pixel into the pass of the effect before it, at every render scale. While the scale cannot drop below the whole canvas, with bloom and FXAA off, the last of these passes also folds into the final pass ([below the whole canvas's render scale](#below-the-whole-canvass-render-scale))."
- post-processing.md:60: "... while the render scale can drop below 1, which Low, Medium and High allow."
- custom-passes.md:216: "The engine joins effects to save passes, at every render scale. An effect that reads only its own pixel joins the pass of the effect before it ... So you need not join such effects into one function yourself." Delete the sentence "While the scale can drop, the engine runs each effect in a pass of its own ...". Line 218 already covers the fold.
- lens-kit.md:109: "Below the whole canvas's render scale, the last effect does not fold into the final pass, so it draws a pass of its own."
