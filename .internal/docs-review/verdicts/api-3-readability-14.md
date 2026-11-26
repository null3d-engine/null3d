# Verdict on api-3-readability-14

## The finding as given

- Page: api/raycast, api/render, api/scene, api/sketch, api/sound, api/splats, api/sprites, api/tasks, api/terrain, api/textures, api/three-compat, api/time, api/ui, api/vertex-draws, api/water, api/wind
- Anchor: line 11, the status callout
- Category: scan-order. Severity: medium.
- Claim: Every callout starts "Roadmap step 0.x", which is maintainer plan language. On raycast, sprites, terrain and textures the same callout also holds feature limits (bind-pose queries; no shadows or overlap queries; no collision, morph and skirt; no cube-map sampling). Readers skip callouts as boilerplate, and the raycast and terrain limits repeat later in the page.
- Evidence: raycast line 11 repeats at line 234; terrain line 11 repeats at lines 82-86, 98. tools/lib/steps.ts shipsSentence writes "Roadmap step <since>, first released in null3D 0.1.0."; tools/lib/docs.test.ts line 137 enforces it.
- Proposed edit: Change the sentence to "First released in null3D 0.1.0. The API is experimental, so it can still change between versions." in tools/lib/steps.ts, and update the check and its tests. Move the limits out of the callouts. Raycast: delete it, since "What queries test" covers it. Sprites: add a "## Limits" list after Speed. Terrain: the collision note is already in "Placing things on the ground"; move the morph and skirt to How it works. Textures: add the cube-map sentence to Options or a Limits list.
- Generated source: tools/lib/steps.ts (shipsSentence) and the callout check in tools/lib/docs.ts

Verdict: partly

## Evidence

- All 16 pages open line 11 with "> Roadmap step 0.x, first released in null3D 0.1.0. The API is experimental, ...". Confirmed.
- tools/lib/steps.ts:25-30 (shipsSentence, through releaseOf at :16-22) writes the sentence. tools/lib/docs.ts:651-658 refuses a note that does not start with it. tools/lib/docs.test.ts:136-139 tests it.
- The step number tells a reader nothing. steps.ts:10 and docs/index.md:34 say steps 0.1, 0.2 and 0.3 all ship in 0.1.0. The roadmap is not published: the README carries no roadmap from 0.1.0 on (.dev/decisions/D-108-first-release.md, Consequences). So "Roadmap step" points at an internal plan, which the "Writing docs" rule in AGENTS.md forbids. The claim holds.
- The wording is not unexplained, though. docs/index.md:34 and docs/pages.md:11 explain the steps. And "roadmap step" appears in more places than the callout: STEPS_NOTE (steps.ts:10), which docs.ts:411 (the three.js mapping's Since note, docs/porting/threejs-mapping.md:18), docs.ts:557 (docs/pages.md:11) and docs.ts:662 (the check's message) use, and the written docs/index.md:34 and :49. The proposed edit changes only shipsSentence. That leaves the step column and the notes on those pages still naming roadmap steps, with no callout that matches them.
- Raycast: the bind-pose sentence repeats at docs/api/raycast.md:234. The pixel-exact sentence repeats at :153 and :162. Deleting both from the callout loses nothing. Confirmed.
- Terrain: "no collision" repeats at docs/api/terrain.md:98. The morph and the skirt are already in "How it works" at :82 and :86. So nothing needs to move: delete them from the callout. They are also not limits. They describe how blocks meet, so the claim's "no ... morph and skirt" misreads them.
- Sprites: "do not cast or receive shadows" and "overlap queries do not find them" appear nowhere else on docs/api/sprites.md, so they must move, not go. The page already has fitting sections: "Blending, sorting and depth" (:143) and "Clicks and raycasts" (:149). A new "## Limits" section after Speed would hold only two lines and sit apart from the topics they qualify.
- Textures: the cube-map limit is only half covered elsewhere. docs/api/textures.md:103 says KTX2 cube maps throw E1412, but not that materials do not sample cube maps, and not the background workaround. The sentence must move. "Sampling" (:244) fits it better than "Options" (:54), which is a table of options.
- "Readers skip callouts as boilerplate" is a judgement, but 16 identical notes make it likely, so the cost to a reader is real.

## Corrected claim

Every callout starts "Roadmap step 0.x". This names an unpublished internal plan, and the number tells a reader nothing, since all three steps ship in 0.1.0. The same "roadmap step" wording comes from STEPS_NOTE and is on pages.md, index.md and the three.js mapping too. On raycast and terrain the extra callout sentences repeat the body: raycast lines 153, 162 and 234, terrain lines 82, 86 and 98. On sprites and textures they are the page's only statement of the limit. Terrain's morph and skirt are behavior, not limits.

## Corrected edit

1. In tools/lib/steps.ts, make shipsSentence give "First released in null3D 0.1.0." for the step values. Rewrite STEPS_NOTE and releaseOf so no published text says "roadmap". For example, the step column becomes "Since", and the note says every feature on these pages first shipped in null3D 0.1.0. Update the matching text in tools/lib/docs.ts:411, :557 and :662, docs/index.md:34 and :49, and tools/lib/docs.test.ts:136-145. The roadmap-number wording came from the first-release decision, so the owner should agree to the change.
2. Raycast: delete the two sentences after the experimental sentence. The body covers them.
3. Terrain: delete the three sentences after the experimental sentence. Lines 82, 86 and 98 already hold them.
4. Sprites: move "Sprites do not cast or receive shadows." into "Blending, sorting and depth". Move "Overlap queries do not find sprites. Use a raycast." into "Clicks and raycasts". Do not add a "## Limits" section.
5. Textures: move "Materials do not sample cube maps. A cube map can be a background: [Assets](assets.md) loads one with `assets.loadCubemap`." into "Sampling".
