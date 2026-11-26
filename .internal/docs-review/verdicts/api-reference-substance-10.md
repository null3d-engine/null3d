# Verdict: api-reference-substance-10

## Finding as given

- id: api-reference-substance-10 (slice api-reference, role substance)
- page: api/reference/assets, controls, debug, engine, features, geometry, impostors, input, lights, materials, math, particles, post, render, scene, splats, tasks, water
- anchor: assets 258,328; controls 36,44,125,180; debug 18; engine 47,55,71; features 58; geometry 134,222,362,381,450,491,517; impostors 20,135,318; input 10; lights 26,167; materials 12,20,141; math 26; particles 25,31,126,147; post 213; render 36; scene 108,144,485; splats 48; tasks 12; water 44,360
- category: long-paragraph, severity: medium
- claim: Summary paragraphs run long; worst tasks.md:12 runTask (381 words, 18 sentences), scene.md:485 (191), impostors.md:318 (169), render.md:36 (141), engine.md:71 (140), splats.md:48 (136). Most are several TSDoc paragraphs joined by the generator; the rest put implementation detail (job scheduling, shared memory order, a release build's one traversal) in the main text.
- evidence: Page statistics longParagraphs for each api/reference page. Root cause tools/lib/api-docs.ts:74,120-124.
- proposedEdit: After finding 4's fix, give each summary a first paragraph of at most three sentences and move the rest into one `<details><summary>Technical details: <name></summary>` block under the summary. For runTask keep 'Runs a task in a job worker and resolves with its output' and the input rules; move scheduling, SharedArrayBuffer and fallback-worker text into the block.
- generatedSource: tools/lib/api-docs.ts, plus the TSDoc of each listed symbol

Verdict: partly

## Evidence

What holds:
- Root cause is right. `flat` (tools/lib/api-docs.ts:74) replaces every run of whitespace around a newline with one space, so a blank line between TSDoc paragraphs disappears. `summaryOf` (api-docs.ts:120-124) passes the whole comment through `flat`, and `renderSymbol` (api-docs.ts:494) prints it as one paragraph.
- runTask proves it: packages/engine/src/shared/run-task.ts:20-55 has seven TSDoc paragraphs; docs/api/reference/tasks.md:19 prints them as one 381-word block.
- scene.md (timeOfDay, page line 492) is worse than "long": its fenced code example is flattened into the prose as "```ts const day = ...```", so the example is broken. It also names a repository tool command (`bun run bench:allocation --time-of-day`), which a user of the engine cannot run. Both come from the same flattening and the same TSDoc.
- The worst six counts match stats.json.

What does not hold:
- The anchor list mixes real walls with short summaries that stats.json flags only by the four-sentence rule: controls 36 and 44 (39 words each), assets 258 (44), geometry 222 (47) and 134 (48), particles 147 (57), lights 167 (58), lights 26 (66), scene 144 (67). Their sentences are short and carry core usage, not implementation detail. Example, controls.md createMapControls: "A left drag or one finger pans... The wheel... dolly... A right drag... turn it. Call `controls.update(dt)` once per frame." The gestures and the update call are what a user needs. A blanket "three sentences, then a details block" rule would hide that, or leave a details block of one or two plain sentences. No real cost to a reader exists for these; they are taste.
- The proposed runTask split puts too much in the block. The rejection with `TaskFailure`, and "answers come in no fixed order, await one before you queue the next when order matters", change how a caller writes code. They belong in the main text with the input rules.
- The edit gives no source mechanism. TSDoc has no place that the generator turns into a details block today. A `@remarks` tag would not work as is: 'remarks' is not in DOC_TAGS (api-docs.ts:99), so `misreadTags` would pull the remarks text back into the summary.
- Member summaries render in table cells (`tableCell`, api-docs.ts:498). A details block cannot go there, so the rule must cover only export summaries. All listed anchors are export summaries, so this is a limit on the fix, not an error in the finding.

## Corrected claim

The API reference generator joins all TSDoc paragraphs of an export into one paragraph (tools/lib/api-docs.ts:74, 120-124), and it flattens fenced code too. This makes real walls on about 20 exports, worst tasks.md runTask (381 words), scene.md timeOfDay (191, with a broken code example and a repository-only command), impostors.md merge (169), render.md compute pass options (141), engine.md draw-path reason (140), splats.md (136), plus features 58, debug 18, assets 328, geometry 381/491, water 44/360, particles 25/31/126, materials 12/20, math 26, post 213, scene 108, impostors 20/135, input 10. The summaries under 80 words (controls 36/44/125/180, assets 258, geometry 134/222, lights 26/167, particles 147, scene 144) are flagged only for sentence count and need no change.

## Corrected edit

1. tools/lib/api-docs.ts: keep TSDoc paragraph breaks and fenced code blocks in export summaries (split on blank lines, flatten only inside a paragraph). Keep `flat` for member summaries in table cells.
2. Add a `@remarks` convention: add 'remarks' to DOC_TAGS, keep the text before it as the summary, and render the `@remarks` text under the summary as
   `<details>` / `<summary>Technical details: <export name></summary>` / blank line / body / blank line / `</details>`. Export summaries only; no headings inside.
3. In the TSDoc of the long exports only (over about 90 words), move implementation detail under `@remarks`. For runTask the main text keeps: what it does, call it from the setup function or a callback, the input and output rules, that answers come in no fixed order, and that the promise rejects with `TaskFailure`. The block takes: module import once per worker and WebAssembly compile, the `run` export contract, job worker scheduling between frame chunks, when the promise resolves relative to `onUpdate`, the `SharedArrayBuffer` and `Atomics` notes, and the fallback task worker.
4. timeOfDay (scene): restore the code example as a fenced block and remove the `bun run bench:allocation` sentence from the TSDoc.
5. Leave the short four-to-six-sentence summaries as they are.
