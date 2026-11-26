# Verdict for api-1-substance-11

## Finding as given

- id: api-1-substance-11 (slice api-1, role substance)
- page: api/animation
- anchor: "## Playing clips line 101; ### Order and cost lines 358-374"
- category: technical-details-block
- severity: medium
- claim: The rule a user needs is short: freeze repeated options. The text on inlining, 12-byte number objects and a Float64Array helper is correct tuning detail that interrupts the page.
- evidence: docs/api/animation.md:101, 358-374.
- proposedEdit: Keep 'Keep the options of the plays that a game repeats in frozen constants, so a clip switch allocates nothing' and the example. Move the rest of line 101 and lines 358-374 into <details><summary>Technical details: why a fraction can allocate, and how to stop it</summary> ... </details> at the end of ### Order and cost.
- generatedSource: (none; the page is hand-written)

Verdict: partly

## Evidence

- The detail is correct. packages/engine/src/scene/animation.ts:284 reads a frozen options object once (`Object.isFrozen`), and the comments at animation.ts:425, 518 and 1159 describe the same boxing of fractions in calls the browser does not inline. So the finding is right that this is accurate tuning detail.
- The claim treats two rules as one. Line 101 is about frozen options for `play` and `playBlend`. Lines 358-374 are about a different case: a weight that changes every frame on `lookAt` and the other joint calls. Freezing does not help there. The fix is to call them from a small function that takes only objects and whole numbers. So "the rule a user needs is short: freeze repeated options" is wrong for lines 358-374. A crowd author needs that second rule in the main text.
- The proposed placement is wrong. Line 101 is under "## Playing clips". The end of "### Order and cost" is about 270 lines further down. A block there leaves the `play` rule's explanation far from the rule. Also, line 346 ("A frozen options object is read once, as with play") points back to line 101. So the "read once" sentence must stay in the main text at line 101.
- Line 101 is 66 words and 5 sentences. Its last sentence, "The same holds for the points of `playBlend`", is a rule, not detail, and the example below it uses `playBlend`. Only two sentences are mechanism ("From an object that is not frozen..." and "The browser then makes a new 12-byte number..."). A block for two sentences gives the reader very little.
- "### Order and cost" is the page's cost section, so lines 358-374 are on topic there. It is fair to move the mechanism (inlining, 12-byte number objects, arrays that never box) and the code example into a block. But the main text must keep the rule and its scope (line 374: every engine call that takes a fraction, such as `setPosition` or `setLayerWeight`).

## Corrected claim

Lines 358-374 hold a second, separate rule: in a crowd, a fractional weight that changes every frame on the joint calls can allocate, and a small helper function that reads the fractions from an array stops this. Its mechanism (inlining, 12-byte number objects) and the helper example can go into a block at the end of "### Order and cost". Line 101 is already short, and its rule sentences must stay where they are. Severity is low (polish), not medium.

## Corrected edit

1. Line 101: keep it in the main text, but cut the two mechanism sentences: "Keep the options of the plays that a game repeats in frozen constants. The animator reads a frozen options object once and keeps what it read, so a clip switch allocates nothing. The same holds for the points of `playBlend`." If the mechanism is kept, put it in its own short block right after the code example under "## Playing clips", not at the end of "### Order and cost".
2. Lines 358-374: in the main text keep "The calls allocate nothing, but in a crowd, a weight that is a fraction and changes in each frame can make garbage for the collector. To stop this, call the joint calls from a small function of its own that takes only objects and whole numbers. The default weight, 1, never allocates. The same holds for every engine call that takes a fraction, such as `setPosition` or `setLayerWeight`." Then add `<details><summary>Technical details: why a fraction can allocate, and how to stop it</summary>` with the inlining and 12-byte number explanation, the note that the rotation and target cross in arrays, and the Float64Array example, then `</details>`.
