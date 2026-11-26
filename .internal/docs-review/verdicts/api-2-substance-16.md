# Verdict: api-2-substance-16

## Finding as given

- page: api/impostors, api/input, api/lights, api/lines, api/materials, api/math, api/objects, api/page, api/particles, api/points, api/post, api/quality
- anchor: the note under each title, "> Roadmap step 0.x, first released in null3D 0.1.0."
- category: internal-note; severity: medium
- claim: A roadmap step is a stage of the maintainers' build plan, and the rules forbid internal plans in docs. Every step ships in 0.1.0, so the step number tells users nothing. 103 pages carry the line.
- evidence: tools/lib/steps.ts:1-36 (releaseOf, shipsSentence); tools/lib/docs.ts:652-662 requires the wording; docs/index.md:34.
- proposedEdit: Make shipsSentence give "First released in null3D 0.1.0." for the pre-release steps. Update the check at docs.ts:652-662 and its tests (docs.test.ts:90, 135-142, steps.test.ts:12), then each page's banner. Call the pages.md column "Since", without "roadmap step".
- generatedSource: tools/lib/steps.ts and tools/lib/docs.ts

Verdict: partly

## Evidence

- All 12 named pages open line 11 with "> Roadmap step 0.1|0.2, first released in null3D 0.1.0." 103 files under docs/ carry "Roadmap step".
- tools/lib/steps.ts:6-29: the steps 0.1, 0.2 and 0.3 all map to release 0.1.0. releaseOf and shipsSentence add "roadmap step N" in front. tools/lib/docs.ts:651-657 makes the check demand that exact sentence.
- No published page or README describes the roadmap. The word appears only in these banners and in the notes that explain them (docs/index.md:34, docs/pages.md note, docs/porting/threejs-mapping.md:18, skills/null3d-port-threejs/references/api-mapping.md:10). A reader sees a step number that points at nothing public. AGENTS.md "Writing docs" forbids naming internal plans. The claim holds.
- The proposed pages.md rename is wrong. The values in that column are 0.1, 0.2 and 0.3 (front matter: 117 pages "0.1", 56 "0.2", 54 "0.3"). Labeled "Since", "0.2" and "0.3" read as release versions that do not exist. The engine's own check forbids that reading: docs.ts:75 (STEP_AS_RELEASE) blocks "null3D 0.2" and "null3D 0.3" because no release has those names. The porting mapping page already shows this confusion: its "Since" column holds step numbers, and docs.ts:411 needs a sentence to explain it.
- The edit also misses other places where the step text appears: STEPS_NOTE (steps.ts:10) in docs/index.md:34, the pages.md note (docs.ts:557), the "Step" column header (docs.ts:536), and the "Since" legend of the porting mapping page (docs.ts:411 and the sinceLegend in docs/data/threejs-mapping.json) with its copy in the porting skill.

## Corrected claim

The banner names a roadmap step, which is an internal plan that is not published. Every step ships in 0.1.0, so the step number gives the reader nothing to act on. Other places also show the step numbers: the docs home note, the All pages "Step" column and note, and the "Since" column and legend of the three.js mapping page and the porting skill.

## Corrected edit

- tools/lib/steps.ts: for the pre-release steps, make releaseOf give "null3D 0.1.0", so shipsSentence gives "First released in null3D 0.1.0." Remove STEPS_NOTE.
- tools/lib/docs.ts: keep the banner check, which now expects the new sentence. Change the check's message at docs.ts:662 so that it no longer says "step". In pages.md, remove the "Step" column, or show the release ("0.1.0") in a column called "Since". Never show 0.2 or 0.3 under "Since". Remove the step sentence from the pages.md note (docs.ts:557) and from docs/index.md:34. In the three.js mapping (docs.ts:411 and sinceLegend in docs/data/threejs-mapping.json), show the release, or remove the step legend.
- Update docs.test.ts:90, 124-144 and steps.test.ts, then generate the pages again so that all 103 banners change.
- The front matter field `since` can keep the step values as internal data, because the website does not show front matter as prose.
