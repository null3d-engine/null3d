# porting-shaders-readability-25

## Finding as given

- Page: porting/threejs-mapping
- Anchor: Lines 17-22 "The "Since" column gives the roadmap step..."; the Since column of every table
- Category: structure. Severity: low.
- Claim: Every Since value is 0.1, 0.2 or 0.3, and the page says all three ship in null3D 0.1.0, so the column tells the reader nothing to act on. It takes width from Notes, and its legend leads the page with roadmap terms before the first table.
- Evidence: JSON since counts: 99 at 0.1, 78 at 0.2, 15 at 0.3, 2 without. tools/lib/docs.ts line 411.
- Proposed edit: Drop the Since column and the sinceLegend text from the page render. Keep the Status legend. Keep the field in the JSON only if the skill copy needs it.
- Generated source: tools/lib/docs.ts (mappingMarkdown); docs/data/threejs-mapping.json

Verdict: refuted

## Evidence

- The claim is true of the generated copy that the reviewer read. In that copy, docs/porting/threejs-mapping.md lines 17-22 hold the Since legend and the "steps 0.1, 0.2 and 0.3 all ship in ... 0.1.0" note. Every table has a Since column. The JSON counts are 99 at 0.1, 78 at 0.2, 15 at 0.3 and 2 with none. The renderer in that copy writes the legend at tools/lib/docs.ts:411-413 and the column at tools/lib/docs.ts:422-427.
- The issue is already fixed in the branch source. Commit 10aa9fb37 ("docs: drop the status and version labels from the docs pages") on the current branch removes the column and the legend:
  - tools/lib/docs.ts:377-413 (worktree): mappingMarkdown writes only the Status legend, and the table header is `| three.js | null3D | Status | Notes | Docs |`. No Since column, no sinceLegend, no step note.
  - docs/data/threejs-mapping.json (worktree): top-level keys are only about, statusLegend and entries. sinceLegend is gone.
  - docs/porting/threejs-mapping.md (worktree): front matter is `generated: true` with no status or since. The page goes from the Status legend straight to the first table.
  - .dev/decisions/D-397-docs-without-labels.md lines 23 and 38: the decision states that the three.js mapping and its skill copy lose their Since column, and the mapping keeps its own Status column.
- The generated copy under the scratchpad was built before this commit, so it is stale for this page. The proposed edit matches what the branch has already done, so no further change is needed.

## Corrected claim or edit

None. No edit is needed. Regenerate the review copy from the current branch to stop this finding coming back.
