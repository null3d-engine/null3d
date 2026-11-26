# Verdict: errors-readability-19

## The finding as given

```json
{
 "page": "errors/E1216",
 "anchor": "page line 17",
 "category": "wall-of-text",
 "severity": "medium",
 "claim": "The fix is 107 words in 7 sentences, with one of 40 words. It pairs each WGSL type with the value to give, which a table shows at a glance.",
 "evidence": "stats.json E1216: line 10 (107, 7). fixes.ts line 52.",
 "proposedEdit": "Keep two fix sentences (use the field names of struct Uniforms; rename a field with a standard value's name). Add a table WGSL type | Give, with rows for f32, i32/u32, vec2f/vec3f/vec4f, texture_2d<f32> and texture_2d_array<f32>. Put post.setEffectUniform() in fixCases.",
 "generatedSource": "packages/engine/src/errors/fixes.ts (E1216); packages/engine/src/errors/codes.ts",
 "id": "errors-readability-19",
 "slice": "errors",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The problem is real. stats.json gives the fix paragraph as 107 words in 7 sentences. It is page line 17 (stats.json counts it as line 10 of the body). Most of it pairs a WGSL type with the value to give. The last sentence, about texture slots, is about 40 words long. A table is a fair way to show these pairs.
- The proposed edit has the wrong mechanism.
  - The fix text is not used only by the docs. `packages/engine/src/errors/fixes.ts` lines 1-5 say that this text "ends every EngineError message". `engine-error-core.ts:19-22` (`messageFor`) adds it to the message after the detail. A Markdown table in `ERROR_FIXES.E1216` would print pipes and rows in every console error.
  - There is no `fixCases` field. `ErrorEntry` in `codes.ts:10-21` has only title, cause, fix, example and since. The error page template in `tools/lib/docs.ts:444-459` prints only `entry.fix` under "How to fix it". The edit names a place that does not exist.
- The runtime message already gives the reader the type and the value. `resources.ts:3897-3930` and `effects.ts:249-255` throw "got X for the <type> uniform <name>; it takes a number / a whole number / an array of N numbers[, or a color]". So the console fix can drop the type list. Only the docs page needs the table.
- A table row in the proposal is not exact. Effects refuse a negative u32 (`effects.ts:264`), but material uniforms accept one (`resources.ts:3893-3895`). The row "i32/u32 → a whole number" is true for materials but too loose for effects. Write "a whole number (for an effect's u32, 0 or more)", or split the row.
- Moving the `post.setEffectUniform()` sentence out of the console fix would drop a real fix from runtime messages. The effect calls throw E1216 too (`effects.ts:332`, `effects.ts:376`). Keep that sentence in the fix text.

## Corrected claim

The fix paragraph on errors/E1216 (page line 17, 107 words, 7 sentences) is hard to scan. A type-to-value table on the docs page would help. But the fix text in fixes.ts also ends every runtime error message, so the table cannot go there. The `fixCases` field the edit names does not exist.

## Corrected edit

1. Shorten `ERROR_FIXES.E1216` in `packages/engine/src/errors/fixes.ts` to plain sentences that read well in a console: "Use the names of the fields of struct Uniforms and the texture declarations in the WGSL, each with a value of its type. Rename a field that has the name of a standard value, such as color. Give post.setEffectUniform() an effect that post.addEffect() returned." The thrown detail already names the expected value.
2. Add an optional docs-only field to `ErrorEntry` in `codes.ts` (for example `fixDetails`, a Markdown string). Make `errorPage()` in `tools/lib/docs.ts` print it after the fix paragraph, inside a `<details><summary>Technical details: the value each WGSL type takes</summary> ... </details>` block. Then the main text still makes sense with the block closed. The block has no headings and no nested block.
3. Give E1216 a table in that field, with the columns "WGSL type" and "Give":
   - f32: a number
   - i32: a whole number
   - u32: a whole number (0 or more for an effect)
   - vec2f, vec4f: an array of 2 or 4 numbers
   - vec3f: an array of 3 numbers, or a color
   - texture_2d<f32>: a texture of one layer
   - texture_2d_array<f32>: a texture of several layers, from textures.fromData with a depth or a KTX2 file of layers
