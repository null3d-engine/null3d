# errors-substance-14

## Finding as given

- page: errors/E1107, errors/E1404, errors/E1305 (data: also E1110, E1307, E1405, E1502, E1505)
- anchor: "This is an engine bug. Report it"
- category: missing-content
- severity: medium
- claim: Eight fixes tell the reader to report a bug, but no error page says where. The README has the GitHub Issues link, and the debugging guide names engine.report for bug reports. Neither is linked from an error page.
- evidence: fixes.ts:20,26,80,84,92,94,156,162. README.md:222 ('bug reports go to GitHub Issues'). docs/guides/debugging.md:95.
- proposedEdit: In errorPage, when the fix says 'report it', add after the fix: 'Report it on [GitHub Issues](https://github.com/null3d-engine/null3d/issues) with the full message, the browser and engine.report.' The runtime text stays the same.
- generatedSource: tools/lib/docs.ts

Verdict: survives

## Evidence

- packages/engine/src/errors/fixes.ts: the fixes of E1107 (line 20), E1110 (26), E1305 (80), E1307 (84), E1404 (92), E1405 (94), E1502 (156) and E1505 (162) each ask the reader to report the error. That is eight codes, as the finding says.
- tools/lib/docs.ts:436-458 (errorPage) prints only the cause, the fix and the example. It adds no link and no footer.
- docs/errors/E1107.md ends at the example. A grep of docs/errors/ for the GitHub Issues URL or for debugging.md finds nothing. docs/errors/index.md (errorIndexPage) has no report link either.
- README.md:222 has the GitHub Issues link. docs/guides/debugging.md:95 says to add engine.report to a bug report. No error page links to either, so a reader on an error page that says "report it" has no route to where or how.
- The cost is real: E1107 and E1404 say only "This is an engine bug. Report it", so the reader's one action has no target.

## Corrected edit (refinement, the claim stands)

1. Do not detect the case from the fix text with a loose "report it" match. E1405 says "Report the error if it repeats", which that match misses. Either match /\breport (it|the error)\b/i, or better, mark the reportable codes in the error table (for example a `report: true` field in codes.ts) so the page code does not parse prose.
2. Do not repeat a list of what to attach. Each fix already names its own items (the code that created the object, the device, the quality preset), and a second generic list would clash with them. Add one fixed line after the fix instead:
   "Report engine bugs on [GitHub Issues](https://github.com/null3d-engine/null3d/issues). Add the full message and [engine.report](../guides/debugging.md#how-the-engine-runs-on-this-device)."
3. The runtime message text stays the same; only the generated docs page gains the line.
