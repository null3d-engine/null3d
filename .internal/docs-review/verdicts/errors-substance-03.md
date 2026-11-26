# errors-substance-03

## Finding as given

```json
{
 "page": "errors/E1101,errors/E1203,errors/E1305,errors/E1404,errors/E1431 (template: all 80 error pages)",
 "anchor": "# E....: title (no line on how the error arrives)",
 "category": "missing-content",
 "severity": "high",
 "claim": "This affects all 80 pages. No page says how the error reaches your code: thrown by the call, a rejected promise, engine.onFailure only, or a console log. No page says whether the check runs only in development builds. Readers cannot tell where to catch the error, or why a release build is silent.",
 "evidence": "scene/scene.ts:1146-1149 and errors/checks.ts:41-50 and :63-66 run the E1101 and E1203 checks only under if (DEV). docs/concepts/handles.md:75 says the core logs E1101 for queued changes. docs/api/engine.md:163 says E1305 and E1404 reach onFailure only, and 'no promise rejects for them'. sketch/runner.ts:1358-1367 and :2283-2284 show E1431 is only console.error'd, once. codes.ts:91 shows E1110 alone says 'Release builds leave the check out'.",
 "proposedEdit": "Add `reaches` ('throws' | 'rejects' | 'onFailure' | 'console') and `builds` ('development' | 'every') to ErrorEntry. Print one line under the title, for example 'Shows as: thrown by the call, in development builds. The engine core logs it for queued changes in every build.'",
 "generatedSource": "packages/engine/src/errors/codes.ts; tools/lib/docs.ts",
 "id": "errors-substance-03",
 "slice": "errors",
 "role": "substance"
}
```

Verdict: partly

## Evidence

The core gap is real:
- tools/lib/docs.ts:436-459 (errorPage) renders only "What happened", "How to fix it" and "Example". No line says how the error arrives or which builds check it, and no link goes to the guide that explains this.
- docs/errors/E1101.md, E1203.md, E1305.md and E1431.md say nothing on delivery or builds. E1101 and E1203 are thrown only in development builds: scene/scene.ts:1147-1150 wraps checkLive and checkVector in `if (DEV)`, and errors/checks.ts:41-44 and :62-63 say "Call it inside `if (DEV)`".
- docs/errors/index.md (tools/lib/docs.ts:476) says "Every error the engine throws is an `EngineError`". For codes that reach only engine.onFailure (E1304, E1305, E1307), "throws" points the reader to a try/catch that never catches them. docs/api/engine.md:163 says "no promise rejects for them".

Where the finding overstates:
- "No page says" is false for some pages. docs/errors/E1110.md and E1402.md say which builds check. docs/errors/E1404.md says engine.onFailure receives it after the start and createEngine() rejects with it during the start. E1302.md names onFailure too.
- The delivery channels are documented, just not on the error pages. docs/guides/debugging.md:12-49 has a diagram and a "Where problems appear" table that maps each kind of problem to rejects, console, onFailure, a throw (E1420) or hold mode, by code. The error pages and the error index do not link to it. So the reader is not blocked, but cannot find it from the page they land on.
- The E1431 evidence is wrong. sketch/runner.ts:1358-1367 (report) also calls reportSketchError, and page/engine.ts:3081 sends that to engine.onSketchError. So E1431 reaches onSketchError, not only the console.
- The proposed one-value enum does not fit the code. One code often arrives in more than one way: E1404 rejects createEngine during the start and goes to onFailure after it. E1101 throws in development builds, is logged by the core for queued changes in every build, and throws in every build from instance-batch arrays and world getters (docs/concepts/handles.md:75). The proposed enum also leaves out onSketchError and hold mode. A single `reaches` value would print wrong facts on several pages.
- Severity: medium, not high. The facts exist in the debugging guide. The cost is that a reader on an error page cannot find them.

## Corrected claim

Most of the 80 error pages do not say how the error reaches the page's code (thrown by the call, a rejected createEngine, engine.onFailure, onSketchError or the console) or that some checks run only in development builds. A few pages (E1110, E1402, E1302, E1404) say part of this. The debugging guide's "Where problems appear" table has the general answer, but no error page and not the error index link to it. The error index's "Every error the engine throws" sentence is wrong for the codes that reach only engine.onFailure. Severity: medium.

## Corrected edit

1. In tools/lib/docs.ts errorPage, add one fixed line after "How to fix it" on every page: "[Where problems appear](../guides/debugging.md#where-problems-appear) says where each kind of error reaches your code." In errorIndexPage, change "Every error the engine throws is an `EngineError`" to "Every error the engine reports is an `EngineError`", and add the same link.
2. In packages/engine/src/errors/codes.ts, add an optional free-text `reaches` field to ErrorEntry (not an enum), filled only where a code differs from "the call throws it, in every build". errorPage prints it as one plain sentence under "What happened". Examples: E1101 "Development builds throw it from the call. Release builds leave that check out, but instance-batch arrays and world getters still throw it, and the engine core logs it for a queued change." E1203 "Development builds throw it from the call. Release builds leave the check out." E1305 "engine.onFailure receives it, once per GPU device. No call throws it and no promise rejects." E1431 "engine.onSketchError receives it once, and the console shows it. The engine draws on."
3. Do not add a `builds` enum. Put the build fact in the same sentence, so one field holds one fact per page with no forced values.
