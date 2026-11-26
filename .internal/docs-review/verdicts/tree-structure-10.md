# tree-structure-10

## The finding as given

- page: guides/add-ons, api/features, api/feature-draws, api/feature-effects, api/feature-instances, api/tasks, concepts/particle-buffer
- anchor: Add-on authoring pages
- category: structure
- severity: medium
- claim: Pages for add-on authors are spread over Guides, API and Concepts, among the pages an app developer reads. The particle buffer page itself says coding agents must not use its calls.
- evidence: concepts/particle-buffer banner: 'Coding agents must not use these calls.' api/features summary: 'One description for an add-on feature'. guides/add-ons: 'Building an add-on'. referencePageId() in tools/lib/docs.ts assumes the 'api/' prefix; 52 '@category api/<page>' tags name these pages.
- proposedEdit: New area extend ('Extending null3D'): extend/index NEW, guides/add-ons -> extend/add-ons, api/features -> extend/features, api/feature-draws -> extend/feature-draws, api/feature-effects -> extend/feature-effects, api/feature-instances -> extend/feature-instances, api/tasks -> extend/tasks, concepts/particle-buffer -> extend/particle-buffer. Generalize referencePageId and referenceLink to any area and retag. Fallback: keep the five API IDs in a last API group 'Add-on authoring'.
- generatedSource: tools/lib/docs.ts (AREAS, PAGES, referencePageId, referenceLink); @category tags in packages/engine/src

## Verdict: partly

## Evidence

Holds:
- docs/pages.md puts guides/add-ons under Guides, the five "Add-on ..." and tasks pages under API reference, and the particle buffer under Concepts. In the API table, api/features (tools/lib/docs.ts:126) and the three feature pages (:128-130) sit between api/render and api/quality, with api/vertex-draws (:127) in between; api/tasks is far below (:148). An app developer reads past them; an add-on author has no one place to start.
- The five API pages are for add-on authors: their titles start "Add-on ...", and api/tasks opens "An add-on can move heavy work off the thread...". No example or template calls addFeatureDraw, addFeatureEffect, addComputeInstances or runTask; only examples/addons/aurora calls defineFeature.
- The add-on guide does not gather them. docs/guides/add-ons.md links api/features (line 107) and api/tasks (line 45), but never links api/feature-draws, api/feature-effects or api/feature-instances, and its "Related pages" (line 155) lists none of the five.
- referencePageId and referenceLink (tools/lib/docs.ts:313-320) slice the 'api/' prefix. 52 '@category' tags name these five pages (grep of packages/*/src).

Does not hold:
- The particle buffer is not an add-on authoring page. Its summary says "how an emitter or sketch code writes births into it" (docs/concepts/particle-buffer.md:6), its diagram says "The core's emitter, or sketch code" (line 15), and line 24 says the page is "for an emitter that the add-on does not fit". It serves an app developer who writes a custom emitter in a sketch. The "Coding agents must not use these calls" line (line 11) is a warning to agents, not a sign that the page is for add-on authors. Moving it into an "Extending" area would mislabel it.
- The full move is a large cost for a navigation gain: seven page IDs change, the reference generator changes, 52 tags change, and links change in about 30 files (docs, skills/null3d-develop, skills/null3d-port-threejs, docs/data/threejs-mapping.json, tools/lib/size-report.ts). A new area also needs a matching change in the website's navigation, which this repo does not control. The page list has no sub-group concept (pageList in tools/lib/docs.ts:519-545 makes one table per area), so the "last API group" fallback means a reorder in PAGES, not a new heading, unless the generator gains groups.

## Corrected claim

The five add-on API pages (api/features, api/feature-draws, api/feature-effects, api/feature-instances, api/tasks) are scattered through the API list among pages that app developers read, and the add-on guide (guides/add-ons) does not link three of them, so an add-on author has no single path through them. The particle buffer page is not part of this set: it serves sketch code that writes its own emitter.

## Corrected edit

1. In PAGES (tools/lib/docs.ts), move the entries for api/features, api/feature-draws, api/feature-effects, api/feature-instances and api/tasks together to the end of the API area, in that order, so the page list shows them as one run after the app-facing API pages. No page IDs, tags or reference code change.
2. In docs/guides/add-ons.md, add the five pages to "Related pages", one line each: what the page gives an add-on author (one description of the render work; a draw from it; a full-screen pass from it; instances whose count the GPU writes; work on the job workers).
3. Optional: a one-line note at the top of each of the five pages, "This page is for add-on authors. [Building an add-on](../guides/add-ons.md) is the place to start."
4. Leave concepts/particle-buffer in Concepts. If the agent warning stays, it belongs with the other agent rules (the null3d-develop skill), not in the page banner; that is a separate finding.

A full "extend" area is a choice the owner can make later, together with a website navigation change; it is not needed to fix the reader's problem.
