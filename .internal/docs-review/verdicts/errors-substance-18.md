# errors-substance-18

## Finding as given

- page: errors/E1404
- anchor: "An engine thread, or the drawing on the page, hit an error it could not handle, such as a trap in the engine core."
- category: unclear; severity: medium
- claim: 'The drawing on the page' means the engine thread on the page in the single-threaded build, and the page does not explain it. 'A trap' is WebAssembly jargon. The example 'out of memory' suggests a scene that is too large (E1109 or E1304), while the fix calls it an engine bug. 'Destroy the engine and start it again' does not fit the start case, where createEngine() has already stopped the engine.
- evidence: page/engine.ts:979-988 (failureError). errors/errors.test.ts:247-249. docs/api/engine.md:163-164.
- proposedEdit: Cause: 'An engine thread hit an error it could not handle, such as a crash inside the engine core's WebAssembly. The thread is a worker, or the page itself when the engine runs on one thread.' Use an example that is not about memory, such as 'unreachable'. Fix: 'After the start, destroy the engine and create a new one. If the message names memory, see E1109.'
- generatedSource: packages/engine/src/errors/codes.ts; packages/engine/src/errors/fixes.ts

Verdict: partly

## Evidence

- The page text matches the anchor (docs/errors/E1404.md:13; source codes.ts:333-338, fixes.ts:91-92).
- "The drawing on the page" is not only the single-threaded build. The page draws (drawOnPage, page/engine.ts:2899-2925) in the path with no worker threads (engine.ts:3100-3101) and also in the threaded build when no render worker runs (engine.ts:3161-3166). docs/concepts/architecture.md:141 and :143 say the page draws where a worker cannot draw, and with ?render=main. Its fault path calls failureError('the drawing on the page', ...) at engine.ts:2922. So the claim's reading of the phrase is wrong, and the proposed text "the page itself when the engine runs on one thread" would mislead. The underlying point holds: the E1404 page never says that the page's own thread can be the one that draws.
- There is a third source the page does not name: "the sketch on the page failed" (engine.ts:3122-3125), a direct E1404 for the sketch runner on the page.
- "Trap" is WebAssembly jargon that the page does not explain. This holds. "unreachable" as the replacement example is also jargon; the test's own message, "the drawing on the page failed: out of range." (errors.test.ts:249), is a better example because it also shows the page-drawing case.
- The "out of memory" example does sit badly next to "This is an engine bug". But an engine memory failure that the engine catches already arrives as E1109 (page/loader.ts:122-155), and failureError keeps any coded message (engine.ts:986-987, errorOfMessage). So the proposed "If the message names memory, see E1109" would send readers to a page whose fix does not apply to an uncoded failure. Drop that sentence; just change the example.
- The start case holds: onFailure aborts the start with the error while starting (engine.ts:2160-2166), so createEngine() rejects and there is no engine for the caller to destroy. "Destroy the engine and start it again" fits only the after-start case. Low cost, but a real mismatch on this page.

## Corrected claim

The cause sentence uses "the drawing on the page" and "a trap" without explaining them. The page draws on its own main thread whenever no worker draws: in the build without worker threads, where a worker cannot draw, and in low-latency mode or with ?render=main (not only the single-threaded build). The "out of memory" example clashes with "This is an engine bug". The fix's "destroy the engine" does not fit the start case, where createEngine() rejects.

## Corrected edit (codes.ts E1404 and fixes.ts E1404)

- cause: "A thread of the engine hit an error it could not handle, such as a crash in the engine core's WebAssembly code. The thread is a worker, or the page's main thread when the page draws or runs the sketch. After the start, the thread stops its loop: the engine draws no new frames, and engine.onFailure receives this error. During the start, createEngine() stops the engine and rejects with this error."
- example: "E1404: the drawing on the page failed: out of range."
- fix: "This is an engine bug. Report it with the message and the browser. After the start, destroy the engine and create a new one. During the start, call createEngine() again."
