# guides-1-substance-28

## Finding as given

- page: guides/content-pages
- anchor: "the page reveals the canvas only after both placed and engine.firstFrame" (line 145); deadline code (lines 71-84)
- category: missing-content
- severity: low
- claim: No page code waits for 'placed'. The deadline code uses engine, which the first block declares inside try, so joined blocks fail.
- evidence: docs/guides/content-pages.md:43-49, 79, 145-170.
- proposedEdit: Add a snippet that resolves a promise on the 'placed' message and awaits Promise.all([engine.firstFrame, placed]) before adding 'ready'. Declare let engine before try in the first block, or note that later blocks run inside it.

Verdict: survives

## Evidence

- Line 145 says the page reveals the canvas only after both `placed` and `engine.firstFrame`. The sketch block (lines 148-170) posts `placed` at line 158.
- No page code listens for `placed`. The only page listener on the page (lines 108-110) handles `motion`. The reveal code (lines 78-80) awaits only `engine.firstFrame` and then adds `ready`. A search of docs/, skills/ and examples/ finds `placed` only on lines 145 and 158 of this page.
- The first page block declares `const engine` inside `try` (line 44). The deadline block (line 79), the motion block (line 108), the off-screen block (line 119), the scroll block (line 136) and the crash block (line 225) all use `engine` outside that scope. The deadline block's catch comment ("the onFailure handler above keeps the poster", line 82) tells the reader that it runs after the first block in the same file. So a reader who joins the blocks gets a scope error. The crash block's "// ... createEngine, then:" (line 224) shows the same problem.
- Low severity is right. Each snippet makes its point alone, but the reveal rule at line 145 has no code, and a reader who copies the page code shows the canvas before the camera moves to the restored scroll position.

## Corrected edit (refinement, not a change of verdict)

In the scroll section, after the sketch block, add a short page snippet, for example:

```ts
// page.ts
const placed = new Promise<void>((resolve) =>
  engine.onSketchMessage((type) => { if (type === 'placed') resolve(); }),
);
await Promise.all([engine.firstFrame, placed]);
root.classList.add('ready');
```

Or change the deadline block's reveal so that it awaits both, and say that a page without scroll-driven cameras awaits only `engine.firstFrame`. For the scope issue, declare `let engine: Engine | undefined` before `try` in the first block, or add one sentence after it: "Later page blocks run after a successful start, inside that `try`."
