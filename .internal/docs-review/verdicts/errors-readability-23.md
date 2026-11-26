# errors-readability-23

## Finding as given

- page: errors/E1434
- anchor: page lines 13 and 17
- category: long-paragraph
- severity: medium
- claim: The cause is 143 words in 8 sentences and lists file, probe-grid and light-map faults together. The fix gives 'docs/guides/baked-light-data.md' as a raw path, which is not a link.
- evidence: stats.json E1434: line 6 (143, 8). codes.ts line 546; fixes.ts line 146.
- proposedEdit: Write the cause in two sentences, then cases in three groups (the whole file, a probe grid, a light map). Move the size rules for each field into a details block. Add guides/baked-light-data to related, and write 'the baked light data guide' in place of the raw path.
- generatedSource: packages/engine/src/errors/codes.ts (E1434); packages/engine/src/errors/fixes.ts (E1434)

Verdict: partly

## Evidence

- The problem is real. docs/errors/E1434.md line 13 is the 143-word, 8-sentence cause (stats.json counts it at frontmatter line 6, because the cause is also the summary). Line 17 has the bare text docs/guides/baked-light-data.md, which is not a link.
- The proposed edit does not work with the generator:
  - tools/lib/docs.ts errorPage() (about line 436) uses entry.cause three times: as the `summary` front matter, as the "What happened" body, and (errorIndexPage) as a cell in the docs/errors/index.md table. tableCell() (tools/lib/api-docs.ts:476) only escapes pipes and keeps newlines. A list or a details block in the cause would break the index table row and put HTML into the front matter summary. The ErrorEntry comment (codes.ts:13) also says the cause is "one or two sentences".
  - Error pages have no related list. ErrorEntry (codes.ts:10-21) has only title, cause, fix, example and since. errorPage() writes no related front matter. "Add guides/baked-light-data to related" needs a generator change.
  - The fix text is also the runtime error message. messageFor() in engine-error-core.ts adds the fix to the console message. A Markdown link would show as raw brackets in the console. The words "the baked light data guide" with no address would give a console reader nothing to follow.
- A details block is not needed for the size rules. docs/guides/baked-light-data.md lines 60-62 already give them in a table: 12 floats per probe for coefficients, one float from 0 to 1 per probe for validity and skyVisibility. Line 137 of that guide links back to E1434. The rules can be cut from the cause and left to the guide.

## Corrected claim

The cause paragraph is too long, and the guide path in the fix is not a link. But the cause cannot hold a list or a details block, because it is also the page summary and a cell in the error index table. Error pages have no related list. The fix text is also printed in the console.

## Corrected edit

1. In packages/engine/src/errors/codes.ts (E1434), cut the cause to two or three sentences. For example: "assets.loadLightProbeGrid() or assets.loadLightMap() downloaded a file that this engine cannot read as baked light data. The file may not be JSON, may have the wrong format marker, version or kind, or may have a field whose size does not match the counts or size that the file gives. The message names the fault." The per-field size rules are already in the guide's field tables, so cut them from the cause instead of moving them into a block.
2. In packages/engine/src/errors/fixes.ts (E1434), put the full guide address in place of the bare path: https://github.com/null3d-engine/null3d/blob/generated/docs/guides/baked-light-data.md (the same base as the docs address in engine-error-core.ts). GitHub Markdown turns a bare URL into a link, and the console message stays readable.
3. Optional, for all error pages: if the per-case detail must stay on the error page, add an optional `details` field to ErrorEntry and have errorPage() in tools/lib/docs.ts write it in a details block after "What happened". Keep it out of the summary and the index table.
