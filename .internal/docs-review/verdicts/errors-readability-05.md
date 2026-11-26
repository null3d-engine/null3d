# errors-readability-05

## Finding as given

- page: errors/E1109
- anchor: page lines 13 and 17
- category: technical-details-block
- severity: high
- claim: A common error (9 pages link to it) has a 216-word, 12-sentence cause and a 161-word, 10-sentence fix. The fix is a sequence (measure, use less, raise the limit, handle several engines) written as prose. Memory figures and retry timings bury the cause.
- evidence: stats.json E1109: line 6 (216 words, 12 sentences), line 10 (161 words, 10 sentences). codes.ts line 84; fixes.ts line 24.
- proposedEdit: Cause: 'The engine could not create or grow its WebAssembly memory. A page with worker threads gives the engine 1 GiB by default, and up to 4 GiB through createEngine's memory option.' Cases: many instance rows; a mesh of millions of vertices; the first frame copying every mesh; the browser refusing memory sooner. Details block 'Technical details: memory figures and the retry': bytes per row and per vertex, the direct and indirect peaks, the 8 MiB reserve, the 45-second retry and memory-wait. Fix as numbered steps: 1 measure, 2 use less (bullets), 3 raise memory.maximumMiB, 4 with several engines, destroy unused ones or reuse one. Keep the runtime fix to steps 1 to 3 in at most 4 sentences.
- generatedSource: packages/engine/src/errors/codes.ts (E1109); packages/engine/src/errors/fixes.ts (E1109)

Verdict: partly

## Evidence

- The readability problem is real. docs/errors/E1109.md line 13 (cause) and line 17 (fix) are each one paragraph; stats.json gives 216 words / 12 sentences and 161 words / 10 sentences. The cause mixes the main point (memory could not grow; 1 GiB default, 4 GiB maximum) with bytes per row, bytes per vertex, direct and indirect peaks, the 8 MiB reserve and the 45-second retry. The fix is a sequence written as prose.
- The page is much linked: 12 docs pages besides itself mention E1109 (guides/phones, guides/performance, concepts/assets, concepts/backends, concepts/particle-buffer, concepts/instances, api/assets, api/engine, api/scene, api/reference/assets, api/reference/engine, errors/index), plus pages.md. The "9 pages" count is low, which only makes the finding stronger.
- The edit as written cannot be made in codes.ts and fixes.ts alone:
  - tools/lib/docs.ts errorPage() (line 436 on) puts entry.cause in three places: the front-matter summary (line 442), the "What happened" section (line 448), and the errors/index.md table cell through tableCell(entry.cause) (line 466). A details block, with its blank lines and HTML, inside the cause string would end up in the YAML summary and in a one-line table cell, and would break the index table.
  - fixes.ts header comment (lines 1-5): the fix text "ends every EngineError message" at runtime, and codes.ts line 624 makes the page's fix the same string (errors.test.ts line 185 checks that). Numbered Markdown steps or bullets in that string would print as raw Markdown in console errors. There is one string for both the page and the runtime message, so "keep the runtime fix to steps 1 to 3" while the page shows step 4 needs a second, page-only field. The finding does not name one.
- Step 4 (several engines: destroy unused ones, or keep one and detach and attach it) is runtime-relevant: it is the fix for the case where a new engine cannot start. Dropping it from the runtime message would remove the one fix for that case.

## Corrected claim

The cause and the fix of E1109 are each one dense paragraph (216 and 161 words), which buries the main point. Splitting them needs a generator change, not only new text: the cause string also feeds the page summary and the errors index table, and the fix string is the tail of every runtime E1109 message, so neither string can hold a details block or Markdown lists.

## Corrected edit

1. codes.ts (E1109) cause, plain sentences only (it stays the summary and the index cell): "The engine could not create or grow its WebAssembly memory. A page with worker threads gives the engine 1 GiB by default, and up to 4 GiB through the memory option of createEngine. Many instance rows, a mesh of millions of vertices, or the first frame, which copies every mesh, can fill it. A browser can refuse memory sooner, as phones often do, or while an engine that stopped before still holds its memory."
2. Add an optional page-only field to the error entry type in codes.ts (for example `details`), and have errorPage() in tools/lib/docs.ts render it after the cause as:
   <details>
   <summary>Technical details: memory figures and the retry</summary>

   bytes per row (about 210, about 300 with per-row colors or values; about 5 million rows fill 1 GiB), about 100 bytes per vertex while normals are computed, the first-frame peaks (84 MiB of meshes peaks at about 270 MiB direct, 205 MiB indirect), the 8 MiB reserve, and the 45-second retry with memory-wait through onProgress after 10 seconds.

   </details>
   Keep it out of the summary and the index table.
3. fixes.ts (E1109): keep plain sentences, since it is the runtime message tail, and shorten it to about 5 sentences that still cover all four moves: measure with engine.measure() (memory.wasmBytes against engine.mode.memoryMaximumMiB, with ?direct=on for the worst path); use less (share meshes, fewer rows, size batches and colors to need, split or simplify huge meshes, destroy unused batches); ask for a larger maximum with the memory option of createEngine; and with several engines, destroy unused ones or reuse one by detach and attach. If numbered steps on the page are wanted, add a second page-only field for them, rendered by errorPage(); do not put Markdown lists in the runtime string.
