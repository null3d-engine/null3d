# api-1-readability-17

## Finding as given

- page: api/engine
- anchor: ## Options (lines 90-123)
- category: structure
- severity: medium
- claim: One flat 34-row table mixes required inputs, quality overrides, threading, memory, start handlers and test switches. Several cells run to 60-80 words. 'Another value fails with E1213' repeats in seven cells.
- evidence: engine.md:97 (hdr), :99 (cloudSteps), :103 (keepTextureCopies). The E1213 sentence appears at :94, :99, :100, :102, :111, :112 and :113.
- proposedEdit: Split into tables under H3 headings: 'Quality', 'Threads and memory', 'The page' (transparent, input, stats, labels, preload), 'Start and messages' (onProgress, onSketchMessage, onSketchError, onWorkerRetry, signal) and 'Tests' (gpu, hold). Cut each cell to one sentence and a link. State once, under the tables: 'A value out of its range fails the start with E1213.'
- generatedSource: "" (correct: docs/api/engine.md is hand-written, not under docs/api/reference/)

Verdict: partly

## Evidence

- docs/api/engine.md:90-123 is one table with 32 option rows (lines 92-123), not 34. The rows mix quality overrides, threads, memory, callbacks and test switches in no order. That part holds.
- Cell word counts (the "What it does" column): hdr :97 = 56, cloudSteps :99 = 71, keepTextureCopies :103 = 61. "60-80 words" is slightly high for hdr, but the cells are long.
- "Another value fails with E1213" appears at :94, :99, :100, :102, :111, :112, :113: seven times, as claimed. The errors table at :62 already lists every option that E1213 covers, so the repeats add nothing.
- The proposal to "cut each cell to one sentence and a link" is wrong. engine.md:62 says "The options table gives each range." The ranges live only in the cells (expectedObjects :111 "from 1 to 1,048,575, in place of 1,023"; maxLabels :112 "from 1 to 65,536"; maxLabels3d :113 "from 0 to 65,536"). The cells also hold facts a reader needs and the linked pages do not repeat in this form: which page-address switch wins over each option (:92, :93, :94, :101, :102, :104, :106, :109, :119, :122, :123), that the single-threaded build ignores latency (:106) and sketchThread (:109), that shadow options and momentTransparency are fixed while the engine runs (:98, :102), and the E1426/E1421 failures of input (:120) and preload (:121). One sentence per cell drops these.
- The proposed groups leave about half the options without a home: maxPixelRatio, antialias, hdr, depthPrepass, momentTransparency, still, keepTextureCopies, powerPreference, latency, largeWorld, sketchThread, memory and expectedObjects. "Quality" and "Threads and memory" are named but not filled.
- A `<details>` block cannot sit in a GFM table cell with a Markdown body, so dense detail has to go below each sub-table, not inside cells.
- No check in tools/ reads the shape of this table (grep for the table header and "options table" in tools/ and tests/ finds nothing), so a split breaks no generator. The "#options" anchor stays when H3 headings go under "## Options".

## Corrected claim

The 32-row options table mixes unrelated groups, several cells run to 55-70 words, and the E1213 sentence repeats seven times although the errors table at line 62 already covers it. Splitting and trimming is right. Cutting every cell to one sentence is not: it drops the ranges that line 62 sends the reader to, the page-address switch overrides, and the single-threaded build notes.

## Corrected edit

Under "## Options", split the table into H3 sections that place every option:

- "Quality": preset, presetCheck, targetFps, maxPixelRatio, antialias, hdr, the shadow options, cloudSteps, the quality settings row, depthPrepass, momentTransparency, still.
- "Threads, memory and the GPU": sketchThread, latency, powerPreference, memory, expectedObjects, keepTextureCopies, largeWorld.
- "The page": transparent, input, stats, maxLabels, maxLabels3d, preload.
- "Start and messages": onProgress, onSketchMessage, onSketchError, onWorkerRetry, signal.
- "Tests": gpu, hold.

In each table, add a "Range" column for options with one (targetFps, cloudSteps, expectedObjects, maxLabels, maxLabels3d), and a "Page switch" column (or a one-line list below the table) for the `?preset=`, `?target-fps=`, `?hdr=off`, `?prepass=`, `?moments=`, `?latency=`, `?sketch-thread=`, `?gpu=`, `?hold=`, `?still-camera=off` and `?stats` overrides. Delete the seven "Another value fails with E1213" sentences and state once, under the quality table: "A value outside its range fails the start with E1213." Keep each cell to its first sentence and link, and move the remaining detail of the longest cells (hdr's tone-mapping note, cloudSteps' WebGL2 and compatibility-mode note, keepTextureCopies' memory cost and back-forward cache note) into one collapsible block under the table it belongs to:

<details>
<summary>Technical details: how some quality options behave</summary>

(the moved sentences, as a short list, one item per option)

</details>

The main text stays complete with the block closed, since each row keeps its effect and link.
