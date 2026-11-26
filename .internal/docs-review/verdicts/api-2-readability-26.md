# Verdict for api-2-readability-26

## The finding as given

```json
{
 "page": "api/input",
 "anchor": "long paragraphs at lines 21, 85, 91, 110, 172",
 "category": "long-paragraph",
 "severity": "low",
 "claim": "Line 85 (108 words) explains how presses, drags and wheel scroll queue across slow frames, but most readers need only its first sentence. Line 110 mixes the calls, the batch types and the demo link.",
 "evidence": "stats.json api/input longParagraphs (stats lines 14, 78, 84, 103, 165).",
 "proposedEdit": "Keep the first sentence of 85, and put the rest in <details><summary>Technical details: drags and clicks during a slow frame</summary>. In 21, cut the sentence about the second drag. Split 110 into the calls, a list of the batches that take them, and the demo link. Put 172 (the costs) in a details block.",
 "generatedSource": "",
 "id": "api-2-readability-26",
 "slice": "api-2",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The five long paragraphs are real. The stats lines are the page lines less the 7 lines of front matter: page 21 (90 words, 6 sentences), 85 (108, 7), 91 (66, 5), 110 (85, 5), 172 (81, 5). docs/api/input.md is hand-written, so no generated source applies.
- Line 85 does explain the slow-frame queueing of presses, drags and scroll. The behavior is real: packages/engine/src/sketch/input.ts:4-6, :51, :83 and :371, and the tests at packages/engine/src/sketch/input.test.ts:208 and :291. Moving the detail into a block is right.
- "Keep the first sentence of 85" is too thin. "A frame's drag belongs to one press." does not tell the reader what they see: two quick clicks between frames reach the sketch as presses in two frames. That affects anyone who counts `wasPressed('Mouse0')`. With the block closed, the main text must still state that result.
- "In 21, cut the sentence about the second drag" would make line 21 false. Without it, line 21 says the sketch "takes every event that came since the previous frame". The code holds back a press that follows a release in the same frame, and every event after it (input.ts:371; the test at input.test.ts:213 holds back a key event too). The sentence is the exception to that claim, so it must stay in some short form.
- Line 110: the split into the calls, a list of batch types and the demo link holds. It is a readability gain with no loss.
- Line 172: putting the whole paragraph in a block leaves the "What it costs" heading with nothing under it while the block is closed. That breaks the rule that the main text must make sense with every block closed. The paragraph also holds practical guidance (with only `click` handlers, a move casts no ray), which belongs in the main text.
- Line 91 is in the anchor but the edit proposes nothing for it. At 66 words it is a fair length; leaving it is fine.

## Corrected claim

Lines 85, 110 and 172 are long and dense. Line 85's slow-frame detail can move into a block, but the main text must keep its visible result. Line 21's exception sentence is needed for accuracy and should be shortened, not cut. Line 172 needs a one-sentence summary left under its heading.

## Corrected edit

- Line 85: keep in the main text: "A frame's drag belongs to one press. When a slow frame holds two drags or two clicks, the second one and the events after it reach the sketch in the next frame." Put the rest (drag movement, wheel scroll after a release, controls that ignore the wheel during a drag) in `<details><summary>Technical details: drags and clicks during a slow frame</summary>`.
- Line 21: keep the exception, shortened: "A second press in the same frame, and the events after it, wait for the next frame, as [The pointer](#the-pointer) explains."
- Line 110: split as proposed: the `on`/`off` calls and what the engine does, then a short list of the batches that take the same calls (instance, sprite, point, line) and what `instance` names in each, then the demo link.
- Line 172: keep in the main text: "Pointer events cost nothing while no object listens. The engine casts only the rays that handlers need, so with only `click` handlers, a move casts none." Put the microsecond figure, the tree update on the first ray and the shared ray for repeated moves in `<details><summary>Technical details: the cost of each ray</summary>`.
- Line 91: no change.
