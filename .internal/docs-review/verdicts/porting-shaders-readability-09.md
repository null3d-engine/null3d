# porting-shaders-readability-09

## Finding as given

- page: porting/threejs-overview
- anchor: ## The workflow (line 101)
- category: scan-order
- severity: medium
- claim: This is the entry page of the porting area, but the numbered workflow comes only after What gets faster, What changes in the code, What needs rewriting by hand and What stays the same. A newcomer who wants to start reads three tables first.
- evidence: stats.json headings for porting/threejs-overview.
- proposedEdit: Move "The workflow" (with "A large app in two steps") right after the intro under the diagram, then "A small example", then the reference sections. At least add one line under the diagram that links to #the-workflow.

Verdict: partly

## Evidence

- The heading order is as stated: What gets faster (line 26), What changes in the code (46), What needs rewriting by hand (66), What stays the same (85), The workflow (101), A large app in two steps (117), A small example (126). Three tables come before the numbered steps (lines 32, 48, 70).
- The page does not hide the workflow, though. The first thing on the page is a diagram of the six workflow steps (lines 13-20), each with a one-line meaning. A newcomer sees the order of work before any table.
- Line 24 already says "This page gives the workflow and the main differences", but it has no link to the steps. Line 42 says "the fifth step of the workflow", also with no link. So the cheap fix is real and costs nothing.
- The full move has a cost. Step 1 (line 103) says "Settle the hand rewrites and the unsupported features with the app's owner before you write code". Those are defined in "What needs rewriting by hand" (lines 66-83), which itself says "Plan time for them before you start". The reference sections are partly input to step 1, so the current order is a defensible "know this, then do this" order, not a mistake.
- Because the diagram already gives the steps at the top, the reader is not blocked or misled. Medium overstates it; low (polish) fits.

## Corrected claim

The numbered steps come after three tables, but the page opens with a diagram of the same six steps, and line 24 promises "the workflow" without linking to it. A reader who wants the detailed steps must scroll past the reference sections to find them. Severity: low.

## Corrected edit

Keep the section order. In line 24, link the words "the workflow" to #the-workflow, for example: "This page gives [the workflow](#the-workflow) and the main differences." Optionally also link "the fifth step of the workflow" in line 42 to #the-workflow. Moving the workflow above the reference sections is optional; if it moves, step 1 must link down to #what-needs-rewriting-by-hand, because it relies on that list.
