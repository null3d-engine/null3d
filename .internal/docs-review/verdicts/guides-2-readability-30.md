# guides-2-readability-30

## Finding as given

- page: guides/testing
- anchor: line 200; line 194
- category: missing-content
- severity: low
- claim: Line 200 points to the null3d-develop skill's references/e2e-testing.md with no link, so a website reader cannot open it. Line 194 repeats step 2 of hold mode (line 69) almost word for word.
- evidence: line 200; line 194 'While the engine holds frames or replays, the sketch's `assets` calls run one at a time, in the order the sketch made them.'
- proposedEdit: Link https://github.com/null3d-engine/null3d/blob/main/skills/null3d-develop/references/e2e-testing.md (the file exists at that source path). Cut line 194 to: 'Loads that run side by side are safe in a held frame, as [Hold mode](#hold-mode) explains.'
- generatedSource: (none, hand-written page)

Verdict: partly

## Evidence

- Line 200 names "the null3d-develop agent skill's `references/e2e-testing.md`" as plain code text, with no link. No other docs page links to this file (grep of docs/ for e2e-testing finds only line 200). The file exists at skills/null3d-develop/references/e2e-testing.md. AGENTS.md "Docs and skills stay in sync" rule 8 makes it the guide to browser tests of an app, so a link is useful. A GitHub link to the skill source does not break the website contract, which only fixes the format of demo links. This half survives.
- Line 194 does repeat line 69's sentence "the sketch's `assets` calls run one at a time ... in the order the sketch made them". But it also holds two facts that line 69 does not:
  1. "or replays": the in-order loads also apply during a replay. The code confirms this. packages/engine/src/sketch/runner.ts:738 sets the flag as `holdSeconds !== undefined || replay !== undefined`, and runner.ts:1019 passes that flag to the asset loader as its in-order switch (runner.ts:380-384, 436).
  2. "A model makes its textures in the file's order."
- The proposed cut ("safe in a held frame, as Hold mode explains") drops both facts. Hold mode step 2 (line 69) does not mention replays, so the link does not cover the replay fact. The cut would lose correct detail.

## Corrected claim

Line 200 names the skill's browser-test reference with no link, so a website reader cannot open it. Line 194 repeats line 69's sentence about the order of `assets` calls, but it also says that replays load in order too and that a model makes its textures in the file's order. Line 69 says neither.

## Corrected edit

- Line 200: link the file, for example "The null3d-develop [agent skill](agents.md)'s [`references/e2e-testing.md`](https://github.com/null3d-engine/null3d/blob/main/skills/null3d-develop/references/e2e-testing.md) gives the whole setup ...".
- Line 194: shorten it, but keep the replay fact and the model fact:
  "Loads that run side by side are safe in a held frame or a replay. The engine then runs the sketch's `assets` calls one at a time ([Hold mode](#hold-mode)), and a model makes its textures in the file's order."
