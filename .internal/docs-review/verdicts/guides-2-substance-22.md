# guides-2-substance-22

## Finding as given

- page: guides/loading-screens
- anchor: "## Show progress on the page, line 69"
- category: term-before-definition
- severity: medium
- claim: "Across the whole start the figure can fall: a counted phase that ends returns the card to the engine's stage, and a later file starts a new measure under the same label." The "card" is never defined, and the sentence does not say what the viewer sees. The paragraph mixes the rule with an edge case.
- evidence: loading-screens.md:69; the code at lines 77-89 resets the bar when the label changes.
- proposedEdit: "Show each phase's own share, with its name beside it. Within a phase the bar never falls. When a new phase starts, the bar starts again from 0, as show does below." Delete the "card" sentence.

Verdict: survives

## Evidence

- "card" occurs only once in docs/guides/loading-screens.md (line 69). The page calls the UI "the loading screen", "the label" and "the bar". Nothing defines a card.
- "returns the card to the engine's stage" does not match the example. The page code (lines 93-97) calls show only for the core-download stage. No other engine stage is shown, so there is no "engine's stage" to return to.
- "a later file starts a new measure under the same label" also conflicts with the code. The show helper (lines 80-89) resets its kept maximum only when the label text changes. Under the same label, Math.max keeps the bar from falling. A new measure starts only when the label changes.
- So the sentence is not only undefined jargon: it describes behaviour that the example does not have. That misleads a reader who copies the example.
- The rule the code really applies: each phase has its own measure; within a phase the bar never falls; a change of label starts a new measure.

## Corrected edit (refines the proposed one)

Keep the sentence that explains why a share can fall inside a phase, because it is the reason for Math.max. Replace the last two sentences of the paragraph with:

"Within a phase the bar never falls, even when a scene's total grows as it starts more files. When the label changes, a new measure starts from 0, as `show` does below."

Note: "the bar starts again from 0" is slightly loose. The helper resets its measure on a label change, but the bar keeps its old width until the new phase sends its first value. "A new measure starts from 0" is exact.
