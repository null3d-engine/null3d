# api-reference-substance-13

Finding as given:

- page: api/reference/scene, engine, geometry, debug, materials, water, particles
- anchor: debug.md:13 `countPerSecond` before :21 `Debug`; engine.md opens with `CapabilityReport` and `checkAddonVersion` before `createEngine`
- category: scan-order, severity: medium
- claim: Pages are alphabetical walls with no index (scene 36 sections and 11,511 words, geometry 69 sections). User API, add-on author API (checkAddonVersion, ParticleBuffer.writeRecords 'into the core') and helpers for other engines (StatsPanel) mix with no label. The debug page opens with a stats helper.
- evidence: tools/lib/api-docs.ts:471 (symbols.sort by name), :505 (renderReference keeps that order); page statistics headings.
- proposedEdit: Open each page with an index table (export, kind, first sentence, import path). Group sections by import path; within a group put make functions first, then classes and interfaces, then types and constants. Optionally read a TSDoc @group tag such as 'add-on authors'.
- generatedSource: tools/lib/api-docs.ts, tools/lib/docs.ts

Verdict: partly

Evidence:

- tools/lib/api-docs.ts:471 sorts every export by name. renderReference (around :505) keeps that order. generateDocs in tools/lib/docs.ts:569-581 groups only by page, and referencePage (docs.ts:325-338) writes a title and one link line, then the sections. No index, no grouping. Confirmed.
- debug.md:13 is `countPerSecond`, before `Debug` at :21. engine.md:13 `CapabilityReport`, :32 `checkAddonVersion`, :40 `checkPluginInterface`, then :48 `createEngine`. Confirmed.
- checkAddonVersion (engine.md:38) says "An add-on calls it once, as its module loads". writeRecords (particles.md:46) says "in one call into the core". StatsPanel (debug.md:521) is for "a page that draws with another engine". None carries a label on the reference page. Confirmed.
- No reference page names an import path. StatsPanel lives in packages/engine/src/debug/stats-panel.ts and countPerSecond in packages/engine/src/shared/stats.ts, which the package exposes at a separate entry (packages/engine/package.json "./stats"). The written page shows this (api/debug.md:357), the reference page does not. This makes the import-path column of the proposed index a real gain.
- Not handled elsewhere: each reference page links to its written page, which explains the exports by task, but the reference itself gives a reader no way in other than scrolling or a browser search.
- Section counts are off by one: stats.json counts the page title as a heading. scene.md has 35 export sections (`grep -c '^## '`), geometry.md has 68.

Corrected claim:

The generated reference pages list every export in name order with no index, no import path and no grouping (scene: 35 export sections, 11,511 words; geometry: 68 sections). User calls, add-on author calls (checkAddonVersion, ParticleBuffer.writeRecords) and helpers for pages drawn with another engine (StatsPanel, from the separate stats entry point) sit side by side with no label. The debug page opens with a stats helper, and the engine page puts two types and two add-on checks before createEngine.

Corrected edit:

Keep the proposal, with two notes. (1) ApiSymbol (tools/lib/api-docs.ts:51) records no entry point, so readApi must also record the package entry each export comes from (from the package.json exports map) before the index or the grouping can show it. (2) If the website builds an "on this page" list from the headings, the index table adds value through its kind, import path and first-sentence columns, not the names alone; keep it as a short table, one row per export. Grouping by entry point, with make functions first, then classes and interfaces, then types and constants, is right. An optional audience tag (for example `@group add-on authors`) can label the add-on and other-engine exports.
