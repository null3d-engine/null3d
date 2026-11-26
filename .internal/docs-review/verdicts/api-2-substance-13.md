# api-2-substance-13

## Finding as given

- page: api/quality
- anchor: ## The frame-budget governor (line 104) and ## Quality events (line 190)
- category: contradiction
- severity: medium
- claim: Line 104 says the onChange handlers run after each governor step past the render scale. Line 190 says 'after each shadow step'. The code calls them after every governed step: detail, shadows, bloom, AO, SSR, contact shadows and fog.
- evidence: packages/engine/src/sketch/runner.ts:1588-1604 (all set* calls, then this.quality.governed()); packages/engine/src/sketch/quality.ts:594-597 (comment says 'shadow settings').
- proposedEdit: Line 190: 'It also calls it after each step that the governor takes past the render scale, as The frame-budget governor lists, and after the texture memory budget drops levels or asks for them again.' Change the comment at quality.ts:595 to match.

Verdict: survives

## Evidence

- docs/api/quality.md:102-104 lists the steps past the render scale (levels of detail, shadows, bloom, AO, SSR, contact shadows, far characters' interval, fog) and says "The `quality.onChange` handlers run after each of these steps."
- docs/api/quality.md:190 says the handler runs "after each shadow step of the frame-budget governor". That is narrower than line 104, so the two sections disagree.
- packages/engine/src/quality/governor.ts:1129-1150: one counter (`stepChanges`) goes up when any of detail factor, far interval, filter, bloom halvings, AO scale, SSR scale, contact steps, animation interval or fog halvings changes.
- packages/engine/src/sketch/runner.ts:2248-2251 and 2329-2332: when that counter (or the tier counter) changes, the runner calls `applyGovernedSteps`, which ends with `this.quality.governed()` (runner.ts:1603).
- packages/engine/src/sketch/quality.ts:598-600: `governed()` marks a live change, so the handlers run at the next frame. So line 104 is right and line 190 is wrong.

## Small corrections

- The finding's list of steps leaves out the far characters' update interval (animation interval). It also bumps the counter. The proposed text ("each step past the render scale") already covers it.
- Entering or leaving the lowest quality tier also runs `applyGovernedSteps` (tier counter, runner.ts:2249), so the handlers run then too. Neither section says so; the edit can add it.
- The same narrow wording is in the code comment at runner.ts:2241-2242 ("whose change handlers hear of a shadow step") and in the doc comment of `applyGovernedSteps` (runner.ts:1584-1587). Fix them with quality.ts:595.

## Corrected edit

Line 190: "It also calls it after each step that the governor takes past the render scale, as [The frame-budget governor](#the-frame-budget-governor) lists, when the engine enters or leaves the lowest quality tier, and after the texture memory budget drops levels or asks for them again."

Code comments: quality.ts:594-597 says "Tells the change handlers of a step of the governor past the render scale, or of a change of the lowest quality tier, or of the texture memory budget's drops, at the next frame." Change runner.ts:2241-2242 to "...whose change handlers hear of a governor step." Do the same for the shadow wording in the doc comment of `applyGovernedSteps`.
