# Verdict: concepts-1-substance-07

## The finding as given

- page: concepts/architecture, concepts/assets, concepts/backends, concepts/color-management, concepts/culling, concepts/handles, concepts/instances, concepts/large-worlds, concepts/lighting, concepts/lod
- anchor: Line 11 of every page: "> Roadmap step 0.1, first released in null3D 0.1.0."; the assets banner "... are built."
- category: internal-note
- severity: medium
- claim: "Roadmap step" is a word from the maintainers' plan. A reader cannot look up a roadmap step, and every step ships in 0.1.0. The assets banner's "are built" reads as a status report. The rules forbid internal plan words in docs/. The banner is on 103 pages, and the docs check demands it.
- evidence: tools/lib/steps.ts:5-29 (ROADMAP_STEPS, shipsSentence); tools/lib/docs.ts:651-658 (the check demands the sentence); AGENTS.md "Writing docs": never mention internal plans.
- proposedEdit: Make shipsSentence return "First released in null3D 0.1.0." for every roadmap step. Change the check in tools/lib/docs.ts:651-658 and the tests in tools/lib/docs.test.ts and tools/lib/steps.test.ts to match. In the assets banner, drop the "are built" list: the page body states each feature.
- generatedSource: tools/lib/steps.ts

Verdict: partly

## Evidence

- In the generated copy (built from commit 032e60034), all ten pages open line 11 with "> Roadmap step 0.x, first released in null3D 0.1.0." 103 pages carry that note. tools/lib/steps.ts:5-29 builds the sentence, and tools/lib/docs.ts (the note check after the `since` check) refuses a page whose note does not start with it. AGENTS.md "Writing docs" forbids internal plan words. So the claim holds for that copy.
- The working branch has already fixed the roadmap part. Commit 10aa9fb37 ("docs: drop the status and version labels from the docs pages") and 300ae91dd removed the release and status sentences from every note. tools/lib/steps.ts no longer exists, and tools/lib/docs.ts has no shipsSentence or roadmap check. docs/concepts/lighting.md, lod.md and architecture.md on the branch no longer say "Roadmap step". The decision record that the commit adds counts 102 such notes, and it says a note that held only those sentences is gone.
- The proposed edit to steps.ts, docs.ts and steps.test.ts targets code that is gone. It would also keep a version sentence on every page, which goes against the branch's ruling that pages carry no release or status labels.
- The assets part still holds on the branch. docs/concepts/assets.md:9 still reads "> Models, prefabs, meshopt and Draco compression, textures, KTX2 files, integer vertex types and the upload budget are built. The skins, clips and morph targets of glTF files load and animate, and textures stay under each preset's memory budget." This is a progress report, not a limit. The branch rule keeps a note only when it states limits. The page body covers each listed feature: meshopt at line 47, Draco at line 57, integer vertex types at line 59, KTX2 and the optimize step at line 39, and skins or morph targets in two places.

## Corrected claim

On the working branch, the "Roadmap step 0.x, first released in null3D 0.1.0." sentence is already gone from every page, along with its generator and check. What remains is the assets page's note (docs/concepts/assets.md:9). It lists the features that "are built", which reads as a status report from the maintainers' plan and states no limit. The page body already covers each of those features.

## Corrected edit

Delete the whole note under the title of docs/concepts/assets.md (line 9 on the branch), both sentences. It states no limit, so nothing is lost. Make no change to the banner code, because the branch has already removed it.
