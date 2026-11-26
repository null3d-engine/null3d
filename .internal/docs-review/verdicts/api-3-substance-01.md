# api-3-substance-01

## Finding as given

- Pages: api/raycast, api/render, api/scene, api/sketch, api/sound, api/splats, api/sprites, api/tasks, api/terrain, api/textures, api/three-compat, api/time, api/ui, api/vertex-draws, api/water, api/wind
- Anchor: line 11: "> Roadmap step 0.2, first released in null3D 0.1.0."
- Category: internal-note. Severity: high.
- Claim: Every page opens with "Roadmap step N", the maintainers' build plan. The writing rules forbid internal plans in docs, and a user cannot act on it. It appears on 103 pages.
- Evidence given: tools/lib/steps.ts:16-30; tools/lib/docs.ts:652; tools/lib/docs.test.ts:90,135-142.
- Proposed edit: Make shipsSentence write only the release, such as "First released in null3D 0.1.0." Keep `since` in the front matter. Update tools/lib/docs.test.ts and tools/lib/steps.test.ts.
- Generated source: tools/lib/steps.ts

Verdict: partly

## Evidence

- The reviewed copy shows the sentence. generated/docs/api/raycast.md:11 reads "Roadmap step 0.2, first released in null3D 0.1.0." The phrase occurs 107 times in 106 files under generated/docs. generated/tools/lib/steps.ts:16-30 writes it, as the finding says.
- The claim about the rule holds. AGENTS.md "Writing docs" forbids the maintainers' internal plans in docs. No public page explains the roadmap. On main, docs/index.md:34 and :49 only name "the roadmap step", and the pages list carries a Step column. A reader cannot act on a step number.
- The fix is already made on the current branch (docs/no-status-labels). The generated copy matches main. Commits 10aa9fb37 and 300ae91dd remove the whole note sentence, the `status` and `since` front matter, the Step column in the pages list, and tools/lib/steps.ts with its test (`git diff --stat main HEAD -- tools/lib` shows steps.ts -30, steps.test.ts -15). In the working tree, docs/api/raycast.md has no release sentence and no `since`, and `grep -rn "oadmap step" docs` finds 0 matches.
- The proposed edit conflicts with the branch's decision. .dev/decisions/D-397-docs-without-labels.md:45 rejects keeping `since` with release numbers, because every page ships in the first release and the label would say the same thing on every page. :36 says only the owner adds `status` or `since`. "Keep `since` in the front matter" and "edit tools/lib/steps.ts" undo that work. Also, "First released in null3D 0.1.0." on every page gives the reader nothing useful either.

## Corrected claim

On main, which the reviewed copy matches, 103 written pages open with "Roadmap step N, first released in null3D 0.1.0." That is a term from the maintainers' plan, and the rules forbid it. The current branch already removes the sentence, the `since` labels and the generator for the sentence (tools/lib/steps.ts). No further edit is needed beyond landing that branch.

## Corrected edit

None on this branch. Land docs/no-status-labels, which removes the sentence, the front matter labels, the Step column and tools/lib/steps.ts. Do not bring back a "First released in" sentence or the `since` field.
