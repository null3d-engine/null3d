# errors-substance-11

## Finding as given

```json
{
 "page": "errors/E1416",
 "anchor": "## What happened (line 6, 194 words)",
 "category": "technical-details-block",
 "severity": "medium",
 "claim": "The cause packs about 12 failure kinds and 6 limits into one 13-sentence paragraph. The figures are correct and useful to implementers, but they bury the main point. 'Key times that fall back' is unclear. The glTF Validator is named but not linked.",
 "evidence": "Limits verified: scene/file-limits.ts:39-55 (256 MiB per array, a 64 MiB floor plus 32 bytes per byte, a 1 GiB cap, a 4,096 texture side). crates/null3d-core/src/animation/skeleton.rs:12 (1,024 joints). resample.rs:28 (4,194,304 keys). Stats: line 6 has 194 words and 13 sentences.",
 "proposedEdit": "Cause: 'assets.loadGltf() downloaded a file that it cannot read as a glTF 2.0 model. The file is broken, or it passes one of the engine's limits. The message names the part.' Move the broken parts and the limits into <details><summary>Technical details: what counts as broken, and the limits</summary> as a list. Write 'key times that go down'. Link https://github.khronos.org/glTF-Validator/.",
 "generatedSource": "packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts",
 "id": "errors-substance-11",
 "slice": "errors",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The problem is real. docs/errors/E1416.md line 10 is the 194-word cause. The same text is the page's front-matter `summary` (line 5). It is also the "What happened" cell of the E1416 row in docs/errors/index.md (line 69). The `ErrorEntry.cause` field comment in packages/engine/src/errors/codes.ts:13 says the cause is "one or two sentences", so this entry breaks its own source contract.
- "Key times that fall back" is unclear. The check in crates/null3d-core/src/animation/resample.rs:229-230 refuses times that decrease, or that are negative or not finite. Equal times are allowed: line 124 says "Two equal times make a jump". So "key times that go down" is correct. "Key times that do not increase" would be wrong.
- The proposed edit cannot be made in `cause` alone. tools/lib/docs.ts:436-458 (`errorPage`) writes `entry.cause` into the front-matter summary and under "What happened". tools/lib/docs.ts:463-467 (`errorIndexPage`) writes it into a table cell through `tableCell`. A `<details>` block needs blank lines. It would break the YAML summary and the index table row. The block needs a new optional field on `ErrorEntry`, for example `details`. `errorPage` renders that field after the cause, and only on the error's own page.
- The short cause drops the rewriteUrl case ("Or the rewriteUrl option refused an address that the file names"). That is not "broken" and not "a limit". It is a refusal by the caller's own option, and a reader needs it in the main text.
- The validator link: the fix text is in packages/engine/src/errors/fixes.ts, and it is runtime text. engine-error.ts:60-66 loads it, and the fixes.ts header comment says it "ends every EngineError message". A Markdown link there shows up as raw `[..](..)` in the console. No fix in that file uses Markdown link syntax. Put the bare URL in the fix text, or put the link in the page-only details block.

## Corrected claim

The 194-word cause hides the main point. The same text is also the page summary and the error index cell, and the cause field's own comment asks for one or two sentences. "Fall back" is unclear: the engine refuses key times that go down, or that are negative or not finite, but it allows equal times. The validator is not linked. The dense limits belong in a collapsible block. That block cannot go in the `cause` string, because that string feeds YAML front matter and a table cell.

## Corrected edit

1. In packages/engine/src/errors/codes.ts, shorten E1416 `cause` to: "assets.loadGltf() downloaded a file that it cannot read as a glTF 2.0 model. The file is broken or passes one of the engine's limits, or the rewriteUrl option refused an address that the file names. The message names the part."
2. Add an optional page-only field to `ErrorEntry`, for example `details`. In tools/lib/docs.ts `errorPage`, render it after the cause as:

   ```
   <details>
   <summary>Technical details: what counts as broken, and the limits</summary>

   - list items...

   </details>
   ```

   Do not use it in the summary or in `errorIndexPage`.
3. Put this list in E1416 `details`:
   - A broken JSON or binary chunk.
   - An offset or count past the data.
   - A missing buffer or image.
   - A node loop.
   - A skin or clip that breaks glTF's rules, such as key times that go down or are negative.
   - Draco data that does not decode, or that decodes to other counts than its accessors give.
   - Skins and clips that move more than 1,024 nodes.
   - A decoded size over 64 MiB plus 32 bytes for each file byte, capped at 1 GiB, with meshopt blocks counted against that total.
   - One array over 256 MiB.
   - A clip over 4,194,304 keys (frames times tracks).
   - PNG or JPEG sides over 4,096, or images that decode to more than 1 GiB.
4. In packages/engine/src/errors/fixes.ts, add the bare URL after the validator's name: "the Khronos glTF Validator (https://github.khronos.org/glTF-Validator/)". Do not use Markdown link syntax, because this text also ends the runtime error message.
