# api-reference-substance-07

## Finding as given

- page: api/reference/wind, api/reference/grass, api/reference/water
- anchor: grass.md:19 'A page awaits it in its setup'; wind.md:19; wind.md:65 'a page reads it in its next `onUpdate`'; grass.md:115
- category: contradiction
- severity: high
- claim: These pages say 'a page' for code that runs in the sketch. Elsewhere 'page' means the main thread and 'sketch' the sketch's thread (engine sketchThread, sound's page half). createWind and createGrass take a SketchContext, so the wording can lead a reader to call them on the wrong thread.
- evidence: wind.md:16 createWind(ctx: SketchContext); grass.md:16 createGrass(ctx: SketchContext). 'a page' counts: packages/wind/src/wind.ts 13, analytic.ts 10, packages/grass/src/grass.ts 6, packages/water/src/water.ts 6. Examples: packages/grass/src/grass.ts:363, packages/wind/src/wind.ts:130.
- proposedEdit: Replace 'a page' with 'a sketch' in the TSDoc of the wind, grass and water packages wherever the code runs in the sketch. Keep 'page' only for the main thread.
- generatedSource: packages/wind/src/*.ts, packages/grass/src/*.ts, packages/water/src/*.ts

Verdict: partly

## Evidence

What holds:
- The quoted text is on the pages. grass.md:19 "A page awaits it in its setup"; wind.md:19 "the calls that a page uses to set the wind"; wind.md:65 "a page reads it in its next `onUpdate`"; grass.md:115 "A page reads it from the engine's preset". `setup` and `onUpdate` are sketch callbacks. A page has neither.
- The counts are right: wind.ts 13, analytic.ts 10, grass.ts 6, water.ts 6. grass.ts:363 and wind.ts:130 hold the quoted text.
- The docs split the two sides clearly elsewhere. docs/api/sketch.md:43 says the page passes the module to `createEngine` and the sketch runs in the sketch worker. "Page API: createEngine" (sketch.md:226) is the page's side. docs/concepts/architecture.md:33-39 puts the page on the main thread. So "a page awaits it in its setup" mixes the two sides.
- The source contradicts itself. packages/wind/src/namespace.ts:1 says "claimed once as the sketch's thread loads", and the TSDoc at namespace.ts:6, which makes wind.md:48, says "claimed once as the page loads". The finding misses this file and field.ts, which has 3 more uses.

What does not hold:
- Severity is too high. A reader cannot easily call these on the wrong thread. Every factory takes a `SketchContext` (wind.md:16, grass.md:16, water.md:24-64), and the page never gets one. The same sentences name `setup` and `onUpdate`. The wording confuses, but it does not mislead a reader into a wrong call. Medium fits better.
- "Page" does not mean only "the main thread" in the docs. It also means the whole web page or app, for example "on a page without cross-origin isolation" (sketch.md:43, architecture.md:145). Some uses of "a page" in these add-ons mean the app as a whole, not the sketch.
- The scope is too narrow. The same "a page" for sketch-side code is in other reference pages: particles.md:316 and :323 (the same wind-field text as water.md:416 and :422), assets.md:198-199 and :327, debug.md:33, :396 and :438-446, controls.md:324, feature-instances.md:27. Sources include packages/engine/src/scene/particles.ts:171 and :182, gltf.ts:683, :723 and :746, and assets.ts:86, :93 and :223. If the edit fixes only wind, grass and water, the wind-field text in particles.md stays different from the same text in water.md.
- "Replace 'a page' with 'a sketch'" is too mechanical. Some uses need another word. namespace.ts:6 should say "as the sketch's thread loads", to match its own line-1 comment. grass.md:90 "as on a page that does not draw the hill" and grass.md:91 "a page that drives the rows itself" mean an app or scene. Where the sentence is about who downloads code ("a page downloads with its first ..."), "page" is right and should stay.

## Corrected claim

The wind, grass and water reference pages, and other sketch-side reference pages, often use "a page" as the actor for code that runs in the sketch ("A page awaits it in its setup", "a page reads it in its next `onUpdate`"). In the rest of the docs, the page is the `createEngine` side and the sketch is the module that has `setup` and `onUpdate`. This mixes the two terms, and the wind add-on's own source says "page" in one place and "the sketch's thread" in another (namespace.ts:1 vs :6). The `SketchContext` parameter keeps readers from a wrong call, so the cost is confusion, not a wrong call. Severity: medium.

## Corrected edit

In the TSDoc of packages/wind/src (wind.ts, analytic.ts, field.ts, namespace.ts), packages/grass/src/grass.ts and packages/water/src/water.ts, and in the matching text in packages/engine/src/scene/particles.ts (WindField / air docs), replace "a page" with "a sketch" where a sketch callback or a sketch call does the action (sets the wind, sends a gust, awaits in setup, reads in onUpdate, gives a material its settings, names no bands). Use "the sketch's thread" in namespace.ts:6. Use "a scene" or "an app" where the text means the whole app (grass.ts tuft camera and compute options). Keep "page" for the `createEngine` side and for downloads. Then check the other sketch-side reference pages (assets, debug, controls, feature-instances) for the same use, as one cross-page pass.
