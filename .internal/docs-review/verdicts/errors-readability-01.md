# errors-readability-01

## Finding as given

- page: errors/* (all 80)
- anchor: ## What happened / ## How to fix it
- category: structure
- severity: high
- claim: The template gives each error one cause string and one fix string, printed as single paragraphs. Errors with many separate causes chain them as 'Or ...' sentences, so a reader cannot scan for their own case. 21 of 80 pages break the 90-word or 4-sentence limit for this reason. Applies to all 80 pages.
- evidence: tools/lib/docs.ts lines 436-460 print ${entry.cause} and ${entry.fix} as one paragraph each. E1416 cause (page line 13): 194 words, 13 sentences. E1218 cause (codes.ts line 202) has four 'Or' sentences. Long pages: E1109, E1110, E1206, E1215, E1216, E1217, E1218, E1220, E1221, E1223, E1307, E1405, E1406, E1410, E1412, E1416, E1419, E1424, E1434, E1501, E1505.
- proposedEdit: Add cases?: string[] and fixCases?: string[] (docs only) to ErrorEntry in codes.ts. errorPage() prints each as a bullet list under its heading, with fixCases written as 'If <case>: <fix>'. Keep cause to one or two sentences, as the type's doc comment already says. Add a test in tools/lib/docs.test.ts: a cause of at most 2 sentences, a fix of at most 4 sentences and 90 words, and no sentence over 25 words.
- generatedSource: packages/engine/src/errors/codes.ts; tools/lib/docs.ts (errorPage)

Verdict: partly

## Evidence

What holds:
- tools/lib/docs.ts lines 436-459 (errorPage) print `entry.cause` under "What happened" and `entry.fix` under "How to fix it", each as one paragraph. Confirmed.
- stats.json lists long paragraphs on exactly the 21 pages the finding names. The count is right.
- The ErrorEntry doc comment (codes.ts line 13) says the cause is "one or two sentences". Many causes break that rule.
- Many long causes are lists of separate cases. A reader cannot scan them for their own case: E1416 (13 sentences, several "Or"), E1218 (codes.ts line 202, "Or" chain), E1217 (254-word cause, 320-word fix), E1220, E1223 (one 207-word sentence of comma-separated cases), E1206, E1221, E1406, E1412, E1434, E1505.
- The finding understates the cost. The same cause string is also the front-matter summary (docs.ts line 443; E1416.md line 6 repeats all 194 words) and the "What happened" cell of the error index table (errorIndexPage, docs.ts lines 465-468). A long cause bloats three places.

What does not hold:
- "For this reason" is wrong for several pages. Their paragraphs are long because they explain how the engine works or give limits and numbers. They do not list separate causes:
  - E1109 cause: memory per instance row, peak memory per draw path, the 8 MiB reserve, the 45-second retry.
  - E1110 cause: when development builds check static objects.
  - E1307 cause: how the driver fails and when the engine reports it.
  - E1410 cause: the second import and why a module that threw is not fetched again.
  - E1424 cause: how the Vite plugin names material-*.js, effect-*.js and curve-*.js files.
  - E1501 cause: culling limits, skinning buffer counts.
  - Long fixes on E1109, E1215, E1216, E1307 and E1405 are lists of steps, not cases.
  Bullets of cases do not fix these. They need a shorter main text plus a collapsible block for the dense detail.
- "Applies to all 80 pages": the 80 pages are 79 error pages and the index (errors/index), which uses a different template. 58 of the 79 error pages are within the limits.
- The proposed edit names the wrong file for the fix. The fix is not in codes.ts. It is ERROR_FIXES in packages/engine/src/errors/fixes.ts. Its header says this text "ends every EngineError message" and the page downloads it and hands it to every worker. codes.ts adds it at line 624. So a length test on the fix limits runtime console text, not only docs text. Moving case steps into a docs-only fixCases in codes.ts takes those steps out of the console message. That can be an acceptable trade, because the message links to the page, but the edit must say so.
- The proposed edit ignores the user's request: correct, dense implementer detail should go into a collapsible block, not be cut or forced into bullets. Under the proposal, figures such as E1109's bytes per row, E1416's decode limits, E1501's buffer counts and E1217's rules for layered-material maps would be cut to fit a 2-sentence cause.

## Corrected claim

errorPage() prints each error's cause and fix as one paragraph each. 21 of the 79 error pages break the 90-word or 4-sentence limit. On about half of them (E1206, E1217, E1218, E1220, E1221, E1223, E1406, E1412, E1416, E1434, E1505), the cause is a chain of separate cases that a reader cannot scan. On the others (E1109, E1110, E1307, E1410, E1424, E1501, and the fixes of E1215, E1216, E1405), dense details on how the engine works, its limits and step lists fill the paragraph. The cause string is also the page summary and the index table cell, so long causes bloat those as well.

## Corrected edit

In packages/engine/src/errors/codes.ts, add three optional docs-only fields to ErrorEntry:
- `cases?: string[]`: one short line per separate cause.
- `fixCases?: string[]`: one line per case, "If <case>: <step>".
- `details?: string`: dense Markdown for implementers (limits, byte counts, how the engine works, file naming).

Keep `cause` to one or two sentences, as its doc comment says. errorPage() in tools/lib/docs.ts prints `cause`, then `cases` as a bullet list, under "What happened". It prints the fix from fixes.ts, then `fixCases` as bullets, under "How to fix it". If `details` is set, it prints this block at the end of "What happened" (no headings inside, no nesting):

<details>
<summary>Technical details: limits and how the engine checks</summary>

{details}

</details>

The front-matter summary and the index table cell then show only the short cause.

Shorten each runtime fix in packages/engine/src/errors/fixes.ts (ERROR_FIXES) to its main step. Move steps for each case into `fixCases`, because the console message ends with this text.

Add a test in tools/lib/docs.test.ts (or errors.test.ts): each cause at most 2 sentences, each ERROR_FIXES entry at most 4 sentences and 90 words, and no sentence in cause, cases or fixCases over 25 words. Do not apply the limits to `details`.
