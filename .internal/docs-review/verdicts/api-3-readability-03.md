# api-3-readability-03

## The finding as given

- page: api/scene
- anchor: ## The camera and the background (line 113) to ## Time of day (line 516)
- category: split-page
- severity: medium
- claim: The page every newcomer opens to create objects is 8,672 words. About two thirds is backgrounds, skies, sky layers for add-on authors, environment light, probe grids, reflection probes, fog and time of day, which buries the object calls.
- evidence: stats.json: 8,672 words, 28 long paragraphs, 24 headings; sky and lighting sections run from line 113 to 551.
- proposedEdit: Split into three pages. api/scene keeps What the scene creates, Models and copies, Finding objects, the first paragraph of The camera and the background, Multiple views, Lights, Decals, the material override, When changes take effect, Warm-up, Instance batches, Limits, plus a short 'Backgrounds, light and fog' paragraph that links out. New page 'Backgrounds and skies' (texture backgrounds, environments and cube maps, analytic sky, physical sky, sky layers, time of day). New page 'Environment light and fog' (environment, light probe grid, reflection probes, fog, volumetric fog). Add both to PAGES/AREAS and fix incoming anchors such as scene.md#time-of-day and scene.md#multiple-views.
- generatedSource: tools/lib/docs.ts (PAGES and AREAS entries for the new pages)

Verdict: partly

## Evidence

- The size claim holds. Word counts (wc) of docs/api/scene.md: whole page 8,708. Lines 131-299 (environments, physical sky, sky layers) 2,473 words. Lines 327-552 (environment, light probe grid, reflection probes, fog, volumetric fog, time of day) 3,194 words. Together 5,667, about 65% of the page. With the texture-background part of lines 113-130 it is about two thirds.
- The object calls are on lines 41-112 and 553-593. A reader who comes for objects must scroll past about 5,700 words of sky and light to reach Lights, Decals, When changes take effect, Warm-up, Instance batches and Limits. Collapsible blocks cannot fix this: the sections are main content, not side detail. A split is the right fix, not taste.
- The range "line 113 to 551" is not all sky and light. Multiple views (lines 300-326, 534 words) sits inside it. The proposal keeps it on api/scene, which is correct.
- The anchor list is wrong in one place. scene.md#multiple-views stays valid, because Multiple views stays on api/scene. The incoming anchors that move (counts across docs/ and skills/): #environments-cube-maps-and-the-sky (4), #fog (4), #the-light-probe-grid (2), #the-environment (2), #sky-layers (2), #volumetric-fog (1), #time-of-day (1). The page's own table row for createReflectionProbe links #reflection-probes and must point to the new page too. #the-camera-and-the-background (2) stays.
- AREAS (tools/lib/docs.ts:59-69) lists areas, not pages. The new pages are in the existing api area, so only PAGES (tools/lib/docs.ts:111 area) needs new entries. The api/scene PAGES summary and the page's front-matter summary must also drop the moved topics.
- Reference pages: generateDocs (tools/lib/docs.ts, the loop over PAGES) makes api/reference/<page> from exports whose TSDoc @category names that page. 36 exports carry @category api/scene, among them AtmosphereBackground, SkyLayer, SkyOptions, FogOptions, FogVolumeOptions, LightProbeGridData, ReflectionProbe, bakeProbes, timeOfDay and TimeOfDay (docs/api/reference/scene.md). The proposal names only PAGES. Without retagging, the new pages get no reference page of their own, and the scene reference page still lists every sky and fog type.

## Corrected claim

About two thirds of api/scene (about 5,700 of 8,700 words, lines 131-299 and 327-552) covers backgrounds, skies, environment light, probes, fog and time of day. Multiple views (lines 300-326) sits between those sections and stays on the page. This buries the object calls that end the page.

## Corrected edit

Split as proposed, with these changes:
1. Add the two pages to PAGES in tools/lib/docs.ts only. AREAS needs no change. Shorten the api/scene summary in PAGES and in the page's front matter.
2. Change the TSDoc @category tag from api/scene to the new page id on the exports that move: the sky, atmosphere, sky layer and time-of-day types and functions go to the backgrounds page; the environment, light probe grid, probe bake, reflection probe and fog types go to the environment light and fog page. Each new page then links to its own reference page, which the reference link check requires.
3. Repoint the moved anchors: #environments-cube-maps-and-the-sky, #fog, #the-light-probe-grid, #the-environment, #sky-layers, #volumetric-fog, #time-of-day, and the page's own #reflection-probes link in the table. Leave #multiple-views and #the-camera-and-the-background as they are.
