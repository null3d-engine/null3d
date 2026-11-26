# guides-1-substance-12

## Finding as given

- page: guides/custom-passes
- anchor: ### Drawing less often: "Pace a pass with the cadence, not with the switch." (line 306)
- category: term-before-definition
- severity: medium
- claim: 'The switch' (render.setPassEnabled) is never introduced in the main text; it appears only in Related pages. 'Its passes stay in the plan' cannot be parsed by a reader.
- evidence: docs/guides/custom-passes.md:306, 582; packages/engine/src/scene/render.ts:989, 1005.
- proposedEdit: Rewrite: "setPassEvery compiles nothing, so a sketch may change it every frame. A skipped frame shows the last image. render.setPassEnabled(pass, false) turns a pass off. Pace a pass with the cadence: turning on a pass that never drew compiles the render graph again." Move the rest into a 'Technical details: cadence and the compiled plan' block.

## Verdict: survives

## Evidence

- docs/guides/custom-passes.md:306 says "not with the switch" and "switching it on". No sentence on the page before it names `render.setPassEnabled` or says that a pass can be turned off. A grep of the page finds `setPassEnabled` only at line 582, in Related pages.
- "the plan" appears nowhere else on the page (grep for "plan" hits only geometry planes and line 306). "its passes stay in the plan" is also odd on its face: a pass's "passes". The idea is defined only in docs/concepts/render-graph.md:158 and docs/api/render.md:449, and the guide links neither from this paragraph.
- The behavior claims hold in code: packages/engine/src/scene/render.ts:984-995 (`setPassEnabled` switches a pass and keeps its last image) and :997-1011 (`setPassEvery` compiles nothing, may change once a frame). docs/api/render.md:449 states the compile rule: a never-drawn pass is out of the plan while off, so switching it on compiles the graph; once drawn, the switch compiles nothing.
- Not handled elsewhere on the page. The finding is not taste: the reader cannot tell what "the switch" is or why to avoid it.

## Corrected edit

The proposed rewrite is right in direction. Two refinements:

1. Keep the reason for each tool in the main text: the switch is for a feature that starts or stops, the cadence is for a pass that draws less often (docs/api/render.md:449 says the same). Without it, "pace with the cadence" reads as a rule with no reason, since a pass that has drawn compiles nothing when switched either.
2. Drop "again" and link the API section, so the reader can find the full rule.

Main text:

> `setPassEvery` compiles nothing, so a sketch may change the cadence as often as once a frame, for example when the quality preset or the frame budget moves. In a frame that the pass skips, a material that samples its texture shows the last image that it drew.
>
> `render.setPassEnabled(pass, false)` turns a pass off, and its texture keeps its last image. Use the switch when a feature starts or stops, and the cadence to draw less often. Switching on a pass that has never drawn compiles the render graph. [Switching and removing passes](../api/render.md#switching-and-removing-passes) gives the full rule.

Block after it:

> <details>
> <summary>Technical details: cadence, the switch and the compiled plan</summary>
>
> The engine compiles the render graph into a plan of GPU passes. A skipped frame neither culls nor clears the pass's target. A pass that has never drawn is out of the plan while it is off, so switching it on compiles the graph. Once a pass has drawn, its GPU passes stay in the plan while it is off: the switch only skips their recording and compiles nothing. [Render graph](../concepts/render-graph.md) explains the plan.
>
> </details>

No headings and no nested block inside; the main text makes sense with the block closed.
