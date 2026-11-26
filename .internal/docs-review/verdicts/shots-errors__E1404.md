# Verdicts: errors/E1404 (engine thread failed)

Source to edit: packages/engine/src/errors/codes.ts (E1404 entry) and fixes.ts (E1404 fix), rendered by tools/lib/docs.ts.

## Shots

None proposed. None needed: the failure has no picture. The engine stops drawing, and a canvas that stops changing shows nothing a reader can learn from.

## Demo links

None proposed. None to check.

## Concepts without a demo

- "an engine thread that fails": CONFIRMED, no demo. No demo or comparison listens to the engine's failure callback (a search of examples/ finds no use of it) or forces a thread to fail. The shared demo runner (examples/lib/run.ts) shows the error text on the loading screen when the start fails, but that is page plumbing for every demo, not a demo of this error.
- "restarting the engine after onFailure": CONFIRMED, no demo. Demos destroy the engine only when the page closes or the start fails. None creates a second engine after a failure.
