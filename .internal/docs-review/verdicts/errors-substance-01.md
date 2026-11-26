# errors-substance-01

## Finding as given

- page: errors/E1416, errors/E1218, errors/E1410, errors/E1422, errors/E1209 (template: all 80 error pages)
- anchor: ## What happened
- category: technical-details-block
- severity: high
- claim: This affects all 80 pages. ErrorEntry.cause is documented as one or two sentences, but many causes run to 6-13 sentences. They mix the main fact with limits and edge cases. The template has no place to fold that detail away, so it all lands in What happened. The same long text then fills the summary, the index and the pages list.
- evidence: codes.ts:13-14 says 'in one or two sentences'. tools/lib/docs.ts:436-459 prints cause and fix as plain paragraphs. Stats: E1416 line 6 has 194 words and 13 sentences, and line 10 has 91 words. E1218 has 95 and 91 words. E1410 has 77 words. Outside the slice, E1217, E1223, E1109 and E1110 are longer.
- proposedEdit: Add an optional docs-only `details` field (and `fixDetails`) to ErrorEntry in codes.ts. Runtime code never imports that file, so the engine does not grow. Keep `cause` to at most two sentences, and add a generator test that fails on a longer one. In errorPage, print details after the cause as `<details>` with summary "Technical details: limits and edge cases". Keep the runtime fix in fixes.ts short.
- generatedSource: packages/engine/src/errors/codes.ts; tools/lib/docs.ts

Verdict: partly

## Evidence

Holds:
- packages/engine/src/errors/codes.ts:13 documents `cause` as "What went wrong, in one or two sentences."
- tools/lib/docs.ts:436-459 (errorPage) prints `entry.cause` as the front matter summary and as the only body of "What happened", and `entry.fix` as the only body of "How to fix it". There is no place for folded detail.
- tools/lib/docs.ts:463-467 (errorIndexPage) puts the full cause in each index row. docs/pages.md:211 shows the full 194-word E1416 cause in the pages list.
- docs/errors/E1416.md "What happened" is one paragraph of 13 sentences: the main fact, then a list of size limits (64 MiB, 32 bytes per byte, 1 GiB, 256 MiB, 4,194,304 keys, 4,096 px). That is dense implementer detail, a good fit for a collapsed block.
- codes.ts header (lines 1-4) and fixes.ts header confirm runtime code imports only fixes.ts. A docs-only `details` / `fixDetails` field in codes.ts adds nothing to the engine bundle. fixes.ts text ends every EngineError message and downloads with the page, so a short runtime fix plus a docs-only fixDetails is right (E1109's fix in fixes.ts is a 161-word paragraph that ships at runtime).
- No docs check rejects HTML in pages, so a `<details>` block breaks no rule.

Does not hold, or overstated:
- E1422 and E1209 have no long paragraph in stats.json (177 and 157 words, empty long-paragraph list). E1209's cause is 3 sentences / 65 words; E1422's is 4 sentences / 78 words. In E1422 the extra sentences (worker-src must allow blob:, Firefox checks imports against worker-src) are what the reader needs; they belong in the main text or in the fix, not a folded block.
- "Affects all 80 pages" holds only for the template. A count of the generated pages gives 53 of 80 causes over two sentences, but most are 3 sentences under 60 words (E1106: 44 words, E1222: 38 words). Only about 16 causes are near or over 90 words: E1109, E1110, E1206, E1215, E1217, E1218, E1220, E1221, E1225, E1307, E1402, E1406, E1412, E1416, E1424, E1434, E1501, E1505.
- A test that fails on any cause over two sentences would force a split of 53 entries, many of them short and clear. A collapsed block for one extra sentence costs the reader a click and gains nothing. A word cap on the cause (it is also the summary and the index cell) catches the real problem better than a sentence count, and a naive sentence counter trips on call names with dots.
- Severity: long error pages make reading harder but mislead no one, and the fix text still leads the reader to a solution. Medium fits better than high.

## Corrected claim

The error page template (tools/lib/docs.ts errorPage) has no place for folded detail, and `cause` is used three times: as the page summary, as "What happened", and as the row text in errors/index.md and pages.md. About 16 of the 80 causes run past about 90 words (E1416: 194 words, 13 sentences; E1217: 254; E1109: 216; E1412: 165), packing size limits and edge cases into one paragraph. The fix text of several codes is just as long (E1217: 320 words; E1109: 161 words) and that text also ships in every runtime error message. E1209 and E1422 are not long and need no block. Severity medium.

## Corrected edit

- codes.ts: add optional docs-only `details` and `fixDetails` fields to ErrorEntry. Keep `cause` as the plain fact, short enough to serve as summary and index cell.
- docs.ts errorPage: after the cause, when `details` is set, print `<details>\n<summary>Technical details: limits and edge cases</summary>\n\n${entry.details}\n\n</details>`; after the fix, likewise for `fixDetails`. No headings inside.
- Add a generator test with a word cap on `cause` (for example about 60 words), not a two-sentence cap. Update the codes.ts comment to match.
- Move the limit lists and edge cases of the long entries (E1109, E1110, E1206, E1215, E1217, E1218, E1220, E1221, E1307, E1406, E1412, E1416, E1424, E1434, E1501, E1505) into `details` / `fixDetails`. Shorten the matching fixes.ts text so the runtime message keeps only the first step.
- Leave short causes such as E1209 and E1422 as they are.
