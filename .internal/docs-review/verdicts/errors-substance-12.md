# errors-substance-12

## Finding as given

- page: errors/index,pages (template: all 80 error pages)
- anchor: `| Code | Error | What happened |`
- category: duplication
- severity: medium
- claim: Each cause is printed four times: in the page body, the front-matter summary, the index cell and the pages list. The index has 6,109 words, and some cells run 200-300 words. The 80 codes sit in one flat table, though they fall into five groups.
- evidence: tools/lib/docs.ts:441 (summary: entry.cause) and :464-467 (index rows). docs/pages.md:157 and on. fixes.ts:4-5 gives the groups: 11xx objects, 12xx values, 13xx browsers and GPUs, 14xx setup and loading, 15xx rendering. Stats: errors/index has 6,109 words.
- proposedEdit: Use the cause's first sentence, or a new short `summary` field, for the front matter, the index and the pages list. Split the index table under five ## headings, one per group, each with a one-line intro. Consider linking the index from pages.md instead of listing all 80 codes there.
- generatedSource: tools/lib/docs.ts

Verdict: survives

## Evidence

- tools/lib/docs.ts `errorPage()` sets the front-matter `summary` to `entry.cause` and prints `entry.cause` again under "## What happened". `errorIndexPage()` puts `tableCell(entry.cause)` in the third column of every row. `collectPages()` reads each page's front-matter `summary`, and `pageList()` prints it in the "What it covers" column of docs/pages.md. So the full cause text appears four times, as claimed.
- docs/errors/E1109.md: the front-matter summary is the whole 216-word cause. The same text is the E1109 row in docs/errors/index.md and in docs/pages.md under "## Errors".
- docs/errors/index.md: 79 code rows, 5,376 words of cause text. Median cell 53 words; 32 cells over 60 words; 15 over 100; E1223 207, E1109 216, E1217 254 words. stats.json gives 6,109 words for the page. The "200-300 words" claim holds for three cells.
- packages/engine/src/errors/codes.ts:13 documents `cause` as "What went wrong, in one or two sentences." Many causes break that contract, which is why a short summary (or the first sentence) is the right source for table cells and front matter.
- packages/engine/src/errors/fixes.ts:4-5 names the five groups. Row counts per group in the index: 11xx 12, 12xx 20, 13xx 7, 14xx 34, 15xx 6. One flat 79-row table hides this grouping.
- docs/pages.md "## Errors" lists all 79 codes with their full causes; pages.md is 9,952 words in stats.json, a large part of that from these rows.
- No rule in AGENTS.md or the website contract blocks ## headings on a generated index or a shorter summary field.

## Notes

- "All 80 error pages" counts the 79 code pages plus the index; the index table has 79 codes.
- Fits the new collapsible-block rule: when a cause is cut to one or two sentences, the dense detail (for example E1109's memory figures, E1217's long cause) should move into a `<details>` block under "What happened" on the code's own page, not be deleted. The block lives in the error page template in tools/lib/docs.ts, fed by a new optional `details` field in codes.ts.
- Dropping the 79 rows from pages.md is a special case in `pageList()`; it is optional. Once summaries are short, the rows cost far less.
