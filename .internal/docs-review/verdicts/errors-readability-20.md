# errors-readability-20

## Finding as given

- page: errors/E1307
- anchor: page lines 13 and 17
- category: long-paragraph
- severity: medium
- claim: The cause (116 words, 7 sentences) mixes what the reader sees with how the engine retries builds. The fix (86 words, 7 sentences) holds three separate fixes, one for each thing the message can name.
- evidence: stats.json E1307: line 6 (116, 7), line 10 (86, 7). codes.ts line 307; fixes.ts line 84.
- proposedEdit: Cause: 'After the start, the GPU driver could not build a pipeline. The objects that draw with it are missing from its pass, and the engine draws on.' Details block: the two build attempts, WebGL2 link failures, first time per device. fixCases: custom material named (check and shorten its WGSL); little memory (lower the preset, smaller textures, fewer objects); engine template named (report it).
- generatedSource: packages/engine/src/errors/codes.ts (E1307); packages/engine/src/errors/fixes.ts (E1307)

Verdict: partly

## Evidence

- docs/errors/E1307.md line 13 (cause) and line 17 (fix) are the two long paragraphs. stats.json gives 116 words / 7 sentences and 86 words / 7 sentences. The problem is real.
- codes.ts line 13 documents the cause field as "What went wrong, in one or two sentences." The E1307 cause (codes.ts line 307) has seven. This supports the finding.
- The cause does mix two kinds of text. "What the reader sees" (objects missing from a pass, the engine draws on, the message names the pipeline) sits beside build mechanics (batch build then a lone retry, WebGL2 link failures, one report per device).
- The proposed mechanism is wrong in three ways:
  1. There is no `fixCases` field. ErrorEntry (codes.ts lines 10-21) has only title, cause, fix, example and since.
  2. The fix text is not page-only. engine-error-core.ts line 19-21 (messageFor) appends the fix to every runtime error message. A list or a details block in fixes.ts would print raw Markdown or HTML into the console. The fix must stay one plain string.
  3. The cause is reused. tools/lib/docs.ts line 442 puts it in the front matter summary, and line 466 puts it in the "What happened" cell of docs/errors/index.md (line 53). A details block inside the cause string would break the YAML summary and the table row.
- The fix is not "three fixes, one per thing the message names". It has four actions: check a named custom material, use less memory, update the browser and system software, report an engine template. The memory and update actions do not depend on what the message names. The proposed edit drops the browser and system software update, which is a valid general fix.
- The proposed cause drops "the message names the pipeline: its template and its pass". The fix still says "Read the message: it names the pipeline", so this loss is acceptable, but the pass name is what tells the reader which part of the frame is missing objects. Keep it short in the main text.

## Corrected claim

The cause and the fix of E1307 are both too long, and the cause breaks its own field contract of one or two sentences. The cause mixes what the reader sees with how the engine retries builds. The fix holds four actions in one paragraph. Because the fix is appended to every runtime message and the cause is reused as the page summary and the error index cell, neither string can hold a details block or a list.

## Corrected edit

- codes.ts, E1307 cause, two or three sentences: "After the start, the GPU's driver could not build one pipeline, such as a custom material's. The objects that draw with it are missing from the pass that the message names, and the engine draws on."
- Add an optional page-only field to ErrorEntry (for example `details`), rendered by errorPage in tools/lib/docs.ts after the cause, inside a `<details><summary>Technical details: how the engine builds the pipeline</summary> ... </details>` block. It is not used in the summary, the index table or the runtime message. E1307's details: the driver refused the pipeline in the batch build and again when the engine built it alone; drivers do this when they run short of memory while compiling or their compiler fails; on WebGL2 a program that fails to link twice counts the same; the engine reports the first failure on each GPU device only.
- fixes.ts, E1307 fix: keep one plain string, but shorten it to about five sentences and keep all four actions: "Read the message: it names the pipeline and quotes the driver. If it names a custom material, shorten that material's WGSL, with fewer texture reads, loops and calls. On a device with little memory, use a lower quality preset, smaller textures and fewer objects. Update the browser and the device's system software. If it names an engine template, report it with the device."
