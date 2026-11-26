# guides-2-substance-28

## Finding as given

- page: guides/lens-kit, guides/loading-screens, guides/multiple-views, guides/performance, guides/phones, guides/physics, guides/screens, guides/start-time, guides/testing, guides/ui-overlays, guides/video-textures
- anchor: line 11 on each page: '> Roadmap step 0.x, first released in null3D 0.1.0.'
- category: internal-note
- severity: low
- claim: The step number tells a guide's reader nothing they can use: the docs home says that steps 0.1, 0.2 and 0.3 all ship in 0.1.0. 'Roadmap step' reads as an internal plan term on a how-to page.
- evidence: tools/lib/steps.ts:25 (shipsSentence); tools/lib/docs.ts:652; docs/index.md:34; tools/lib/docs.test.ts:135-142 enforce the wording.
- proposedEdit: Make shipsSentence write 'First released in null3D 0.1.0.' and leave the step to the page list's column. Update the check in tools/lib/docs.test.ts.
- generatedSource: tools/lib/steps.ts

Verdict: refuted

## Evidence

- The claim is true of the review snapshot. The snapshot is built from commit 032e60034 (its top commit is "chore: generated files of 032e6003..."). There, line 11 of all 11 pages reads "> Roadmap step 0.x, first released in null3D 0.1.0. The API is experimental, ...". The sentence comes from shipsSentence in tools/lib/steps.ts:25, and the check in tools/lib/docs.ts:652 and tools/lib/docs.test.ts:135-142 requires it.
- The branch under review (docs/no-status-labels) already removes the issue. Commit 10aa9fb37 ("docs: drop the status and version labels from the docs pages") and commit 300ae91dd take out the note sentence, the step column and the check:
  - tools/lib/steps.ts does not exist on the branch.
  - A search of tools/, docs/, skills/ and AGENTS.md finds no "shipsSentence", "Roadmap step", "roadmap step" or "first released".
  - None of the 11 guide pages has a quoted note line on the branch. For example, docs/guides/physics.md goes straight from the title to its diagram.
  - The decision record .dev/decisions/D-397-docs-without-labels.md says the note under each title loses its release and status sentences, and the page list loses its Status and Step columns, by the owner's ruling.
- The proposed edit conflicts with that ruling. It would add a release label ("First released in null3D 0.1.0.") to every page, and it would keep the step in the page list's column. The owner has removed both. The edit also targets a file and a test that no longer exist.

## Corrected claim or edit

None. No change is needed: the current branch already removes the sentence from every page.
