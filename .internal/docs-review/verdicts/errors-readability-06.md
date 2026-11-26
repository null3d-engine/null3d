# errors-readability-06

## Finding as given

- page: errors/E1416
- anchor: page line 13 'assets.loadGltf() downloaded a file...'; page line 17 'Check that the file is a glTF 2.0 model...'
- category: long-paragraph
- severity: high
- claim: The cause is 194 words in 13 sentences and mixes broken-file faults with size limits. The fix is 91 words in 5 sentences. The fix sentence 'A file that passes a limit on what it decodes to is broken' uses 'passes' to mean 'goes over', which a reader can take the wrong way.
- evidence: stats.json E1416: line 6 (194 words, 13 sentences), line 10 (91 words, 5 sentences). codes.ts line 428; fixes.ts line 116.
- proposedEdit: Cause: 'assets.loadGltf() downloaded a file that is not a glTF 2.0 model it can read. The message names the broken part.' Three cases: the file is broken (list), the file is past a limit of the engine, rewriteUrl refused an address. Details block 'Technical details: the limits on one glTF file' as a table Limit | Value (decoded total, one array, skeleton nodes, keys per clip, image sides, decoded images). fixCases: broken file (Khronos glTF Validator, export again); skeleton too large (one character per file); over a size limit (split it or simplify its meshes).
- generatedSource: packages/engine/src/errors/codes.ts (E1416); packages/engine/src/errors/fixes.ts (E1416)

Verdict: partly

## Evidence

- The diagnosis holds. docs/errors/E1416.md line 13 is one paragraph that lists about ten faults. It mixes broken data (JSON, offsets, missing buffers, node loops, Draco) with engine limits (1,024 nodes, 64 MiB plus 32 bytes per byte up to 1 GiB, 256 MiB per array, 4,194,304 keys, 4,096 image sides, 1 GiB of images) and the rewriteUrl refusal. stats.json gives 194 words in 13 sentences.
- The source contract agrees with the finding. packages/engine/src/errors/codes.ts lines 10-14 describe `cause` as "What went wrong, in one or two sentences." E1416 has 13.
- "passes a limit" in fixes.ts line 116 is ambiguous. "Goes over" or "is past" is clearer.
- The same 194-word cause text is also the page's frontmatter summary (page line 6) and a cell of the error index table (docs/errors/index.md line 69). tools/lib/docs.ts `errorPage` line 442 and `errorIndexPage` line 466 both use `entry.cause`. A short cause fixes all three places.

## What is wrong with the proposed edit

- A details block cannot go into the `cause` string. tools/lib/docs.ts puts `cause` into the YAML summary and into a table cell with `tableCell()`. A `<details>` block or a Markdown table there would break both. The block needs a new optional field on `ErrorEntry` (for example `details`) in codes.ts. `errorPage` in tools/lib/docs.ts must print it after the "What happened" paragraph. So the finding must also name tools/lib/docs.ts as a source to edit, not only codes.ts and fixes.ts.
- "fixCases" does not exist. The fix is one plain string in `ERROR_FIXES` (fixes.ts). The header of fixes.ts says this text ends every EngineError message at run time. So the fix must stay short prose that reads well in a console message. It cannot be a Markdown list or a structure of cases. The three cases can be three short sentences in that string.
- The text "Three cases ... (list)" in the cause has the same problem. The cause must stay plain prose with no list, because it is also the summary and a table cell.

## Corrected claim

The E1416 cause is 194 words in 13 sentences. That breaks the one or two sentences that ErrorEntry allows for a cause. The same text also fills the page summary and the error index row. The fix is 91 words, and "passes a limit" is ambiguous. The structure that the edit proposes does not fit the error table. The cause and fix are plain strings, and the fix is also runtime message text.

## Corrected edit

1. codes.ts, E1416 `cause` (two to three sentences of plain prose): "assets.loadGltf() could not read a file as a glTF 2.0 model. The file is broken, it goes past a limit of the engine, or the rewriteUrl option refused an address that it names. The message names the part that failed."
2. Add an optional `details` field to `ErrorEntry` in codes.ts. In tools/lib/docs.ts `errorPage`, print it after the cause as `<details>` with the summary line "Technical details: what the engine checks in one glTF file". Do not use it in the summary or the index table. For E1416, put in it: one short paragraph on broken files (a broken JSON or binary chunk, an offset or count past the data, a missing buffer or image, a node loop, a skin or clip that breaks glTF's rules such as key times that fall back, Draco data that does not decode or decodes to other counts than its accessors give). Then a table Limit | Value: decoded data for one file | 64 MiB plus 32 bytes for each byte of the file and its buffers, up to 1 GiB (meshopt blocks count too); one array | 256 MiB; nodes moved by skins and clips | 1,024; keys in one clip (frames times tracks) | 4,194,304; sides of one PNG or JPEG image | 4,096; decoded images | 1 GiB. No headings inside the block.
3. fixes.ts, E1416 (plain prose, about 60 words): "Check that the file is a glTF 2.0 model: a .glb file, or a .gltf file with its buffers and images beside it. For a broken file, open it in the Khronos glTF Validator and export it again. For a skeleton that is too large, export each character to its own file. For a file over a size limit, split it or simplify its meshes."
