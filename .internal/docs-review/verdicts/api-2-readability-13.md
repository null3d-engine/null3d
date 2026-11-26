# api-2-readability-13

## Finding as given

- page: api/input
- anchor: ## Input off, lines 206-232
- category: technical-details-block
- severity: medium
- claim: Most readers need three facts: what input: false turns off, that ctx.input stays at rest, and that the pointer lock fails. The section adds every listener it leaves out, a table of the listeners it keeps, and module-load rules for workers. Line 225 is a maintainer test note.
- evidence: lines 210-213 (listeners not added); the table at lines 217-223; line 225 'The input test records the engine's listeners in every thread mode.'; line 232.
- proposedEdit: Keep lines 208, 227, 229 and 234 in the main text. Put lines 210-223 and 230-232 in <details><summary>Technical details: the listeners that stay and the warnings</summary>. Delete the test note in line 225.

Verdict: partly

## Evidence

docs/api/input.md, section "Input off" (lines 206-234):

- The page says what the finding says. Lines 210-213 list the listeners the engine leaves out. Lines 217-223 are a table of the five listeners it keeps. Line 225 ends with "The input test records the engine's listeners in every thread mode." Line 232 explains module loads per thread.
- The listener lists and the table are correct, dense detail for implementers. A block suits them. The test sentence tells a user of the engine nothing they can act on. It describes the repository's tests, so it belongs in a code comment or a guide in .dev/.

Where the proposed edit goes wrong:

1. Line 215 opens with "The canvas's context menu stays the browser's." This is a behavior change that a reader sees. Line 200 of the same page says the engine blocks the context menu so the sketch can use the right button. With input off, that stops. The proposal moves line 215 into the block, so the main text hides a visible change.
2. Line 208 ends with a colon ("The engine then adds no listener that takes input:"). With the bullets in a block, the main text ends on a colon that introduces nothing. The line needs new words.
3. Line 231 says a development build warns in the console when the sketch relies on input, and that each warning names `input: false`. That is what a developer sees when they debug, so it belongs in the main text. Only line 232, about module loads in shared workers, is niche enough for a block. Line 230 (stopping the engine leaves a lock the page took) can go either way.
4. Line 225 has two sentences. The proposal deletes only the test note. Its first sentence (a development build also listens for the dev server's shader updates) belongs with the table of kept listeners, so it goes into the same block.
5. Lines 210-223 and 230-232 are not next to each other: lines 227 and 229 sit between them. One block cannot hold both unless the text is moved. Use two blocks.

## Corrected claim

The section's lists of listeners left out and kept, and the module-load note, are dense detail that most readers can skip, and line 225 ends with a maintainer note about the tests. But the context menu change (line 215) and the development warnings (line 231) are facts a user sees, and they stay in the main text.

## Corrected edit

- Line 208: "`createEngine({ input: false })` is for a page whose input another library records. The engine then adds no listener that takes input, and the canvas's context menu stays the browser's."
- After line 208, one block: `<details><summary>Technical details: the listeners the engine leaves out and keeps</summary>` holding lines 210-213, the rest of line 215 ("The engine keeps the listeners that take no input, and each reads only the page's state."), the table at lines 217-223, and "A development build also listens for the dev server's shader updates." Close the block.
- Delete "The input test records the engine's listeners in every thread mode."
- Keep line 227 (ctx.input at rest), line 229 (pointer lock fails with E1426), line 230 and line 231 (development warnings) in the main text.
- After line 231, a second block: `<details><summary>Technical details: when the controls warning comes</summary>` holding line 232.
- Keep line 234 (link to the deterministic simulation guide).
