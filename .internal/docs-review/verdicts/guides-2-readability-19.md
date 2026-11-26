# Verdict on guides-2-readability-19

## The finding as given

- Page: guides/lens-kit, guides/loading-screens, guides/multiple-views, guides/performance, guides/phones, guides/physics, guides/screens, guides/start-time, guides/testing, guides/ui-overlays, guides/video-textures
- Anchor: line 11 '> Roadmap step 0.x, first released in null3D 0.1.0.'
- Category: internal-note. Severity: medium.
- Claim: 'Roadmap step' is a plan term, which the rules keep out of docs/. On lens-kit, multiple-views, screens and video-textures it reads 'Roadmap step 0.3, first released in null3D 0.1.0', which a user reads as a contradiction.
- Evidence: lens-kit.md line 11; the sentence comes from shipsSentence in tools/lib/steps.ts, and the docs check requires it (tools/lib/docs.test.ts line 137).
- Proposed edit: Change shipsSentence to give only the release, e.g. 'First released in null3D 0.1.0. The API is experimental, so it can still change between versions.' Update the docs check and every page's banner to match. Site-wide; only this slice's pages are listed.
- Generated source: tools/lib/steps.ts

## Verdict: partly

## Evidence

- The banners are as the finding says. Line 11 of all 11 pages starts "Roadmap step 0.x, first released in null3D 0.1.0." Step 0.3: lens-kit, multiple-views, screens, video-textures. Step 0.2: ui-overlays. Step 0.1: the other six. 103 docs pages carry the same sentence.
- The source is right. `releaseOf` and `shipsSentence` in tools/lib/steps.ts build the sentence. `frontMatterProblems` in tools/lib/docs.ts (around line 651) refuses a written page whose note does not start with it. tools/lib/docs.test.ts (around line 137) checks the same thing.
- The reader cost is real. No public roadmap exists for the step number to point to. The decision on the first release says the README carries no roadmap from 0.1.0 on, and the release script refuses one. The step labels match internal milestones M1 to M3. So a reader who lands on a page sees "0.3" beside "0.1.0" with no key. The banner does not link to an explanation. All three steps ship in 0.1.0, so the number tells a user of any release nothing.
- One part of the claim is wrong. The rules do not name "roadmap step" as a banned term. The writing rule in AGENTS.md bans milestones, checkpoints, task IDs, proposals and internal plans. The docs explain the term on purpose: docs/index.md line 34 and the note in docs/pages.md line 11 (from STEPS_NOTE) both say steps 0.1, 0.2 and 0.3 all ship in null3D 0.1.0. The docs check even blocks "null3D 0.2" and "null3D 0.3" as fake release names (STEP_AS_RELEASE in docs.ts). So the wording is a deliberate stopgap, not a slip. The decision on the first release left the final rule for `since` values open until after 0.1.0. The choice was to remap the labels or to say they are roadmap numbers. The current text takes the second path. The proposed edit takes the first path, which that decision allows.
- The edit is incomplete. If the banner drops the step, the "Step" column in pages.md, the "Since" column note (docs.ts around line 411), STEPS_NOTE and the hand-written line 34 in docs/index.md still use the term. A reader then sees "roadmap step" only in the lists, with no banner to explain it. The edit should treat all of these together.

## Corrected claim

The "Roadmap step 0.x" banner gives a reader a number with no public meaning. No public roadmap exists, and every step ships in 0.1.0. The banner can look like it contradicts the release beside it, and it does not link to the explanation on the docs home. The rules do not ban the term outright: the docs explain it on purpose as an interim wording until the `since` rule is settled. The fix is a choice between two options that the first-release decision allows.

## Corrected edit

In tools/lib/steps.ts, make `shipsSentence` return only the release for the step values: "First released in null3D 0.1.0." Keep "Ships in null3D X." for other values. Update the expected note in the docs check (tools/lib/docs.ts `frontMatterProblems`) and in tools/lib/docs.test.ts, and the banner of all 103 written pages. In the same change, drop or rename the "Step" column in pages.md and the "Since" column note in docs.ts. Rewrite or remove STEPS_NOTE and the step sentences in docs/index.md (lines 34 and 49), so no page names a roadmap step. Keep the STEP_AS_RELEASE check, because it still stops a page from calling "0.2" or "0.3" a release. The owner should confirm this choice, because the first-release decision left the `since` rule to them.
