# api-2-substance-18

## Finding as given

- page: api/input
- anchor: ## Input off, the listener table and the lines that follow (lines 215-232)
- category: unclear
- severity: medium
- claim: The table uses internal names that users cannot know: 'The canvas watch counts a page that shows again as a resume', 'Without the device-pixel box', 'stops the job workers, ends the start's crash note'. Line 225, 'The input test records the engine's listeners in every thread mode', describes a maintainers' test.
- evidence: docs/api/input.md:215-232.
- proposedEdit: Keep in the main text what input: false removes, that ctx.input stays at rest, and that requestPointerLock throws E1426. Move the table and lines 230-232 into <details><summary>Technical details: the listeners that stay with input off</summary>, with plain reasons ('so time while the page was hidden does not count as play', 'to stop the engine's workers and free memory when the page closes'). Delete the test sentence.
- generatedSource: (none; hand-written page)

## Verdict: survives

## Evidence

- docs/api/input.md:219 says "The canvas watch counts a page that shows again as a resume". "Canvas watch" is the name of an internal module, packages/engine/src/page/canvas-watch.ts. No user page defines it.
- docs/api/input.md:220 says "Without the device-pixel box". This is the browser's devicePixelContentBoxSize, read at packages/engine/src/page/canvas-watch.ts:121. The page does not name or explain it.
- docs/api/input.md:221 says "stops the job workers, ends the start's crash note". Neither "job workers" nor "crash note" is defined on any user page.
- docs/api/input.md:225 says "The input test records the engine's listeners in every thread mode." That is a maintainers' test, not something a user can use. AGENTS.md keeps internal process out of docs/.
- The table is correct and useful for a reader who audits listeners in a replayed simulation. So a closed block is right; cutting it would lose detail.
- Lines 227 and 229 hold the user-facing facts (ctx.input at rest, E1426) and the proposal keeps them in the main text. Lines 230 and 232 are dense edge cases that suit the block.

## Refinements to the edit

1. Line 215 ends in "The engine keeps the listeners that take no input, and each reads only the page's state:". With the block closed, that colon points at nothing. Rewrite it as a full sentence, for example: "The engine still keeps a few listeners that take no input. They only read the page's state, such as whether it is hidden." Then open the block.
2. Keep line 231 (the development build warns in the console, once for each kind, and names input: false) in the main text. A reader who sees that warning needs to find its cause without opening a block. Move only lines 230 and 232.
3. Put the first sentence of line 225 (the dev server's shader updates listener) inside the block with the table. Delete the second sentence (the test).
4. Cross-page: the same internal name "the canvas watch's visibilitychange" appears on the generated page docs/api/reference/engine.md:211. Its source is the TSDoc of the input option in packages/engine/src/page/engine.ts:447. Replace it there with a plain phrase, such as "a visibilitychange listener that keeps hidden time out of the sketch's next step".
