# start-readability-23

## Finding as given

- page: getting-started/first-scene
- anchor: ## The page module, line 62
- category: example-placement
- severity: low
- claim: The text says createEngine rejects on an unsupported browser and to catch it, but the page module above has no try or catch. A newcomer copies the code and gets an uncaught error.
- evidence: first-scene.md lines 48 to 58 (no catch); line 62 'Catch it, and show the page without the scene.'
- proposedEdit: Wrap createEngine and firstFrame in try/catch in the page module, with a catch that removes the canvas and a comment that the browser cannot run the engine. Or show the catch in a second short block right after line 62.
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/getting-started/first-scene.md:48-58: the page module calls `await createEngine(...)` and `await engine.firstFrame` at the top level, with no try or catch.
- docs/getting-started/first-scene.md:62: the text tells the reader to catch the `EngineError` and show the page without the scene. The code does not do what the text says.
- docs/api/engine.md:14-32 shows the right pattern: one try block around `createEngine` and `engine.firstFrame`, with a catch that shows the page without the scene. first-scene.md does not link to docs/api/engine.md anywhere (its Next steps at lines 124-129 do not list it). A newcomer will not find that pattern from this page.
- docs/api/engine.md:36: `engine.firstFrame` can reject too (E1404, E1420). So the try block must cover both awaits, as the finding proposes.
- packages/cli/templates/empty/src/page.ts has no catch either. It is not a source for this page, but a newcomer who copies either one gets the same result.

One small point on the claim: the failure is an unhandled promise rejection at the top level of a module. The browser logs it in the console and the canvas stays blank. Nothing crashes. That fits the low severity.

## Edit

Use the first option. Make the page module match docs/api/engine.md:

```ts
// page.ts
import { createEngine } from '@null3d/engine';

const canvas = document.querySelector('canvas')!;
try {
  const engine = await createEngine({
    canvas,
    sketch: new URL('./sketch.ts', import.meta.url),
  });
  await engine.firstFrame; // the first frame is on the screen
} catch (error) {
  // The browser cannot run the engine: show the page without the scene.
  canvas.remove();
}
```

Keep line 62 as it is, and add a link to [The engine](../api/engine.md) in Next steps or at the end of line 62, so readers find the failure callbacks there.
