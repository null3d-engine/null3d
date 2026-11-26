# Shot and demo-link verdicts: errors/E1410 (sketch module not loaded)

## Shots

### network-sketch-404: reject

The source type is allowed: only the browser's developer tools show this view, so "manual" fits. The picture still fails on two counts.

1. It shows the wrong thing. The import code in `packages/engine/src/sketch/define-sketch.ts` (`loadSketch` and `importAgain`) makes up to three imports of a module that did not download over http or https, not two:
   - the first import;
   - a second import at the same address after a short wait;
   - when that fails with a new error, a third import at the address with the query `null3d-retry=1`.

   Each later import writes its own console warning. A failed download therefore gives two warnings ("...so the engine imports it once more" and "the second import failed too, so the engine imports ...?null3d-retry=1"), not the one "second import" warning that the shot describes. In Chrome the second import fails from the browser's cache with no request, so the Network panel shows two 404 rows: the sketch file and the same file with the retry query. Firefox and Safari show three rows. A picture of one 404 and one warning would teach the reader to expect something that the engine does not do.

2. It does not help the reader of this page. A reader who has E1410 already has the full message in their own console. The message quotes the browser's reason, and the reason is how the reader tells "did not download" from "the code threw". A generic 404 row in the Network panel adds nothing that the message does not already say. Developer tools also look different in each browser and each version, and nobody can make the picture again from a script, so it soon goes out of date.

If the team keeps a picture anyway, take it in Chrome with the Console drawer open under the Network panel. Show the two 404 rows (the sketch file, and the same file with `?null3d-retry=1`), the two `null3D:` warnings and the E1410 error. Change the alt text to match: "The Network panel with two failed downloads of the sketch module, and the console's two retry warnings and the E1410 error." The browser error test page (`tests/pages/errors.ts`, served as `errors.html`) is not a good setup for this picture. It makes four failed starts in a row, so its console is crowded.

Side note for the page text (not a shot issue): "the console notes that second import" leaves out the third import with the retry query and its second warning. The source is the E1410 cause in `packages/engine/src/errors/codes.ts`.

## Demo links

None proposed.

## Concepts said to have no demo

- **Passing the sketch as `new URL(..., import.meta.url)`: confirmed, no demo.** Each demo folder holds only its `sketch.ts`. No folder under `examples/` calls `createEngine`. Only the shared runners (`examples/lib/run.ts`, `examples/lib/compare.ts`) and the demo list (`examples/demos.ts`) use the pattern, and none of them is a demo code that a link can point to.
- **A sketch that reads `document` while it loads: confirmed, no demo.** No demo fails on purpose this way. Also, the E1410 page as generated does not mention `document` anywhere, so this concept does not apply to the current page text.
