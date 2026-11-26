# Verdict: errors-readability-17

## Finding as given

- page: errors/E1412
- anchor: page line 13
- category: long-paragraph
- severity: medium
- claim: The 165-word, 10-sentence cause covers five file types (images, KTX2, JSON, color grading tables, environment maps) and then the size limits.
- evidence: stats.json E1412: line 6 (165, 10). codes.ts line 397.
- proposedEdit: Cause: 'A loading call downloaded its file but could not read it. The message says what it could not read, with the line where it has one.' Add one case per file type. Add a details block, 'Technical details: size limits checked before decoding', for the KTX2 and PNG/JPEG limits.
- generatedSource: packages/engine/src/errors/codes.ts (E1412)

Verdict: partly

## Evidence

- The problem is real. docs/errors/E1412.md line 13 is one 165-word, 10-sentence paragraph (stats.json). It lists images, KTX2, JSON, color grading tables and environment maps, and then the KTX2 and PNG/JPEG size limits. The text comes from the cause string at packages/engine/src/errors/codes.ts:397.
- The cause field breaks its own rule. The ErrorEntry interface at codes.ts:13-14 says the cause is "What went wrong, in one or two sentences." This cause has ten.
- The proposed edit cannot go into the cause string alone. tools/lib/docs.ts uses the cause string in three places:
  - docs.ts:442: the front matter `summary` of the page.
  - docs.ts:448: the "What happened" section.
  - docs.ts:466: one cell of the table on docs/errors/index.md. `tableCell` (tools/lib/api-docs.ts:476) escapes only pipes, not line breaks.
  A `<details>` block or a list of cases needs blank lines. Put into the cause string, it breaks the table row on the error index page and puts raw HTML into the page summary.
- The generated source the finding names is therefore incomplete. The edit also needs tools/lib/docs.ts (`errorPage`) and the ErrorEntry interface in codes.ts.

## Corrected claim

The 165-word, 10-sentence cause on E1412 (codes.ts:397) covers five file types and then the size limits. The field's own contract allows one or two sentences. The same text also fills the page summary and the row on the error index page. That makes the long cause harder to read in three places.

## Corrected edit

1. In codes.ts, cut the E1412 cause to two sentences: "A loading call downloaded its file but could not read it. The message says what in the file the engine could not read, with its line where it has one." The index row and the summary then stay short.
2. Add an optional field (for example `details`) to ErrorEntry in codes.ts. In tools/lib/docs.ts `errorPage`, render it under the cause in "What happened". Leave it out of the summary and the index row.
3. In the E1412 `details` field, put the per-type cases as a short list in the main text:
   - an image the browser cannot decode, such as one in a format it does not support;
   - a KTX2 file that the engine does not load;
   - a file that is not valid JSON;
   - a color grading table that the engine does not read, such as a 1D table or one with a texel missing;
   - a file that is not an environment map that `bunx @null3d/cli assets env` writes.
4. After that list, add a collapsible block for the limits:

   <details>
   <summary>Technical details: size limits checked before decoding</summary>

   A KTX2 file fails before it transcodes when it is wider or taller than textures.maxSize, holds more than 256 layers, holds more mip levels than its size has, or holds texels of more than 256 MiB. A PNG or JPEG file fails before it decodes when its header gives a side longer than textures.maxSize, or longer than 16,384 for loadImageBitmap.

   </details>

   The page still makes sense with the block closed, because "How to fix it" already tells the reader to keep KTX2 textures within textures.maxSize.
5. Other long causes in codes.ts (for example E1416 at codes.ts:428) can use the same new field.
