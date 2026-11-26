# api-reference-readability-30

## Finding as given

- page: api/reference/engine, api/reference/sketch, api/reference/post, api/reference/quality, api/reference/render
- anchor: H1 titles
- category: structure
- severity: low
- claim: Titles repeat 'API' or hold two colons, which reads poorly in the site's navigation.
- evidence: 'Page API: createEngine: API reference', 'Sketch API: defineSketch and the context: API reference', 'Post-processing API: API reference', 'Quality API: API reference', 'Render graph API: API reference'. referencePage appends ': API reference' to the PAGES title.
- proposedEdit: Add an optional short reference title to PAGES entries, or strip a trailing ' API' and text after the first colon: 'Engine: API reference', 'Sketch: API reference', 'Post-processing: API reference', 'Quality: API reference', 'Render graph: API reference'.
- generatedSource: tools/lib/docs.ts

Verdict: partly

## Evidence

- tools/lib/docs.ts:328 and :333 build the front-matter title and the H1 as `${page.title}: API reference`. The five titles are exactly as the finding quotes them (line 3 of each generated page).
- The PAGES titles are at tools/lib/docs.ts:109 ('Page API: createEngine'), :110 ('Sketch API: defineSketch and the context'), :124 ('Post-processing API'), :125 ('Render graph API'), :131 ('Quality API'). The other 34 reference pages have clean titles, so only these five are affected.
- The same template has a worse instance the finding missed: tools/lib/docs.ts:331 writes the summary as "Every export of the ${page.title} API". docs/api/reference/post.md line 5 reads "Every export of the Post-processing API API". Quality and render repeat the word the same way. Engine and sketch get "the Page API: createEngine API" and "the Sketch API: defineSketch and the context API".
- The written pages docs/api/engine.md, sketch.md, post.md, quality.md and render.md use the PAGES titles as their own titles. Shortening the PAGES titles would change those pages and docs/pages.md too.

## What does not hold

The second option in the proposed edit is wrong. "Strip a trailing ' API' and the text after the first colon" turns 'Page API: createEngine' into 'Page', not 'Engine', so the engine page would get "Page: API reference". A rule that matches on text is also fragile when titles change later.

## Corrected edit

In tools/lib/docs.ts, add an optional short name to PageEntry, for example `referenceTitle`. Set it on the five entries: 'Engine (createEngine)' or 'Engine', 'Sketch', 'Post-processing', 'Render graph', 'Quality'. In referencePage, use `page.referenceTitle ?? page.title` for the title, the H1 and the summary. Keep `page.title` for the link text to the written page at line 335. Change the summary template to "Every export documented on the ${name} page, from the engine's doc comments." Then no title can give "API API". Regenerate the reference pages. Severity low is right.
