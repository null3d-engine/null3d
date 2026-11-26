# Verdict on api-3-substance-22

## The finding as given

```json
{
 "page": "api/wind",
 "anchor": "lines 24, 57, 77, 81, 272, 290, 326, 328, 338, 361",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Ten long paragraphs. Lines 57 and 372 are engine-internal allocation notes (\"a fraction that crosses one of its calls becomes an object\"). Line 361 explains the budget in terms a reader cannot use.",
 "evidence": "stats.json api/wind (17, 50, 70, 74, 265, 283, 319, 321, 331, 354 in its count).",
 "proposedEdit": "Keep \"The calls allocate nothing; keep one array for the place you push.\" Move the rest of 57 and 372 into a closed block. Rewrite 361 as a list: budget per preset, what the governor lowers, the overlay line.",
 "generatedSource": "",
 "id": "api-3-substance-22",
 "slice": "api-3",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The ten lines are right. stats.json counts body lines without the 7-line front matter, so its 17, 50, 70, 74, 265, 283, 319, 321, 331, 354 are page lines 24, 57, 77, 81, 272, 290, 326, 328, 338, 361. The page is hand-written (docs/api/wind.md), so no generated source applies.
- Line 57 and the last "Costs and limits" bullet (line 372) are allocation notes for engine maintainers. Line 57: "Until the browser has optimized the add-on's functions, a fraction that crosses one of its calls becomes an object, as in the engine's own steps." Line 372: "Each fraction that the add-on works out reaches a call in an array that the add-on made once, so a call the browser does not inline boxes none of them." These echo code comments in packages/wind/src/wind.ts:229-233 and 261-264. That part holds.
- Line 361 holds in part. The numbers (0.5, 1.2, 4.9, 6.25 ms), the quarter steps and the overlay example are usable. One sentence is not: "it is smaller than the room that each preset's frame leaves beside the plants' own budget. A frame that spends both grows by the field's share, and the governor is what holds it." This is a decision-record test rule (packages/wind/src/cadence.test.ts:4-5 and 302-312 name it) and gives a reader nothing to act on. A list is the right shape.

## Where the finding is wrong

1. The proposed kept sentence is false. "The calls allocate nothing" overstates the page. Line 57 says the calls "make no object of their own", and that `read` "takes the task's promise, which the engine makes". The page also says calls can box a fraction until the browser optimizes them. `read` returns void (wind.ts:133), but a promise is still made inside the engine.
2. The edit moves too much of line 57 into a closed block. Line 57 opens with "Call `update` once in each frame. It places the box about the camera and sends the field's values to the GPU." That is a main instruction. The main text must make sense with every block closed, so these sentences must stay out of the block.
3. The edit leaves seven of the ten long paragraphs (24, 77, 81, 272, 290, 326, 328, 338) without any proposal. The claim names ten paragraphs, but the fix covers only 57 and 361, plus the bullet at 372, which is not one of the ten.

## Corrected claim

Ten paragraphs are long (page lines 24, 57, 77, 81, 272, 290, 326, 328, 338, 361). Line 57 and the last "Costs and limits" bullet (line 372) mix a usable rule with engine-internal notes on boxed numbers. Line 361 holds usable numbers, but one sentence about "the room beside the plants' own budget" restates an internal test rule.

## Corrected edit

- Line 57: keep in the main text "Call `update` once in each frame. It places the box about the camera and sends the field's values to the GPU. The add-on's calls make no object of their own, so you may call them in every frame. If you push in every frame, keep one two-number array for the place." Move the sentences about the task's promise and the boxed fraction into a closed block, "Technical details: allocation in a frame".
- Line 372: keep "The add-on makes no object of its own in a frame, and its texture exists only while something reads it" and the `bench:allocation` command. Put the worker message, the shared-memory write and the inlining note in a closed block after the list. A block must not go inside a list item.
- Line 361: make it a list: the field's budget at each preset; the governor's quarter steps down to a quarter of the budget, with the step interval capped at 133 ms and the pressure count kept above zero; the stats overlay line, with the Medium example in a code span. Cut the "room beside the plants' own budget" sentence, or put it in a closed block.
- The other long paragraphs need their own breaks. Line 77: split the queueing rule (second ask, third ask replaces it, the dropped ask is reported once) into a short list. Line 290: split the first three vectors from the fourth `sent` vector. Line 326: split the forest demo from glTF trees and grass. Lines 24, 272, 328 and 338: break each into two paragraphs where the topic turns.
