# errors-readability-26

## Finding as given

- page: errors/* (all 80)
- anchor: cause and fix paragraphs
- category: scan-order
- severity: medium
- claim: Calls, options, values and switches print as plain words, so a reader cannot pick out the names on dense pages. Only E1106, E1205, E1216 and E1412 use backticks, so the pages are not consistent. Applies to all 80 pages.
- evidence: codes.ts lines 63, 128, 187, 397 have backticks; no other entry does. fixes.ts has none.
- proposedEdit: Put backticks around code names in codes.ts. Allow backticks in fixes.ts, and have messageFor() in engine-error-core.ts remove them when it builds the runtime message.
- generatedSource: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts; packages/engine/src/errors/engine-error-core.ts

Verdict: partly

## Evidence

- The main point holds. errorPage() in tools/lib/docs.ts (about lines 436-460) prints the cause and the fix as they are, with no formatting. So names print as plain words. Examples: docs/errors/E1101.md "call destroy() on it"; docs/errors/E1206.md "Pass normals or computeNormals: true"; the E1109 fix in fixes.ts names engine.measure(), memory.wasmBytes, engine.mode.memoryMaximumMiB and ?direct=on in one paragraph.
- The hand-written guides use backticks for code names (for example docs/guides/add-ons.md and docs/guides/assets-pipeline.md). So the error pages differ from the rest of the docs, too.
- The count is wrong. Five causes use backticks, not four. E1206 (codes.ts line 135, "`targets` or `morphTargets`") also has them. The other backticks in codes.ts (lines 166, 196, 203) are template-literal delimiters of examples, not code spans.
- fixes.ts has no backticks. Confirmed.
- codes.ts never reaches the runtime (its header comment says the engine code imports fixes.ts only). So backticks in causes need no stripping. Only fix text reaches the runtime message.
- The proposed stripping step has a trap. messageFor() in engine-error-core.ts line 21 checks `detail.endsWith(` ${fix}`)` to avoid adding a fix twice when a message comes from another thread. If messageFor() strips backticks after that check, a worker message that already holds the stripped fix will not match the raw fix, and the fix prints twice. Also, errors.test.ts lines 59, 113 and 132 compare messages with the raw ERROR_FIXES text, so they would need to change.

## Corrected claim

Cause and fix text prints names as plain words on the error pages, while the guides use backticks. Five causes (E1106, E1205, E1206, E1216, E1412) use backticks and no fix does, so the pages are not consistent.

## Corrected edit

Put backticks around code names (calls, options, properties, values, URL switches) in every cause in codes.ts and every fix in fixes.ts. The simplest choice is to keep the backticks in the runtime message too: console messages often use them, and it needs no runtime code. If the runtime message must be plain, strip the backticks from the fix inside messageFor() before the endsWith() check, compare the stripped fix, and update the message tests in errors.test.ts to expect the stripped text.
