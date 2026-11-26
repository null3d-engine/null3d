# errors-readability-30

Finding as given:

```json
{
 "page": "errors/E1419",
 "anchor": "page line 13",
 "category": "long-paragraph",
 "severity": "low",
 "claim": "The cause (75 words, 5 sentences) mixes two cases with different fixes: another engine still draws on the canvas, or the canvas's drawing thread ended for good.",
 "evidence": "stats.json E1419: line 6 (75, 5). codes.ts line 452; fixes.ts line 122.",
 "proposedEdit": "Write the cause in one sentence, then two cases with matching fixCases: another engine still draws on it (wait for its destroy() promise; in React, in the effect's cleanup); its drawing thread ended (put a new canvas in its place).",
 "generatedSource": "packages/engine/src/errors/codes.ts (E1419); packages/engine/src/errors/fixes.ts (E1419)",
 "id": "errors-readability-30",
 "slice": "errors",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/errors/E1419.md line 13: the cause is one paragraph of 5 sentences and 75 words. It is under the 90-word limit, so only the sentence count flags it.
- packages/engine/src/errors/codes.ts line 13: the error table's own rule says a cause is "What went wrong, in one or two sentences." The E1419 cause (line 452) has five. So the cause is too long by the table's own contract. This part holds.
- tools/lib/docs.ts errorPage(): the cause is also the page's front-matter summary. A long cause makes a long summary, which is one more reason to shorten it. It also means a list or a details block inside the cause would leak into the summary, so the cause must stay plain sentences.
- The "fixCases" part does not hold. ErrorEntry (codes.ts lines 10-18) has only title, cause, fix, example, since. No fixCases field exists, and errorPage() renders the fix as one string. The fix (fixes.ts line 122) is also the tail of the runtime error message (fixes.ts header comment), so splitting it means a schema and renderer change, not a docs edit.
- The fix already covers both cases in order: sentences 1-2 for another engine (wait for destroy(), React cleanup), sentence 3 for the dead canvas (put a new canvas in its place). So the "different fixes are mixed" problem is already handled on the page.
- The finding misses a third case. packages/engine/src/page/engine.ts line 2318 throws E1419 when the canvas's worker drew for an earlier engine and the new engine draws on a different thread. Neither the page nor the proposed two-case split mentions it. That message carries its own fix text ("Start it with the same options as that engine, or on a new canvas element").

## Corrected claim

The E1419 cause has five sentences where the error table allows one or two, and it doubles as the page summary. Shorten it. The fix text already gives a matching fix for each case, so no fix split is needed. A fixCases field does not exist.

## Corrected edit

In packages/engine/src/errors/codes.ts (E1419 cause), write two or three plain sentences, for example:

"createEngine() got a canvas that another engine still draws on, or one that no engine can draw on again. A canvas serves one engine at a time: after an engine's destroy() promise resolves, a new engine can start on it. A canvas stops for good when its drawing thread fails, when it leaves the page, when the page goes away, or when the browser refuses memory for a new engine."

Optionally name the third case in the cause or fix: a canvas whose worker drew for an earlier engine needs the same drawing options, or a new canvas. Leave fixes.ts as it is apart from that, and do not add a fixCases field or a details block (the cause feeds the page summary).
