# tree-structure-02

## The finding as given

```json
{
 "page": "index,pages,all written pages",
 "anchor": "> Roadmap step 0.x, first released in null3D 0.1.0.",
 "category": "internal-note",
 "severity": "high",
 "claim": "103 pages open with a 'Roadmap step' banner, and index.md and pages.md explain a 'Step' column. A roadmap is an internal plan, and a 'since: 0.3' on a page first shipped in 0.1.0 confuses readers.",
 "evidence": "grep finds 'Roadmap step' in 103 docs pages; tools/lib/steps.ts STEPS_NOTE and releaseOf print 'roadmap step ${since}, first released in null3D 0.1.0'; pages.md table header '| Page | What it covers | Status | Step |'.",
 "proposedEdit": "Use release versions only. Set since to the first release that ships the page (0.1.0 today), print 'First released in null3D 0.1.0', rename the column 'Since', and drop the step sentences from index.md and pages.md.",
 "generatedSource": "tools/lib/steps.ts, PAGES since values in tools/lib/docs.ts, front matter of each page",
 "id": "tree-structure-02",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

- The problem is real in the reviewed copy (generated from commit 032e60034). 103 files under docs/ hold "Roadmap step" (for example docs/cookbook/index.md:11, docs/cli/null3d.md:11). tools/lib/steps.ts:10 (STEPS_NOTE) and :16-21 (releaseOf) print "roadmap step ..., first released in null3D 0.1.0". docs/index.md:34 and :49 and docs/pages.md:11 explain the step column, and docs/pages.md:15 has the header "| Page | What it covers | Status | Step |". The website turns front matter `since` into a tag, so a page shows "SINCE 0.3" for a feature that first shipped in 0.1.0 (.dev/decisions/D-397-docs-without-labels.md, Summary). That is internal plan wording in public docs and it misleads.
- The proposed edit is wrong. The working branch (docs/no-status-labels, commits 10aa9fb37 and 300ae91dd, both after 032e60034) already fixes this a different way, by the owner's ruling in D-397: pages carry no status and no since label at all. AGENTS.md docs rule 4 (line 215) now says "Pages carry no status or version labels, because the website shows them as tags. Only the owner adds one to a page." tools/lib/steps.ts no longer exists, grep finds no "Roadmap step" and no "roadmap" in docs/, no page has `since:` or `status:` front matter, and the docs/pages.md header is "| Page | What it covers |" (line 14). tools/lib/docs.ts:74 and :601-604 keep `since` only as an optional label.
- The finding's edit would put back a "First released in null3D 0.1.0" note on every page and a "Since" column. That breaks AGENTS.md rule 4 and D-397, and it also adds back the per-page version tag the owner removed.

## Corrected claim

In the reviewed copy, 103 pages open with "Roadmap step 0.x, first released in null3D 0.1.0", index.md and pages.md explain a roadmap Step column, and the website shows the step as a "SINCE 0.x" tag. The roadmap is internal, so this wording must go. The working branch already removes it.

## Corrected edit

No new edit on the working branch: commits 10aa9fb37 and 300ae91dd already remove the banners' release and status sentences, the Status and Step columns, the Since column of the three.js mapping, the step sentences in docs/index.md and docs/pages.md, and tools/lib/steps.ts. Do not add a "First released in null3D 0.1.0" note or a "Since" column: AGENTS.md rule 4 (D-397) lets only the owner add a version label. Regenerate the docs copy from the branch head before the next review pass so this finding does not come back.
