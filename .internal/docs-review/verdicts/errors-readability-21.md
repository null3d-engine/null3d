# errors-readability-21

## Finding as given

- page: errors/E1406
- anchor: page line 13
- category: technical-details-block
- severity: medium
- claim: The cause is 139 words in 8 sentences, and most of it is a list of 'the first X loads Y' in prose.
- evidence: stats.json E1406: line 6 (139, 8). codes.ts line 350.
- proposedEdit: Cause in two sentences: the file did not download whole; the server answered with an error, sent another file, or the connection broke off. Details block 'Technical details: files that load on first use', as a table First use | File.
- generatedSource: packages/engine/src/errors/codes.ts (E1406)

Verdict: partly

## Evidence

- docs/errors/E1406.md line 13 is the cause text: 8 sentences, and 6 of them are "the first X loads Y". The same text is the front-matter summary at line 6. stats.json gives 139 words and 8 sentences for it.
- packages/engine/src/errors/codes.ts lines 13-14: the ErrorEntry type says the cause is "What went wrong, in one or two sentences." The E1406 cause (line 350) breaks the type's own rule. The readability problem is real.
- The error message already names the file that failed (packages/engine/src/shared/wasm.ts lines 113 and 126: "<name> did not download from <where>"). So the reader does not need the list to know which file failed. The list is good reference detail, not main text. A collapsed block fits.
- The proposed edit does not work as written. tools/lib/docs.ts errorPage (lines 436-459) puts the cause in three places: the front-matter summary (line 442), the "What happened" section (line 448), and a table cell of the error index (errorIndexPage, line 466). ErrorEntry has no field for extra detail. A details block put inside the cause string would land in the YAML summary and inside a table cell of docs/errors/index.md, and break both. So the source change must add a field, not only edit the cause.

## Corrected claim

The cause holds: it is far past the one or two sentences that ErrorEntry asks for, and most of it is a list of files that load on first use. The fix needs a change in two sources, not only codes.ts.

## Corrected edit

1. packages/engine/src/errors/codes.ts: add an optional field to ErrorEntry, such as `details?: string` ("Dense detail for implementers, shown in a collapsed block on the error's page"). Cut the E1406 cause to two sentences: "A file of the engine core did not download whole, or a file that a call loads the first time it runs. The server answered with an error, sent another file in its place, such as a web page, or the connection broke off." Move the first-use list into `details` as a table First use | File (first KTX2 file | KTX2 transcoder; first glTF file | glTF loader; first mesh that plans its levels of detail | level planner and its simplifier; first glTF file with meshopt compression | meshopt decoder; first glTF file with Draco compression | Draco decoder; first color grading table | its readers; first environment | its reader; first sprite or point batch | sprite code; first line batch | line code; first feature draw, instance draw or full-screen effect | that adapter).
2. tools/lib/docs.ts errorPage: after the cause in "What happened", when the entry has details, write
   `<details>` / `<summary>Technical details: files that load on first use</summary>` (or a generic "Technical details") / blank line / the details / blank line / `</details>`. Keep the summary and the index table cell from the cause only.
