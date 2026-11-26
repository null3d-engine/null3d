# errors-readability-02

## Finding as given

- page: errors/* (all 80)
- anchor: ## What happened
- category: technical-details-block
- severity: high
- claim: Dense correct detail (byte budgets, key counts, retry timings, dev-build checks) sits in the same paragraph as the plain cause, and the template has no closed block to hold it. A newcomer must read through it to learn what went wrong. Applies to all 80 pages.
- evidence: E1109 cause (codes.ts line 84) gives 210 and 300 bytes per row, 100 bytes per vertex, peaks of 270 MiB and 205 MiB, an 8 MiB reserve and a 45-second retry in one 216-word paragraph. E1416 (line 428) gives 64 MiB + 32 bytes per byte, 1 GiB, 256 MiB, 4,194,304 keys and 4,096 sides. E1110 (line 91) gives the dev-build check timing.
- proposedEdit: Add details?: { summary, body } to ErrorEntry. errorPage() prints it at the end of 'What happened' as <details><summary>Technical details: ...</summary> ... </details>, with no headings and no nested blocks, so the main text reads in full with the block closed. Fill it for E1109, E1110, E1402, E1406, E1410, E1412, E1414, E1416, E1424, E1434, E1501 and E1217.
- generatedSource: packages/engine/src/errors/codes.ts; tools/lib/docs.ts (errorPage)

Verdict: partly

## Evidence

- The core holds. `ErrorEntry` (packages/engine/src/errors/codes.ts:10-21) has only title, cause, fix, example and since. `errorPage()` (tools/lib/docs.ts:436-458) prints `entry.cause` as one paragraph under "What happened". No page under docs/ uses a details block today. The E1109, E1110 and E1416 numbers the finding quotes are in the source as stated (codes.ts:84, :91, :428).
- The field's own doc comment says the cause is "What went wrong, in one or two sentences" (codes.ts:13). The long causes break the source's own contract, which supports the split.
- `entry.cause` also fills the front matter `summary` (docs.ts:442) and the "What happened" column of the error index (docs.ts:479-484). So E1109's summary and index cell are 216 words too. A separate details field shortens all three. That gain is real, and the edit must keep the block out of the summary and the index.
- "Applies to all 80 pages" is overstated. The template change touches all 80 pages, but stats.json flags a long "What happened" paragraph (page line 6) on only 19 pages: E1109, E1110, E1206, E1215, E1217, E1218, E1220, E1221, E1223, E1307, E1406, E1410, E1412, E1416, E1419, E1424, E1434, E1501 and E1505. Most causes are one or two short sentences, such as E1101.
- The fill list does not match the evidence. It names E1402 and E1414, which stats.json does not flag. E1402 does hold dev-server stamp detail that suits a block, so it can stay; E1414 is borderline. The list leaves out E1218 (the same 4,194,304-key limit as E1416), E1307 (driver and WebGL2 link detail), E1215 (what each kind of WGSL declares) and E1419 (when a drawing thread ends).
- Some of the long causes it leaves out are not "detail" at all. E1206, E1220, E1221, E1223 (207 words in one sentence) and E1505 list the conditions the call refuses. A reader matches the message against that list, so hiding it in a closed block would hide the cause itself. Those causes need a short lead sentence plus a bulleted list, not a block.
- The scope is narrower than the problem. stats.json also flags long "How to fix it" paragraphs (page line 10) on 12 pages, among them E1217 (320 words, 17 sentences), E1109 (161 words), E1223 (150 words) and E1206. The fix text comes from packages/engine/src/errors/fixes.ts. The proposed field covers only the cause.
- Severity: the first sentence of each long cause states the plain cause, such as E1109's "The engine could not create or grow its WebAssembly memory." The page does not mislead and does not block a newcomer. It is clearly harder to read, which is medium under the scale.
- No rule conflict: the user asked for details blocks, and the docs style check strips HTML tags before it counts words (tools/lib/docs-style.ts:191). The skill references that repeat E1109 figures (skills/null3d-develop/references/performance.md:147, recipes.md:358) agree with the source, so moving the figures into a block does not break docs and skills sync.

## Corrected claim

On 19 of the 80 error pages, the "What happened" paragraph mixes the plain cause with dense detail or with a long list of refusal conditions. The same text fills the page summary and the error index cell. Twelve pages also have a long "How to fix it" paragraph. The page template has no closed block for detail. Severity: medium.

## Corrected edit

1. Add an optional `details?: { summary: string; body: string }` to ErrorEntry. In errorPage(), print it after the cause under "What happened" as `<details>` with `<summary>Technical details: ...</summary>`, with a blank line after the summary and before `</details>`, no headings and no nested blocks. Keep `summary` in the front matter and the index cell from the cause only.
2. Move figures and edge cases into the block, and keep the plain cause and the first fix steps in the main text, for E1109, E1110, E1215, E1218, E1307, E1402, E1406, E1410, E1412, E1416, E1419, E1424, E1434, E1501 and E1217. Keep each cause to one or two sentences, as the field's doc comment asks.
3. For E1206, E1220, E1221, E1223 and E1505, do not hide the refusal conditions. Write a one-sentence cause, then a bulleted list of conditions. Let the generator print a list when the cause holds one.
4. Add the same optional block to the fix entries in fixes.ts, and use it for the long fixes on E1217, E1109, E1223 and the other pages that stats.json flags at line 10.
