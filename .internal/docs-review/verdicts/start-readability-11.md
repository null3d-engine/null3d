# start-readability-11

## Finding as given

- Page: cli/null3d, cookbook/index, getting-started/cdn, getting-started/first-scene, getting-started/hosting, getting-started/install, getting-started/network-use, getting-started/project-structure, getting-started/third-party-notices, index
- Anchor: line 11 of each page: '> Roadmap step 0.1, first released in null3D 0.1.0.'; index.md line 34
- Category: scan-order. Severity: medium.
- Claim: The first line under every title names a maintainers' roadmap step. All steps shipped in one release, so it tells a reader nothing, it is a plan word the writing rules keep out of docs, and it pushes the opening sentence down. The index spends a paragraph on the step column.
- Evidence: 103 pages carry 'Roadmap step'. The text comes from shipsSentence in tools/lib/steps.ts line 18; the docs check in tools/lib/docs.ts (about line 662) and tools/lib/docs.test.ts line 90 require it. index.md line 34; pages.md line 11.
- Proposed edit: Change the banner to '> First released in null3D 0.1.0. The API is experimental, so it can still change between versions.' Update shipsSentence and the check. Drop or rename the Step column in pages.md (tools/lib/docs.ts about lines 411 and 557) and delete index.md line 34.
- Generated source: tools/lib/steps.ts

Verdict: partly

## Evidence

The claim holds for the reviewed copy:
- The generated copy is built from commit 032e60034 (#572). Its 10 named pages all carry the note at line 11, for example getting-started/install.md:11 "> Roadmap step 0.1, first released in null3D 0.1.0. The API is experimental, ...". 103 pages under docs/ match "Roadmap step".
- The text comes from releaseOf and shipsSentence in tools/lib/steps.ts (lines 14-30). The docs check uses it at tools/lib/docs.ts:652, and docs.test.ts:90 expects it.
- index.md:34 is the paragraph on the step column. pages.md:11 repeats the note, and docs.ts:536 and :557 write the Step column and the note.
- AGENTS.md:231 keeps maintainers' internal plans out of docs, so "roadmap step" is a fair target.

The proposed edit is wrong and is already overtaken:
- The current branch (docs/no-status-labels, commits 10aa9fb37 and 300ae91dd) already removes all of this. In the worktree, no page under docs/ carries "Roadmap step", tools/lib/steps.ts no longer exists, the page list has only "Page | What it covers" (tools/lib/docs.ts:496), and docs/index.md has no step paragraph and no table of status labels.
- The owner's ruling on that branch (.dev/decisions/D-397-docs-without-labels.md) drops the release sentence AND the status sentence from the note. The proposed banner keeps "First released in null3D 0.1.0. The API is experimental ..." on every page, so it puts back a status label the owner chose to remove. Every page would also repeat a sentence that tells the reader the same thing.
- One fixed banner for every page would also lose text that is specific to a page. cli/null3d.md:11 adds "`test` runs image tests, and no behavior tests.", and cookbook/index.md:11 has its own wording ("The APIs that the recipes use ..."). The branch keeps the limits a note states: cli/null3d.md now has only "> `test` runs image tests, and no behavior tests."

## Corrected claim

The note under each title of the reviewed copy opens with a roadmap step, a plan word that tells a reader nothing because every step shipped in 0.1.0. The index (line 34) and the page list (the Step column and the note at line 11) explain it. The current branch docs/no-status-labels already fixes this. It removes the release and status sentences from every note, deletes tools/lib/steps.ts, the Step and Status columns and the index paragraph, and keeps any limit a note states.

## Corrected edit

Make no new edit. Land the docs/no-status-labels branch as it is (D-397). Do not bring back a "First released in null3D 0.1.0. The API is experimental" banner: the owner ruled against status and version labels. After the branch merges, check the generated copy again. Confirm that no page or generated page (pages.md, error pages, threejs-mapping.md) still says "Roadmap step" or "Since".
