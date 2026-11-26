# errors-substance-20

## Finding as given

```json
{
 "page": "errors/E1431",
 "anchor": "Until the file arrives, area lights give no light.",
 "category": "missing-content",
 "severity": "low",
 "claim": "The engine only logs E1431 to the console, once. It never throws it, never rejects with it, and onFailure never receives it. The page does not say so, so a production page shows dark lights with no signal. The example also has no final period.",
 "evidence": "scene/scene.ts:3634-3658. sketch/runner.ts:1358-1367 and :2283-2284 (report calls console.error once per message). codes.ts:524.",
 "proposedEdit": "Add: 'The engine logs this error to the console once, and the scene draws on with dark area lights.' End the example, and the detail at scene.ts:3655, with a period.",
 "generatedSource": "packages/engine/src/errors/codes.ts; packages/engine/src/scene/scene.ts",
 "id": "errors-substance-20",
 "slice": "errors",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The page (docs/errors/E1431.md) and its source (packages/engine/src/errors/codes.ts:520-527, fixes.ts:139) say what failed and how to fix it. They do not say how the error reaches the app. That gap is real.
- The claim "only logs to the console, with no signal" is wrong. The frame loop takes the failure (sketch/runner.ts:2283-2284) and passes it to `report` (runner.ts:1358-1368). For each distinct message, `report` calls `console.error`, records it on the debug channel (`channel.recordError`), and calls `sketch.reportSketchError`. On the page thread, `reportSketchError` fires `events.sketchError` (page/engine.ts:3081), which runs every `onSketchError` handler (engine.ts:2143-2146, 3290-3292). So `createEngine({ onSketchError })` and `engine.onSketchError(...)` receive E1431 as an `Error` whose message starts with `E1431:`. The sketch-worker path does the same through a `sketch-error` reply (workers/sketch-worker.ts:152, engine.ts:1165).
- In hold mode the error is thrown: `report` throws when holding (runner.ts:1367), and hold mode waits for the tables before its drawn frame (runner.ts:1832, 1981), so the hold stops with E1408 that wraps the E1431 message.
- `onFailure` does not receive it, and `createEngine` does not reject with it. Those parts of the claim hold.
- The "logs once" part is right: `report` dedupes by message, and `takeAreaTablesFailure` clears the failure after one read (scene.ts:3647-3658).
- The missing final period holds: the example ends "HTTP 404" with no period (codes.ts:524), and the message template at scene.ts:3655 has none. Peer examples end with one (E1430 at codes.ts:515; E1302 at engine.ts:2891). This is polish only.
- The proposed sentence "The engine logs this error to the console once" would mislead readers. It hides the handler that an app can use for this error.

## Corrected claim

The page does not say how E1431 reaches the app. The engine does not throw it from a call, `createEngine` does not reject with it, and `engine.onFailure` does not receive it. Each distinct message goes once to `onSketchError` handlers (the `createEngine` option or `engine.onSketchError`) and to the console. The engine keeps drawing, and area lights stay dark. In hold mode, the hold stops with E1408, which carries the E1431 message. The example has no final period.

## Corrected edit

In codes.ts, E1431 cause, after "Until the file arrives, area lights give no light.", add: "The engine keeps drawing, and it reports this error once to engine.onSketchError and the console. engine.onFailure does not receive it." End the example (codes.ts:524) and the message template (scene.ts:3655) with a period.
