# tree-structure-15

## Finding as given

- page: concepts/lighting
- anchor: ## Environment maps
- category: split-page
- severity: medium
- claim: concepts/lighting (9,783 words, six diagrams, 19 long paragraphs) covers both lights and the whole environment.
- evidence: concepts/lighting sections: Fog | Environment maps | Reflection probes | Light probe grid | Sky and backgrounds | Time of day, after the light sections.
- proposedEdit: Split into concepts/lighting (light kinds, units, clustered shading, lights as objects, ambient and hemisphere, far from origin, lights in scene passes) and concepts/environment NEW (environment maps, reflection probes, probe grid, sky, time of day, fog), matching the API split.
- generatedSource: tools/lib/docs.ts (PAGES)

Verdict: survives

## Evidence

- The page outline matches the finding. Light sections are at lines 39-166 and 572. The environment sections are Fog (170), Environment maps (207), Reflection probes (286), Light probe grid (327), Sky and backgrounds (361) and Time of day (516). The title is "Lighting and environment" (line 9).
- stats.json gives 9,783 words, 19 long paragraphs and 6 Mermaid diagrams. By a plain word count, it is the longest page in docs/. The next longest are guides/performance (about 8,450) and guides/assets-pipeline (about 8,420).
- "Matching the API split" holds. The light calls are on api/lights. The environment, background, sky, fog, reflection probe and time-of-day calls are on api/scene, and environment loading is on api/assets. The page's own Related pages list points to those three API pages for the two halves.
- The page is hand-written, so PAGES in tools/lib/docs.ts is not its source. A new page still needs a PAGES entry there, so the generatedSource is right for the new page.
- I found no reason to call this taste. A reader who wants only how to add a point light must scroll past about 5,000 words on sky, probes and fog. The reverse is also true.

## Gaps in the proposed edit (not reasons to refute)

- About 14 links in other pages point at anchors that would move: docs/guides/assets-pipeline.md:459, docs/concepts/architecture.md:106, docs/concepts/post-processing.md:37 and :332, docs/api/assets.md:259, and docs/api/scene.md:244, :248, :341, :412, :416, :488, :512, :551 and :602. The api/assets and api/scene links come from TSDoc comments in packages/*/src, so the comments must change, not the generated pages.
- "A scene that shows a time of day" (line 158) sits under Ambient and hemisphere lights, but it is about time of day. Leave it on the lighting page with a link to the new page's Time of day section, or move it there.
- Both pages need new front matter summaries. The opening diagram (lines 11-27) has an "Environment" node. Keep that node and link it to the new page. The "Lights in scene passes" section names the environment, fog and background. It can stay on the lighting page with links.

## Corrected edit

Split as proposed. Also: (1) add a PAGES entry for concepts/environment in tools/lib/docs.ts, and edit the summary of concepts/lighting there and in its front matter; (2) change the anchor links in assets-pipeline, architecture and post-processing, and in the TSDoc sources of api/scene and api/assets, to point at concepts/environment.md; (3) keep "A scene that shows a time of day" on the lighting page with a link to the new Time of day section; (4) add cross-links in both Related pages lists.
