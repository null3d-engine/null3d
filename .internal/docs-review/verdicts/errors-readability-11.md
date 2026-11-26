# errors-readability-11

## Finding as given

- page: errors/E1107, errors/E1404, errors/E1305, errors/E1110, errors/E1307, errors/E1405, errors/E1502, errors/E1505
- anchor: 'This is an engine bug. Report it...'
- category: missing-prerequisite
- severity: medium
- claim: Eight fixes tell the reader to report an engine bug but not where or how. E1107's whole fix is that one line.
- evidence: fixes.ts lines 20 (E1107), 92 (E1404), 80 (E1305), 26, 84, 94, 156, 162.
- proposedEdit: When a fix holds 'report', errorPage() adds one fixed line: 'Report it at https://github.com/null3d-engine/null3d/issues with the full message, the browser and the GPU path.' The runtime text stays as it is.
- generatedSource: tools/lib/docs.ts (errorPage)

Verdict: partly

## Evidence

- The claim holds. packages/engine/src/errors/fixes.ts lines 20, 26, 80, 84, 92, 94, 156 and 162 are the fixes of E1107, E1110, E1305, E1307, E1404, E1405, E1502 and E1505. Each says "report it" or "Report the error" and none names a place. The eight generated pages in docs/errors/ show the same text. E1107's "How to fix it" is only that one line.
- No docs page links the issue tracker. A search of docs/ for "/issues" finds nothing. Only README.md:222 links https://github.com/null3d-engine/null3d/issues. docs/guides/debugging.md:95 says "Add engine.report to a bug report" but also gives no place. docs/errors/index.md says nothing about reports.
- The URL is right: packages/engine/package.json "bugs.url" is https://github.com/null3d-engine/null3d/issues.
- errorPage() in tools/lib/docs.ts:436 prints entry.fix as it is, so the docs-only line fits there and the runtime message (messageFor in engine-error-core.ts) stays short.
- The trigger in the proposed edit is wrong. "When a fix holds 'report'" also matches two fixes that are not bug reports: E1209 at fixes.ts:44 ("as many as the device reports") and E1218 at fixes.ts:56 ("which the animator reports itself"). Both are user errors. The line would tell readers of those pages to file an engine bug.
- The fixed text also clashes with some pages. E1107 asks for "the code that created the object"; E1307 asks for "the device"; E1502 and E1505 ask for "the quality preset". A fixed "the full message, the browser and the GPU path" line repeats or contradicts these. It also adds `engine.report`, which debugging.md:95 says belongs in a bug report, nowhere.

## Corrected claim

Eight error fixes (E1107, E1110, E1305, E1307, E1404, E1405, E1502, E1505) tell the reader to report the error but never say where, and no docs page links the issue tracker. The proposed trigger ("fix holds 'report'") is too loose: it also catches E1209 and E1218, which are user errors.

## Corrected edit

In errorPage() (tools/lib/docs.ts), match /\breport (it|the error)\b/i on entry.fix. That pattern matches exactly the eight codes and not E1209 or E1218. When it matches, add one line after the fix:

"Report engine bugs at [GitHub Issues](https://github.com/null3d-engine/null3d/issues). Add the full error message and `engine.report` ([Debugging](../guides/debugging.md))."

Leave out the fixed list of browser and GPU path, because each fix already names what to send. Keep the runtime text in fixes.ts as it is. A plain line is right here; a collapsible block is not needed for one sentence.
