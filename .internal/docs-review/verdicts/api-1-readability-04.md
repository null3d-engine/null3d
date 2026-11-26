# Verdict on api-1-readability-04

## The finding as given

- Page: api/debug
- Anchor: "## Stats overlay and frame figures" (line 177) to "### GPU time" (line 423)
- Category: split-page. Severity: medium.
- Claim: About two thirds of the page is the stats overlay, the frame figures and engine.measure. Those are measurement, not debug drawing. The page has 21 headings, 3 Mermaid diagrams and a summary that lists 14 subjects.
- Evidence: stats.json gives 6,807 words. debug.md:177-442 covers the overlay, the card, memory figures, GPU memory, cost, the overlay for another engine and frame measurement.
- Proposed edit: Keep "Debug drawing", "Debug views" and "The in-page inspector" on api/debug. Move "Stats overlay and frame figures" and "Frame measurement" to a new page api/stats ("Stats overlay and frame measurement"). Leave a two-sentence pointer section on api/debug. Update the links at engine.md:123 and :168 and features.md:318.

Verdict: partly

## Evidence

What holds:
- Lines 177 to 442 of docs/api/debug.md hold 4,557 of the page's 6,854 raw words (wc), which is 66%. So "two thirds" is right.
- stats.json lists 21 headings (the title and "API reference" included) and 3 Mermaid diagrams. Both match.
- The two halves serve different tasks. Lines 15 to 175 show where things are (lines, views, shadow cascades). Lines 177 to 442 measure the frame (overlay card, figure table, memory, GPU memory, cost, StatsPanel for another engine, engine.measure, GPU pass names). A reader who wants `debug.box` scrolls past about 4,500 words of measurement detail. That is a real cost, not taste.

What does not hold:
- "A summary that lists 14 subjects": the front matter summary (line 6) names about 19 items (nine drawing calls, then the overlay, debug.frameStats, @null3d/engine/stats, engine.measure, debug.view, the ?view switch, add-on views, debug.shadowCamera, the inspector, engine.inspect). Minor, but the count is wrong.
- "Those are measurement, not debug drawing": the page's title is "Debug drawing and stats" (line 9, and the PAGES entry at tools/lib/docs.ts:132). Stats are in scope by design. The case for a split is length, not a wrong subject.

The proposed edit is incomplete. It names three links to update, but many more point at the sections it would move:
- docs/guides/performance.md:304 (#stats-overlay-and-frame-figures)
- docs/guides/debugging.md:138 (#stats-overlay-and-frame-figures), :140 (#frame-measurement), :235 (the overlay and engine.measure are listed under api/debug)
- docs/concepts/culling.md:168 (#stats-overlay-and-frame-figures)
- docs/concepts/quality-presets.md:120 (#stats-overlay-and-frame-figures)
- docs/api/debug.md:286 and :298 link inside the page to #gpu-memory and #cost, which would move.

The edit also misses the generated and synced sources:
- A new page needs a PAGES entry in tools/lib/docs.ts (the api/debug entry is at line 132), which also regenerates docs/pages.md:76.
- The API reference page (docs/api/reference/debug.md) comes from TSDoc tagged `@category api/debug`. The stats exports carry that tag in packages/engine/src/page/frame-stats.ts, shared/stats.ts, shared/metrics.ts, debug/stats-panel.ts, debug/stats-options.ts, debug/stats.ts, debug/stats-text.ts and debug/page-meters.ts. These need `@category api/stats`, or the new page has no reference and api/debug keeps listing the stats exports.
- The "Docs and skills stay in sync" rule needs the skills changed too: skills/null3d-port-threejs/references/api-mapping.md:47 (renderer.info / stats.js row), skills/null3d-develop/references/performance.md:70, and the matching renderer.info entry in docs/data/threejs-mapping.json (the source of docs/porting/threejs-mapping.md and of the skill's mapping JSON).

The user's request favors collapsible blocks for dense detail. A split is still the better fix here, because even with blocks the main text of the stats half (overlay, tabs, figures table, frame measurement) stays long. But the new page should then put its densest parts into blocks: the work bars, the colors, the add-ons' rows, Memory by system, the GPU memory counting rules and limits, and the gpuPassMs naming rules.

## Corrected claim

About two thirds of the page (lines 177 to 442, 4,557 of 6,854 words) is the stats overlay, debug.frameStats, @null3d/engine/stats and engine.measure. The page title includes stats, so the scope is by design, but a reader who wants debug drawing or debug views must scroll past it. The page has 21 headings and 3 Mermaid diagrams, and its summary lists about 19 items.

## Corrected edit

Keep "Debug drawing", "Debug views" (with its subsections) and "The in-page inspector" on api/debug, retitled "Debug drawing and views". Move "Stats overlay and frame figures" and "Frame measurement" with their subsections to a new page api/stats ("Stats overlay and frame measurement"). Leave a two-sentence section on api/debug that says `debug.stats` and `debug.frameStats` show and give the frame figures, and links to api/stats. On the new page, put the dense parts in `<details>` blocks with a "Technical details: ..." summary: the work bars, the colors, the add-ons' rows, Memory by system, the GPU memory counting rules and limits, and the gpuPassMs naming rules.

Update every link: engine.md:123 and :168, features.md:318, guides/performance.md:304, guides/debugging.md:138, :140 and :235, concepts/culling.md:168, concepts/quality-presets.md:120, and the in-page links to #gpu-memory and #cost. Add an api/stats entry to PAGES in tools/lib/docs.ts and trim the api/debug summary there. Retag the stats exports' TSDoc from `@category api/debug` to `@category api/stats` in the eight files listed above. Point the renderer.info row in docs/data/threejs-mapping.json, skills/null3d-port-threejs/references/api-mapping.md:47 and skills/null3d-develop/references/performance.md:70 at api/stats.
