# start-substance-06

## Finding as given

- page: index, cli/null3d, cookbook/index, getting-started/cdn, getting-started/first-scene, getting-started/hosting, getting-started/install, getting-started/network-use, getting-started/project-structure, getting-started/third-party-notices
- anchor: line 11 of each page "> Roadmap step 0.x, first released in null3D 0.1.0."; index.md:34 and :49; pages.md:11 and its Step column
- category: internal-note
- severity: medium
- claim: "Roadmap step 0.1/0.2/0.3" names the maintainers' plan. All three steps ship in 0.1.0, so the label tells a user nothing. It also reads like a second version number. The writing rules bar internal plans from docs.
- evidence: tools/lib/steps.ts:1-30 (releaseOf, shipsSentence, STEPS_NOTE); tools/lib/docs.test.ts:135-142 (the docs check requires the sentence).
- proposedEdit: Make shipsSentence return "Available since null3D 0.1.0." for the three steps, and drop STEPS_NOTE. Rename the Step column of pages.md to "Since", and show 0.1.0. Remove index.md:34, and change :49 to "with its status and the release that added it". Update the docs check to match.
- generatedSource: tools/lib/steps.ts, tools/lib/docs.ts

Verdict: partly

## Evidence

The claim is true of the reviewed copy, which is generated from main:
- Each of the ten pages opens line 11 with "> Roadmap step 0.x, first released in null3D 0.1.0.". index.md:34 explains the step column. index.md:49 says pages.md lists "its status and the roadmap step". pages.md:11 repeats the steps note, and its table has a Step column.
- steps.ts:6-10 maps steps 0.1, 0.2 and 0.3 all to release 0.1.0, so the step value gives a reader no release information. AGENTS.md (Writing docs) forbids the maintainers' "internal plans" in docs. "Roadmap step" is such a plan word.
- docs.test.ts:135-142 and docs.ts:652-662 make the docs check require the sentence. shader-library.ts:263 also uses it, so docs/shaders/library.md carries it too.

What does not hold:
1. The fix is already built on the branch under review (docs/no-status-labels, commits 10aa9fb37 and 300ae91dd). That branch deletes tools/lib/steps.ts and drops `since` and `status` from every written page. It also removes the release and status sentences from each title note, the Status and Step columns from pages.md, the Since column from the three.js mapping, and index.md's step paragraph. index.md:37 there reads "[All pages](pages.md) lists every page by area." In that worktree, a search of docs/ and tools/ for "roadmap step" finds nothing. The decision record D-397 states the owner's ruling.
2. The proposed edit contradicts that ruling. It keeps a release label in every note ("Available since null3D 0.1.0."), keeps a "Since" column in pages.md, and keeps "its status" at index.md:49. D-397 says pages carry no status or version label unless the owner adds one, because the website turns `status` and `since` into page tags. Every page would read "since 0.1.0", which gives a reader no more information than the step label did.
3. The scope is too narrow. The label is on 102 written pages, plus docs/shaders/library.md (from shader-library.ts), not only the ten pages in the start slice.

## Corrected claim

In the docs generated from main, every written page (102 of them, plus the shader library page) opens with "Roadmap step 0.x, first released in null3D 0.1.0." The step names the maintainers' plan and tells a reader nothing, because all three steps ship in 0.1.0. index.md and pages.md explain it again and show it in a Step column. The docs/no-status-labels branch already removes all of this (D-397).

## Corrected edit

Make no new edit. Merge docs/no-status-labels, which removes tools/lib/steps.ts, the note sentences, the Status and Step columns, and the index.md text. Do not bring back a release label as "Available since 0.1.0" or a "Since" column. After the merge, check that the regenerated docs/shaders/library.md and docs/pages.md hold no "roadmap step" text.
