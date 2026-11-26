# porting-shaders-substance-14

## Finding as given

- Pages: porting/react-three-fiber, porting/threejs-loop-and-threads, porting/threejs-mapping, porting/threejs-materials, porting/threejs-overview, porting/threejs-postprocessing, porting/threejs-shaders, porting/threejs-unsupported, porting/verification, shaders/builtins, shaders/library, shaders/surface-functions, shaders/wgsl-rules
- Anchor: banner '> Roadmap step 0.3, first released in null3D 0.1.0.'; mapping lines 18-23 (Since column legend, '1.0: the stable API')
- Category: internal-note. Severity: medium.
- Claim: 'Roadmap step' is a build-plan term readers do not know. Every listed step ships in 0.1.0, so the mapping's Since column gives a user nothing to act on. '1.0: the stable API' promises a later feature, which AGENTS.md forbids.
- Proposed edit: Banner: 'First released in null3D 0.1.0. The API is experimental, so it can still change between versions.' Drop the mapping's Since column and the roadmap legend, or show the first release version.
- Generated source: tools/lib/steps.ts; tools/lib/docs.ts; docs/data/threejs-mapping.json

Verdict: partly

## Evidence

- All 13 pages open with "> Roadmap step 0.x, first released in null3D 0.1.0." (line 11; shaders/library.md line 13). The text comes from shipsSentence in tools/lib/steps.ts.
- threejs-mapping.md:18-23: the Since legend lists 0.1, 0.2, 0.3 and "1.0: the stable API". docs/data/threejs-mapping.json:10-15 holds that legend. The entries use only 0.1 (99), 0.2 (78) and 0.3 (15). No entry uses 1.0, so the 1.0 line only announces a later stable API. AGENTS.md "Writing docs": "It makes no promise of a later feature" and "Never mention the maintainers' milestones ... or internal plans". The claim about 1.0 holds.
- Every value in the Since column maps to the same release, 0.1.0 (steps.ts ROADMAP_STEPS and FIRST_RELEASE). The column gives a reader nothing to act on. That claim holds.
- Part that does not hold: "readers do not know" the term. docs/index.md:34 and :49 explain roadmap steps, and docs/pages.md (docs.ts:557) repeats that explanation. The term is defined on the docs home. It is still a maintainer milestone term with no use to a reader, so the rule problem stays.
- Scope is wider than the finding says. The banner appears on 103 pages, not only these 13. "Roadmap step" also appears in docs/index.md:34 and :49, in the pages.md note (docs.ts:557), and in the porting skill's copy of the mapping (skills/null3d-port-threejs/references/api-mapping.md, rendered from the same JSON by docs.ts ~395-430 with forSkill).
- The edit cannot be done on the 13 pages alone. The docs check in tools/lib/docs.ts:651-658 requires each experimental or stable page's note to start with shipsSentence(since). If you change shipsSentence, you must change every written page's banner in the same commit, and update tools/lib/steps.test.ts:6-13. The check message at docs.ts:662 and the STEP_AS_RELEASE rule also use the step wording.
- "Or show the first release version" is no help: every row would show 0.1.0. Drop the column.

## Corrected claim

The docs home defines "roadmap step", but it is a maintainer milestone term, and it gives a reader nothing to act on: every step ships in null3D 0.1.0. The issue is site-wide. It covers the banner on 103 pages, docs/index.md, docs/pages.md, the mapping's Since column and legend, and the porting skill's copy of the mapping. The legend's "1.0: the stable API" line is a promise of a later feature that no entry uses. AGENTS.md forbids it.

## Corrected edit

- tools/lib/steps.ts: change shipsSentence so that a step value gives "First released in null3D 0.1.0." Update tools/lib/steps.test.ts to match. Update the banner on all 103 written pages in the same change, because the docs check (docs.ts:651-658) requires the banner to start with this sentence.
- docs/data/threejs-mapping.json: remove sinceLegend and the per-entry since fields. tools/lib/docs.ts ~409-428: remove the Since legend lines and the Since column from the page and from the skill copy.
- docs/index.md:34 and :49, and the pages.md note in tools/lib/docs.ts:557: remove the step column and the roadmap wording, or say only that all pages ship in null3D 0.1.0.
