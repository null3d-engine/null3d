# Verdict for api-2-substance-27

## Finding as given

- page: api/input
- anchor: ## The pointer, file line 85 (108 words); line 21 'every thread mode'
- category: long-paragraph
- severity: low
- claim: Line 85, on how a slow frame holds the next press and the wheel scroll, is correct but dense, and most readers need only the advice to use dragDx. Line 21 says 'every thread mode' with no link to where thread modes are explained.
- evidence: stats.json api/input; docs/api/input.md:21, 85; docs/concepts/architecture.md#where-the-sketch-runs.
- proposedEdit: Keep the advice at line 83 in the main text. Move line 85 into `<details><summary>Technical details: drags and scroll in a slow frame</summary>`. Link 'every thread mode' to ../concepts/architecture.md#where-the-sketch-runs.

Verdict: survives

## Evidence

- stats.json lists the paragraph at body line 78 (file line 85) at 108 words and 7 sentences. It is the longest paragraph on the page.
- docs/api/input.md:85 describes the frame-splitting rule. The code agrees: packages/engine/src/sketch/input.ts:371-375 stops the drain at a primary press or a wheel event that follows a release, and its comment says two quick clicks count as two presses. So the paragraph is correct, and the finding does not call it wrong.
- docs/api/input.md:83 already gives the practical advice (use dragDx and dragDy for drags). With line 85 closed, the section still reads in full.
- docs/api/input.md:21 says "input works the same in every thread mode". The page has no link to the architecture page (grep for "architecture" in input.md finds nothing).
- docs/concepts/architecture.md:128 "## Where the sketch runs" holds the table of modes. The anchor #where-the-sketch-runs is right.
- The proposed block follows the block rules: no heading inside, not nested, the summary starts with "Technical details:".

## Notes on the edit

- Line 21 says the second drag and the wheel scroll wait "as [The pointer](#the-pointer) explains". With the block closed, that link lands on a section whose explanation is hidden. This still works, because the block summary names the topic. An optional tweak: keep the one sentence "Two quick clicks between two frames count as two presses, one in each of the next two frames." in the main text, because it changes what wasPressed reports and line 63 covers only keys.
