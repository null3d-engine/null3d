# Verdict: guides-1-readability-10

## The finding as given

- page: guides/debugging
- anchor: lines 97, 124, 138, 146
- category: long-paragraph, severity: medium
- claim: Line 138 (stats overlay) is 180 words and 12 sentences. Line 97 lists three renderFallback values in running text. Line 124 lists debug views plus a shadow tip. Line 146 lists the inspector panel's parts in running text.
- evidence: stats.json lines 90 (93 words, 7 sentences), 117 (84, 6), 131 (180, 12), 139 (93, 6).
- proposedEdit: Line 97: lead sentence and a table of no-surface, no-answer, failed-to-start. Line 124: list of debug.view('wireframe'), debug.view('lit'), ?view=levels; shadow tip in its own paragraph. Line 138: three parts: what the overlay shows (list), how to turn it on (list of createEngine({ stats: true }), engine.stats(true), ?stats, debug.stats(true)), and debug.frameStats(); move the memory-by-system columns into a details block. Line 146: list of tree, search, selection, field editor, frame figures.

Verdict: partly

## Evidence

- The four paragraphs are at lines 97, 124, 138 and 146 of docs/guides/debugging.md. The stats.json lines (90, 117, 131, 139) are the same paragraphs, offset by seven lines. The counts are facts, and all four paragraphs are over the limit.
- Line 97, line 124 and line 146: the proposed breaks are right. Each paragraph holds parallel items (three fallback reasons; two calls and an address switch; five parts of the panel). The shadow-cascade tip at the end of line 124 is a separate task and reads better as its own paragraph.
- Line 138: the split is right, but the details block for "Memory by system" is wrong. The linked page already holds this detail in full. docs/api/debug.md:312 has a "Memory by system" paragraph with the same three figures (uses, reserves, most used), the list of tables and when the register runs. docs/api/debug.md:188-195 already lists the four ways to show the overlay, with their hide forms and the production-build rule for the switch. docs/api/debug.md:70 states that the overlay and frame figures work in every build. A details block in the guide would copy a reference page that the paragraph links to. The guide should keep a short summary and link to the reference.
- Line 138 also ends with "Both work in production builds too." After the split, "Both" has no clear subject. Name the overlay and the frame figures call. The address switch works in a production build only when the Vite plugin's `urlSwitches` option is on (docs/api/debug.md:192; also stated on the guide at line 99).
- Side note, not part of this finding: line 97 says that the linked section "What the engine reports" in docs/api/engine.md describes each value. That section (docs/api/engine.md:156) names the field only. The three values are explained in the generated reference (docs/api/reference/engine.md:461, from the TSDoc on the render fallback type in packages/engine/src). A list or table on the guide is therefore useful, and the link should point at the reference.

## Corrected claim

All four paragraphs are too long, and lists help lines 97, 124 and 146. For line 138, the memory-by-system detail and the full list of overlay switches already live on the linked page (Debug drawing and stats), so they should be cut to a short summary and a link, not moved into a details block.

## Corrected edit

- Line 97: a lead sentence, then a short list or table of `no-surface`, `no-answer` and `failed-to-start`, then the sentence about the warning and the shared thread. Point the link at the reference entry that explains each value.
- Line 124: a lead sentence, then a list of `debug.view('wireframe')`, `debug.view('lit')` and the `?view=levels` switch, then the link. Put the shadow-cascade tip in its own paragraph.
- Line 138: three short parts.
  1. What the overlay shows: frame rate in the header; a card with per-thread CPU time and GPU time, memory, draw calls, triangles and objects, what limits the frame rate, GPU time per step, and rows for add-on features. Use a list.
  2. How to show it: a list of `createEngine({ stats: true })`, `engine.stats(true)`, the `?stats` switch and `debug.stats(true)` in the sketch.
  3. `debug.frameStats()` gives the sketch the figures for logs and tests. The overlay and this call work in production builds too.
  Replace the two memory-by-system sentences with one clause ("a development build also breaks memory down by engine system") and the existing link to Debug drawing and stats. No details block.
- Line 146: a lead sentence, then a list of the tree, the search box, selection with outline, the field editor and the frame figures at the foot.
