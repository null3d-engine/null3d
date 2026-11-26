# start-substance-05

## Finding as given

- page: getting-started/first-scene
- anchor: ## The page module (lines 48-62)
- category: missing-content
- severity: medium
- claim: Line 62 says to catch the EngineError and show the page without the scene. The example uses a bare top-level await. On Safari before 18, or with no SIMD or no GPU path, the module fails with an uncaught error and the canvas stays blank. This is the page module a newcomer copies.
- evidence: first-scene.md:53-57 and :62; packages/engine/src/errors/codes.ts:262-302 (E1301, E1303, E1306).
- proposedEdit: Show the catch in the code: import EngineError, then use `try { const engine = await createEngine({...}); await engine.firstFrame; } catch (error) { if (!(error instanceof EngineError)) throw error; canvas.replaceWith(Object.assign(document.createElement('p'), { textContent: 'This browser cannot show the 3D scene.' })); }`.

Verdict: survives

## Evidence

- docs/getting-started/first-scene.md:48-58: the page module awaits `createEngine` and `engine.firstFrame` at the top level, with no try/catch and no `EngineError` import.
- first-scene.md:62 tells the reader to catch the error and show the page without the scene, but gives no code and no link to a page that shows how.
- packages/engine/src/page/engine.ts:2021 calls `checkBrowser()` inside `createEngine`; packages/engine/src/page/browser-check.ts:22-31 throws E1303 (no SIMD) and E1306 (WebKit before Safari 18); engine.ts:2635 throws E1301. So `createEngine` rejects as the finding says, and with the bare top-level await the module ends with an uncaught rejection and an empty canvas.
- engine.ts:2123-2130: `firstFrame` also settles with a failure when the frames stop, so the proposed edit is right to put `await engine.firstFrame` inside the try.
- packages/engine/src/index.ts:14 exports `EngineError`, so the import in the edit is valid.
- The pattern already exists in docs/guides/debugging.md:50-66 (section "Where problems appear"), but first-scene.md does not link to that guide anywhere (its "Next steps" list at lines 124-129 omits it). The issue is not handled on the page or on a linked page.
- The edit breaks no writing rule and no website contract rule. It adds about six lines to the first example, which is a fair cost for code that newcomers copy.

## Refined edit

Keep the proposed try/catch, with a plainer fallback and a link to the full pattern:

```ts
// page.ts
import { createEngine, EngineError } from '@null3d/engine';

const canvas = document.querySelector('canvas')!;
try {
  const engine = await createEngine({
    canvas,
    sketch: new URL('./sketch.ts', import.meta.url),
  });
  await engine.firstFrame; // the first frame is on the screen
} catch (error) {
  if (!(error instanceof EngineError)) throw error;
  const note = document.createElement('p');
  note.textContent = 'This browser cannot show the 3D scene.';
  canvas.replaceWith(note);
}
```

Then change line 62 to end: "The `catch` above shows the page without the scene. [Debugging](../guides/debugging.md#where-problems-appear) lists every error the start can give, and `engine.onFailure` for failures after the start."
