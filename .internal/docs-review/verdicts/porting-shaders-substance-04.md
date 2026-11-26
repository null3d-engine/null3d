# porting-shaders-substance-04

## Finding as given

- page: porting/verification
- anchor: ## Tolerances, lines 106-112
- category: wrong-claim
- severity: high
- claim: The table gives 'Under 0.5% of pixels' for directional shadows and 'Review the diff image' for other content. bunx @null3d/cli test has one fixed tolerance (0.1% of pixels past 10% of the range) and no setting to change it, so a shadowed view at 0.3% fails and the reader cannot accept it.
- evidence: packages/cli/src/compare.js:23 TOLERANCE = { threshold: 0.1, maxDiffRatio: 0.001 }; docs/cli/null3d.md:290-298 (test settings have no tolerance); docs/cli/null3d.md:310
- proposedEdit: Add after the table: 'bunx @null3d/cli test fails every image past 0.1% of pixels. For a view with a looser tolerance, capture it with bunx @null3d/cli shot, read the diff by eye, and write the result in the report. Keep only the views that pass at 0.1% in null3d.json.' Or add a per-test tolerance setting to the CLI and document it here.

Verdict: partly

## Evidence

- The code part holds. packages/cli/src/compare.js:23 fixes the tolerance at 0.1 / 0.001. packages/cli/src/test.js:172-178 uses that constant for every image. No other file in packages/cli/src reads a tolerance. docs/cli/null3d.md:290-298 lists no tolerance setting for a test.
- The page gap holds. docs/porting/verification.md:109 says "Under 0.5% of pixels" for shadows, and lines 110-111 say "Review the diff image". The page never says that `test` still fails such a view, or how to accept it. A reader can expect a setting that does not exist.
- But the page is not silent on the fixed limit. Line 96 says a view passes at most at 0.1%, just above the table. Line 121 and line 183 tell the reader to write each accepted difference down in a report. So the reader can accept a 0.3% view by hand. The page only lacks the link between the two.
- The reader also has what they need to judge a looser view. The FAIL line of `test` prints the share of pixels that differ (docs/cli/null3d.md:320), and the run saves a `-diff.png` (docs/cli/null3d.md:308; page line 93).
- The proposed edit is wrong in one step. `shot` draws one image and compares nothing (packages/cli/src/shot.js has no diff or compare code). "Capture it with shot, read the diff by eye" gives the reader no diff. The `test` run already gives both the share and the diff image.
- Severity: medium, not high. The page states the 0.1% rule beside the table, so the reader is not blocked. The table only leaves them unsure how a looser view fits the `test` command.

## Corrected claim

`bunx @null3d/cli test` has one fixed tolerance (0.1% of pixels) and no setting to change it. The Tolerances table gives looser limits (0.5% for shadows, a diff review for some content) but does not say that `test` still fails those views, or how to accept them. Line 96 states the fixed limit and lines 121 and 183 ask for a written record of accepted differences, so the gap is the missing link between them.

## Corrected edit

Add one short paragraph after the table:

"`bunx @null3d/cli test` fails every view past 0.1% of pixels. For a view with a looser tolerance in this table, read the share that its FAIL line prints, and open its `-diff.png`. When the share is under the tolerance, and the diff shows only the expected difference, accept the view and write it in your report."

Keep the views in `null3d.json`, so the run still shows the share on each change. Do not tell the reader to use `shot` for this. Adding a per-test tolerance setting to the CLI is a code change, not a docs fix, and is out of scope for this page.
