# api-reference-substance-19

Finding as given:

```json
{
 "page": "api/reference/sketch,api/reference/engine",
 "anchor": "sketch.md:13 `defineSketch`; sketch.md:107 `SketchSetup`; engine.md:174 `sketch`",
 "category": "contradiction",
 "severity": "medium",
 "claim": "Three summaries say the sketch runs 'in the sketch worker'. The engine page's sketchThread option and the single-threaded build run it on the page's main thread.",
 "evidence": "packages/engine/src/sketch/define-sketch.ts:201,265; packages/engine/src/page/engine.ts (sketchThread option).",
 "proposedEdit": "'in the sketch's thread: a worker by default, or the page's main thread with `sketchThread: 'main'`.'",
 "generatedSource": "packages/engine/src/sketch/define-sketch.ts, packages/engine/src/page/engine.ts",
 "id": "api-reference-substance-19",
 "slice": "api-reference",
 "role": "substance"
}
```

Verdict: survives

Evidence:
- docs/api/reference/sketch.md:19 (`defineSketch`): "updates it every frame, in the sketch worker". sketch.md:113 (`SketchSetup`): "The engine calls it once, in the sketch worker". The finding's anchors 13 and 107 are six lines off; the text is as claimed.
- docs/api/reference/engine.md:174 (`EngineOptions.sketch`): "The sketch module, which runs in the sketch worker".
- The same engine page contradicts this: engine.md:200 (`sketchThread`) says `main` runs the sketch on the page's main thread, and "The single-threaded build always runs the sketch on the page's thread". engine.md:531 (`SketchThread`) says the same.
- Code: packages/engine/src/page/engine.ts:1914 sets `main = !threaded || (switches.sketchThread ?? options.sketchThread) === 'main'`. So the `?sketch-thread=main` switch also puts the sketch on the page. engine.ts:1499 and 1646 say "the sketch worker, unless the page runs the sketch".
- Sources: define-sketch.ts:201 and :265, engine.ts:167.
- The same sketch page already uses neutral words elsewhere: sketch.md:32 (`onDestroy`) says "on the sketch's thread". So the fix matches an existing pattern.
- Cost to a reader: someone who sets `sketchThread: 'main'` to reach the DOM reads in three places that their sketch runs in a worker, where it cannot reach the DOM. That is a real contradiction, so medium severity is right.

Corrected edit (adds the single-threaded build and the URL switch, and uses the "on the sketch's thread" words that onDestroy already uses):
- define-sketch.ts:265 (`defineSketch`): "...updates it every frame, on the sketch's thread: a worker by default, or the page's main thread with `sketchThread: 'main'` and in the single-threaded build."
- define-sketch.ts:201 (`SketchSetup`): "The engine calls it once, on the sketch's thread, and it returns..."
- engine.ts:167 (`sketch`): "The sketch module, which runs on the thread that `sketchThread` names; `new URL('./sketch.ts', import.meta.url)`."
Give the full explanation once, in `defineSketch`. The other two summaries point to it or to `sketchThread`, so the same caveat is not repeated three times.
