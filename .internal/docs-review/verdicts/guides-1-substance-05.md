# guides-1-substance-05

## Finding as given

```json
{
 "page": "guides/accessibility,guides/add-ons,guides/agents,guides/assets-pipeline,guides/audio,guides/baked-light-data,guides/car-paint,guides/content-pages,guides/custom-passes,guides/custom-shaders,guides/debugging,guides/deploying,guides/deterministic-simulation",
 "anchor": "note under each title: \"> Roadmap step 0.3, first released in null3D 0.1.0.\"",
 "category": "internal-note",
 "severity": "medium",
 "claim": "No published page shows the roadmap, so 'Roadmap step 0.x' means nothing to a reader and names an internal plan. 'Step 0.3, first released in 0.1.0' also reads as a contradiction.",
 "evidence": "line 11 of each page; tools/lib/steps.ts:5-30 (releaseOf, shipsSentence); docs/index.md:34 and docs/pages.md:11 describe a step column of an unpublished roadmap.",
 "proposedEdit": "Make shipsSentence give \"First released in null3D 0.1.0.\" for the pre-release steps. Drop or rename the step column in pages.md to 'First release'. Update the checks in tools/lib/docs.ts and tools/lib/docs.test.ts:90-142.",
 "generatedSource": "tools/lib/steps.ts",
 "id": "guides-1-substance-05",
 "slice": "guides-1",
 "role": "substance"
}
```

Verdict: refuted

## Evidence

The finding is accurate about the reviewed copy, but the problem is already fixed on the working branch, so no edit is needed.

- The reviewed copy is built from commit 032e60034 (its own commit is "chore: generated files of 032e600348f4..."). In that copy, line 11 of all 13 pages opens with "Roadmap step 0.x, first released in null3D 0.1.0." The text comes from tools/lib/steps.ts:16-30. docs/index.md:34 and docs/pages.md:11 describe the step column. No published page describes the roadmap. So the claim holds for that copy.
- The working branch (docs/no-status-labels) has one more commit, 10aa9fb37 "docs: drop the status and version labels from the docs pages". 032e60034 is an ancestor of it. That commit:
  - deletes tools/lib/steps.ts and tools/lib/steps.test.ts;
  - removes the release and status sentences from the note under each title (for example, HEAD:docs/guides/add-ons.md and HEAD:docs/guides/deploying.md have no such note now);
  - removes the Status and Step columns from the page list (the regenerated docs/pages.md shows "| Page | What it covers |" and the note "The docs generator writes this list from each page's front matter." with no step text);
  - removes the step paragraph from docs/index.md.
- `grep -i roadmap` over docs/, tools/lib/docs.ts and tools/gen-docs.ts on the branch finds nothing.
- The proposed edit points at tools/lib/steps.ts, which no longer exists. It would also rename a column that has already been removed.

## Corrected claim or edit

None needed. If the review is meant to cover the branch, rebuild the generated copy from 10aa9fb37 so that later findings are not based on text that has already been removed.
