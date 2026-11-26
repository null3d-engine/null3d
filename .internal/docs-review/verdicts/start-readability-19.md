# start-readability-19

## Finding as given

- page: cookbook/index
- anchor: Mermaid diagram (lines 13 to 17) and line 19
- category: technical-details-block
- severity: medium
- claim: The page opens with a diagram of the type check and hold mode, and a 5-sentence paragraph on the engine's tests. A reader wants to know how to use a recipe first.
- evidence: stats.json line 12 (file 19): 'Each recipe is a complete sketch ... The engine's tests run every recipe on this page.'
- proposedEdit: Delete the diagram. Open with 'Each recipe is a complete sketch for one common task. Copy it into your project's sketch.ts and change it from there.' then the files note. Move the test sentences into <summary>Technical details: how the recipes are tested</summary>.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/cookbook/index.md:13-17 is a Mermaid diagram with two boxes: the type check and hold mode on every GPU tier. Line 19 says the same thing in words. The diagram adds nothing that line 19 does not say, and it comes before the page tells the reader what a recipe is or how to use one. This part of the finding holds.
- Deleting the diagram breaks no rule. AGENTS.md "Writing docs" asks for an opening Mermaid diagram only on a concept page. The cookbook is not a concept page, and no docs check requires a diagram (no Mermaid check in tools/ or packages/*/src).
- stats.json flags line 19 for 5 sentences at 60 words. It is not long by word count.
- The claims about the tests are true. tests/lib/skill-sketches.ts:1-3 and :81 collect every complete sketch in docs/cookbook, type check them and draw them in hold mode. tests/image/skill-sketches.spec.ts:1-4 and :48-53 run each one on every tier in TIERS.
- The block part of the edit is wrong. "So each call that a recipe shows exists and runs in this version" is not dense implementer detail. It is the page's main promise to the reader: the code works as shown. The front matter summary (line 6, "each is also a tested example") already advertises it. Hiding it in a closed block removes the reason to trust the recipes. Three short sentences are too little to need a block.
- Line 21 also says "The tests serve the KayKit Knight ...". If all test text moves into a closed block, that sentence talks about "the tests" with no earlier mention in the open text.

## Corrected claim

The diagram only repeats line 19 and sits before the usage instructions, so it should go. The test sentences hold the page's promise that every recipe runs. They should stay in the main text, shortened to one sentence, not move into a closed block.

## Corrected edit

Delete lines 13 to 17. Replace line 19 with:

> Each recipe is a complete sketch for one common task. Copy it into your project's `sketch.ts` and change it from there.
>
> The engine's tests type check every recipe and draw it in [hold mode](../guides/testing.md) on every GPU tier. So each call that a recipe shows exists and runs in this version.

Keep line 21 (the files note) as it is. Add no details block.
