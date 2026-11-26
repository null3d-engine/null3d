# porting-shaders-readability-30

## The finding as given

```json
{
 "page": "porting/threejs-loop-and-threads, porting/threejs-overview",
 "anchor": "loop-and-threads ## A sketch on the main thread (line 216); overview ### A large app in two steps (line 117)",
 "category": "duplication",
 "severity": "low",
 "claim": "Both pages explain sketchThread: 'main', the two-step port, that render and job workers keep running, and that layout work can delay frames, in nearly the same words.",
 "evidence": "threejs-loop-and-threads.md line 218; threejs-overview.md lines 119-124.",
 "proposedEdit": "Keep the full text on the overview page. On the loop page, keep one sentence with a link to threejs-overview.md#a-large-app-in-two-steps, and keep the paragraph about pages without cross-origin isolation.",
 "generatedSource": "",
 "id": "porting-shaders-readability-30",
 "slice": "porting-shaders",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The duplication is real. On the loop page, line 218 says that the option runs the sketch on the main thread where it can reach the DOM, that a large app can port in this mode first and then move its DOM code, that the render and job workers keep running, and that layout work can delay frames. On the overview page, lines 119 to 124 say the same four things. Line 124 ("The render and job workers still run in the first step. But the sketch shares the main thread with the page, so layout work can delay frames.") repeats the loop page almost word for word.
- The facts are correct. The option exists as a page-side engine option (packages/engine/src/page/engine.ts:359), and the engine runs the sketch itself when the option is set to main (engine.ts:4 and engine.ts:1839). Neither page is generated, so no generated source applies.
- The direction of the proposed edit is wrong. The loop page, titled "The render loop, threads and the DOM", is the page about threads, and the overview links to it for that topic (overview line 64 and Related pages line 220). If the loop page keeps only one sentence and a link, the threads page loses the cost of this mode for threads: the workers keep running, and the main thread is shared, so layout work and page scripts can delay frames. Readers would then go to the overview page to learn about threads, which is backwards. The loop page's version is also the more complete one, because it names page scripts as well as layout work.
- The overview's part that only it has is the step-by-step plan: reach parity on the main thread, then move the DOM code and remove the option. That plan belongs on the workflow page.
- The cost to a reader is small. It is one short paragraph on each page, so low severity is right.

## Corrected claim

Both pages repeat the same facts about running the sketch on the main thread: the workers keep running and layout work can delay frames. The two-step plan belongs on the overview page. The thread facts belong on the loop and threads page.

## Corrected edit

- Overview, "A large app in two steps": keep the intro sentence and the two numbered steps. Replace line 124 with one sentence and a link, for example: "The first step costs frame time, as [A sketch on the main thread](threejs-loop-and-threads.md#a-sketch-on-the-main-thread) explains. Treat it as a stage of the port."
- Loop and threads page, "A sketch on the main thread": keep the paragraph about the threads (the sketch can reach the DOM, the render and job workers keep running, layout work and page scripts can delay frames). Replace "A large app can port its three.js calls first in this mode, then move its DOM code to the page." with a link to the plan: "[A large app in two steps](threejs-overview.md#a-large-app-in-two-steps) uses this mode as a first stage." Keep the paragraph about pages without cross-origin isolation.
