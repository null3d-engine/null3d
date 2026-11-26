# errors-readability-04

## Finding as given

- page: errors/E1223
- anchor: page line 13: 'defineFeature(), FeatureRegistry.add(), addFeatureDraw()...'
- category: wall-of-text
- severity: high
- claim: The cause is one sentence of 207 words that lists about 25 separate faults with commas. The fix is 150 words in 10 sentences, with its own rules for each kind. A reader cannot find their fault.
- evidence: stats.json E1223: line 6 (207 words, 1 sentence), line 10 (150 words, 10 sentences). codes.ts line 241; fixes.ts line 66.
- proposedEdit: Cause: 'A call that registers a feature, a feature draw, a full-screen effect, a sky layer or a compute pass got a description that it cannot take. The message names the field.' Cases as bullets in three groups: names; frame points and kinds; resources, lighting slots and views. Add a table Kind | Frame point | Views | Reads | Writes, with rows for full-screen effect, sky layer, compute pass and feature draw. The table joins the cause and fix rules for each kind. Move the budget and governor rules into fixCases.
- generatedSource: packages/engine/src/errors/codes.ts (E1223); packages/engine/src/errors/fixes.ts (E1223)

Verdict: partly

## Evidence

- The wall of text is real. The page's "What happened" section (page line 13) is one 207-word sentence. "How to fix it" (page line 17) is 150 words in 10 sentences. The stats file gives the same counts.
- The source is right: codes.ts, the E1223 entry (cause at about line 241), and fixes.ts line 66.
- The proposed edit cannot be done as written, for three reasons:
  1. No field is called fixCases. An error entry has only title, cause, fix, example and since (codes.ts lines 10-21). The page code in tools/lib/docs.ts (errorPage, lines 436-460) prints only those fields.
  2. The cause text is used in three places. It is the page's "What happened" text, the page's front-matter summary (docs.ts line 442), and a table cell on the errors index page (docs.ts line 466). Bullets or a table in the cause would break the summary and the index table. So the case list and the table need a new docs-only field.
  3. The fix text is not docs-only. fixes.ts says it is "the text that ends every EngineError message". engine-error.ts loads it at run time, and errors.test.ts line 59 checks that each message ends with the fix. A table or bullets there would show up in console messages. The rules for each kind should move out of the runtime fix into the new docs-only field. That also makes every E1223 message shorter.
- The proposal puts the budget and governor rules in the wrong place. The cause does not mention settings, presets, budgets, the governor or the GPU scope at all, but the fix does, and features.ts refuses all of them with E1223 (the setting checks near lines 651-723, the GPU scope near line 786, the budget near line 822). The short cause should name these faults too, not drop them.
- The facts the table needs exist in the code:
  - Feature draw: frame point 'opaque', 'transparent' or 'resolve'; main view only; the alpha mode must match the frame point (feature-draws.ts, the draw check near lines 296-330).
  - Compute pass: any frame point; main view only; reads no scene resources. A texture pass publishes exactly one output, 'black' or 'transparent'. A pass that fills buffers publishes none (render.ts lines 1282-1355).
  - Full-screen effect and sky layer: their rules are already in the fix text.
- The severity is too high. The runtime message already names the exact fault (see the page's example), so a reader arrives knowing what went wrong. The page is clearly harder to use, but it does not mislead. That is medium, not high.
- The proposed cause says "The message names the field". The messages name the value and the rule it breaks, for example "got the slot 'ao', which the feature ... provides already". Say "names the value and the rule it breaks".

## Corrected claim

The E1223 page is a wall of text: a 207-word one-sentence cause and a 150-word fix that mixes general rules with rules for each kind. The cause also leaves out the setting, budget, governor and GPU scope faults that the fix covers. Severity: medium, because the runtime message already names the fault.

## Corrected edit

- In codes.ts, shorten the E1223 cause to: "A call that registers a feature, a feature draw, a full-screen effect, a sky layer or a compute pass got a description that it cannot take. The message names the value and the rule it breaks." The front-matter summary and the index cell get the same short text.
- In fixes.ts, keep the runtime fix to the general rules as plain sentences: names of their own, a frame point and a kind that go together, an order inside its band, names from the lists, neutral defaults, one feature per lighting slot, preset values and budgets. Move the rules for each kind out of it.
- Add a docs-only field to the error entry in codes.ts, such as `details`. Make errorPage in tools/lib/docs.ts print it after "How to fix it", inside the collapsible block:
  `<details>` / `<summary>Technical details: what each kind of feature accepts</summary>` / body / `</details>`
  The body holds:
  - the fault list as bullets in four groups: names; frame points, kinds and order; resources, lighting slots, views and outputs; settings, budgets and the governor;
  - the table Kind | Frame point | Views | Reads | Writes, with one row each for feature draw, full-screen effect, sky layer and compute pass (texture output or buffers), taken from the facts above.
  The block holds no headings and no nested blocks. The page reads correctly with it closed.
