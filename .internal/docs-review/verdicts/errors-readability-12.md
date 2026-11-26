# errors-readability-12

## Finding as given

- page: errors/index
- anchor: `| Code | Error | What happened |`
- category: scan-order
- severity: medium
- claim: The index is one flat table of 80 rows. The codes already group by area, but the index does not show the groups, so a reader with no code yet cannot browse by area.
- evidence: The fixes.ts header comment names the groups: 11xx objects and handles, 12xx values, 13xx browsers and GPUs, 14xx setup and loading, 15xx rendering. docs.ts lines 463-481 write one table.
- proposedEdit: Have errorIndexPage() write one H2 per group (Objects and handles, Values, Browsers and GPUs, Setup and loading, Rendering), each with its own table. Keep each cell to the cause's first sentence.
- generatedSource: tools/lib/docs.ts (errorIndexPage)

Verdict: partly

## Evidence

- docs/errors/index.md has one H1 and one table. stats.json gives the heading outline as only "# Error codes" and 6109 words. The core claim holds: there is no grouping.
- The table has 79 rows, not 80: 12 of 11xx, 20 of 12xx, 7 of 13xx, 34 of 14xx, 6 of 15xx.
- tools/lib/docs.ts:463-481 (errorIndexPage) writes all rows into one table. Confirmed.
- packages/engine/src/errors/fixes.ts:1-5 names the five groups. Confirmed.
- The groups do not match every code. Headings taken straight from the number prefix would put some rows under a wrong label:
  - E1108 "Value out of range" is a value error but sits in 11xx (objects and handles).
  - E1109 "Engine memory full" and E1112 "Unsupported cookie texture" sit in 11xx.
  - E1407 "Invalid hold time" and E1409 "Invalid memory maximum" are value errors in 14xx.
  - E1430 "Too many reflection probes", E1431 "Area lights' tables missing" and E1436 "Pick lost with the GPU" are rendering or GPU errors in 14xx.
  - E1425 and E1426 (pointer lock) are input errors in 14xx.
  So "Setup and loading" does not describe about a quarter of the 34 rows in that group.
- The second half of the edit ("keep each cell to the cause's first sentence") is a separate change, and it breaks some rows. For E1112 the first sentence is "A spot light's map copies its picture once, when the texture's texels reach the GPU." That sentence does not say what failed. The long cells (E1109, E1110, E1206) are a real cost, but cutting at the first sentence is the wrong fix.
- Severity: most readers arrive from an error message, which carries the code and links to the code's own page. Browsing with no code is a second use. Medium is high; low fits better.

## Corrected claim

The index is one flat table of 79 rows with no headings. The code numbers group loosely by area, and the page could show those groups so a reader can browse. But several codes sit outside the area their prefix names, so the group headings must be broad enough to hold them.

## Corrected edit

In errorIndexPage() (tools/lib/docs.ts), split the rows by the code's first two digits and write one H2 and one table per group. Use headings that hold every code in the group, for example: "Objects, handles and engine memory" (11xx), "Values passed to calls" (12xx), "Browsers and GPUs" (13xx), "Setup, loading and runtime" (14xx), "Render graph" (15xx). Keep one short line under the H1 that says the code in an error message links straight to its page, so a reader with a code does not need to browse.

Do not cut each cause to its first sentence. If the long cells need shortening, do it as its own change, with a short summary per code in codes.ts, not a mechanical cut.
