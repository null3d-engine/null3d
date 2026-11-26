# Finding api-3-readability-27

```json
{
 "page": "api/sketch,api/scene",
 "anchor": "sketch '## When changes show' (line 179); scene '## When changes take effect' (line 569)",
 "category": "duplication",
 "severity": "low",
 "claim": "Both sections explain that onUpdate sees last frame's world positions, onLateUpdate sees this frame's, its setters show in the same frame, and structural changes wait. The reader reads it twice, and the two copies can drift.",
 "evidence": "sketch line 183 'In onLateUpdate, world positions already hold the frame's changes'; scene line 573 'In onLateUpdate they already hold the frame's changes'.",
 "proposedEdit": "Keep the timing rules on api/sketch. On api/scene keep the list of structural calls (line 571) and the skipped-change rule (line 575), and link to sketch.md#when-changes-show.",
 "generatedSource": "",
 "id": "api-3-readability-27",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The overlap on `onLateUpdate` is real. sketch.md line 183 says world positions hold the frame's changes, setters show in the same frame, and structural changes take effect in the next frame. scene.md line 573 repeats all three, and already links back to sketch.md#when-changes-show. Both pages are hand-written, so no generated source is involved.
- The claim that "both sections" say `onUpdate` sees last frame's positions is wrong for sketch. The sketch section (lines 179-185) does not say it. Sketch says it only in the text after the example (line 216), and only for `getWorldPosition`.
- scene.md line 573 is the only place that states the general rule: every value the engine computes (not only `getWorldPosition`) comes from the last transform update, so in `onUpdate` it is the previous frame's value. The getters live on the Scene page, so the rule belongs there.
- So the proposed edit, which drops all of line 573, would remove that rule from the docs.

## Corrected claim

The two sections repeat the `onLateUpdate` rules: world positions are current, setters show in the same frame, and structural changes wait a frame. Only the Scene page states the `onUpdate` rule for computed values as a general rule.

## Corrected edit

On api/scene, keep the first two sentences of line 573: "Values that the engine computes, such as the result of `getWorldPosition`, come from the engine's last transform update. In `onUpdate` they come from the previous frame." Replace the rest of the paragraph with one sentence: "`onLateUpdate` sees this frame's values; [Sketch API](sketch.md#when-changes-show) gives its timing rules." Keep lines 571 and 575 as they are. Leave api/sketch unchanged.
