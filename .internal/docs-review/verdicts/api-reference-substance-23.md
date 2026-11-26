# api-reference-substance-23

## Finding as given

- Pages: api/reference/post, quality, render, engine, sketch, water, wind, grass
- Anchor: titles 'Post-processing API: API reference', 'Quality API: API reference', 'Render graph API: API reference', 'Page API: createEngine: API reference', 'Sketch API: defineSketch and the context: API reference'
- Category: unclear. Severity: low.
- Claim: Titles repeat 'API' and stack colons. Add-on pages say 'The engine's doc comments make this page', though the comments come from the add-on.
- Evidence: tools/lib/docs.ts:328,333,335.
- Proposed edit: Build the title from the page title without a trailing ' API' and before the first colon, plus ' reference': 'Post-processing reference', 'Page reference'. Write 'The doc comments in the code make this page.'
- Generated source: tools/lib/docs.ts

Verdict: partly

## Evidence

- tools/lib/docs.ts:328 builds the title as `${page.title}: API reference`; line 333 repeats it as the H1. The page titles come from PAGES (docs.ts:109-110, 124-125, 131): 'Page API: createEngine', 'Sketch API: defineSketch and the context', 'Post-processing API', 'Render graph API', 'Quality API'. So the generated titles do repeat "API" and stack two colons. Confirmed in the front matter of docs/api/reference/{post,quality,render,engine,sketch}.md.
- docs.ts:331 (summary) has the same fault and is worse: "Every export of the Post-processing API API", "Every export of the Page API: createEngine API". The finding does not name it, but the same edit must cover it.
- docs.ts:335 writes "The engine's doc comments make this page." on every reference page. docs/api/reference/water.md, wind.md, grass.md carry it, but their exports come from the add-on packages (@null3d/water, wind, grass), not the engine. Confirmed.
- No test or tool checks the title text (grep of tools/ and tests/ for "API reference" finds only the line that builds it). Links use page IDs (referenceLink), so a title change breaks nothing.

## What does not hold

The proposed title rule loses information. Cutting at the first colon turns 'Page API: createEngine' into 'Page reference' and 'Sketch API: defineSketch and the context' into 'Sketch reference'. The names createEngine and defineSketch, which a reader searches for, are dropped, and "Page reference" reads like a reference about pages.

## Corrected claim

Titles and summaries of the reference pages repeat "API" (the summary says "API API") and stack colons. Add-on reference pages credit "the engine's doc comments".

## Corrected edit

In referencePage (tools/lib/docs.ts), take name = page.title with " API" removed where it ends the title or comes before a colon. If the name has a colon, split it into head and tail and write `${head} reference: ${tail}`; else write `${name} reference`. Results: 'Post-processing reference', 'Quality reference', 'Render graph reference', 'Page reference: createEngine', 'Sketch reference: defineSketch and the context', 'Water (@null3d/water) reference'. Use the same name in the summary: `Every export on the ${page.title} page, from the doc comments in the code.` Change the quote line to: `The doc comments in the code make this page.`
