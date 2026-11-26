# Verdict: api-reference-readability-13

## Finding as given

```json
{
 "page": "api/reference/engine",
 "anchor": "lines 54 `createEngine`, 62 `DepthMode`, 78 `DrawPathReason`; cells 212 `preload`, 111 `destroy`, 211 `input`, 97 `onFailure`",
 "category": "long-paragraph",
 "severity": "medium",
 "claim": "Three long paragraphs and 24 cells over 90 words; several mix user guidance with test-tool and memory-management detail.",
 "evidence": "stats.json engine 47 (77 words), 55 (96 words, 7 sentences), 71 (140 words, 10 sentences). preload 287 words, destroy 238, input 202, onFailure 180, captureFrame 166. createEngine mentions window.__null3dHold for test tools and the ?bench switch.",
 "proposedEdit": "createEngine: keep 2 sentences; move hold mode, window.__null3dHold and ?bench into @details. DepthMode: 3-row table (mode, near/far values, where it applies). DrawPathReason: lead sentence plus Value | Meaning table. preload: keep the first sentence; move the trigger list into @details as a Feature | Loads with table. destroy: keep 5 sentences; move memory reuse and Safari delay into @details.",
 "generatedSource": "packages/engine/src/page/engine.ts",
 "id": "api-reference-readability-13",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The counts hold. stats.json lists the three paragraphs (77 words and 5 sentences, 96 words and 7 sentences, 140 words and 10 sentences). The page has them at lines 54, 62 and 78. A count of the description cells gives exactly 24 cells over 90 words: preload 287 (line 212), destroy 238 (111), input 202 (211), onFailure 180 (97), captureFrame 166 (107), and others.
- The createEngine text (line 54) does mix user guidance with test-tool detail (`window.__null3dHold`, `?bench`, `window.__null3dEngine`). The destroy cell (line 111) does mix the core contract with shared-memory reuse and a Safari delay.
- The proposed edit cannot work as written, for three reasons:
  1. The generator puts every summary on one line. `summaryOf` in tools/lib/api-docs.ts:119-123 passes the comment through `flat` (api-docs.ts:74), which turns every newline into a space. A table or a `<details>` block written in TSDoc comes out as one broken line. The proof is on this page: the DrawPathReason source (packages/engine/src/gpu/webgpu/draw-path-probe.ts:52-65) is already a bulleted list, and line 78 shows it as one run-on paragraph with " - " markers.
  2. No `@details` tag exists. Nothing in tools/gen-docs.ts, tools/lib/docs.ts or tools/lib/api-docs.ts handles it. The summary also ends at the first `@` tag (api-docs.ts:104, 119), so a new tag drops its text from the page.
  3. preload, destroy, input and onFailure are cells of a GFM member table (renderSymbol, api-docs.ts:498). A table cell cannot hold a blank line, so it cannot hold the website's `<details>` block (that block needs blank lines around its Markdown body) or a nested "Feature | Loads with" table.
- The named source is incomplete. createEngine, preload, destroy, input and onFailure are in packages/engine/src/page/engine.ts. DepthMode is in packages/engine/src/page/switches.ts:74. DrawPathReason is in packages/engine/src/gpu/webgpu/draw-path-probe.ts:68. The list and block fixes need a change to tools/lib/api-docs.ts, which is a different file from tools/lib/docs.ts.

## Corrected claim

Three summaries (createEngine, DepthMode, DrawPathReason) and 24 member cells are over 90 words. createEngine and destroy mix user guidance with test-tool or memory detail. The DrawPathReason source is already a list. The page shows it as one paragraph because the reference generator flattens every summary onto one line.

## Corrected edit

1. Generator (tools/lib/api-docs.ts): keep line breaks in the summaries of exports that render under a heading (functions, type aliases), so that lists, tables and `<details>` blocks survive. Keep flattening only for table cells. Then DrawPathReason needs no source change, because its list renders. DepthMode (page/switches.ts) can become a short lead sentence plus a Mode | Near and far | Where it applies table.
2. createEngine (page/engine.ts): keep the first two sentences in the main text. Move hold mode, `window.__null3dHold` and `?bench` / `window.__null3dEngine` into a `<details>` block with the summary "Technical details: test and benchmark hooks". This works once step 1 is done.
3. Long member cells (preload, destroy, input, onFailure, captureFrame and the others): a block cannot go inside a table cell. Choose one of these:
   (a) Shorten each cell to its core contract. For preload, that is the first sentence, plus "Throws E1421 for a name it does not know." Have the generator write the rest of the member's comment, for example its TSDoc `@remarks`, below the table in a `<details>` block named after the member.
   (b) Move the dense detail to the written page (docs/api/engine.md) and link to it from the cell. The preload trigger list fits there as a Feature | Loads with table, and so does the memory reuse and Safari delay text from the destroy cell.
