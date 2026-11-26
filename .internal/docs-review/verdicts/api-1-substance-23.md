# Verdict for api-1-substance-23

## The finding as given

- id: api-1-substance-23 (slice api-1, role substance)
- page: api/assets
- anchor: "## glTF models, line 81"
- category: unclear
- severity: low
- claim: "'Three calls answer at once' does not say which three, and 'answer' is unclear for cache, whose reads still wait."
- evidence: docs/api/assets.md:81.
- proposedEdit: "'Three calls return at once, before that code arrives: registerGltfExtension and onProgress return their remove functions, and cache returns its namespace, whose reads and writes wait for the code.'"
- generatedSource: (none; hand-written page)

Verdict: refuted

## Evidence

- docs/api/assets.md:81 names all three calls in the two sentences right after "Three calls answer at once": "Both `registerGltfExtension` and `onProgress` give a function that removes the handler, and `onProgress` registers its handler when the code arrives. The `cache` call gives its namespace, whose reads and writes wait for the code." So the claim that the page does not say which three is wrong.
- The same paragraph already says that the reads and writes of `cache` wait for the code. The reader is not left to think the reads answer at once.
- The page matches the code. packages/engine/src/sketch/runner.ts:418-429 returns `registerGltfExtension`, `cache` and `onProgress` at once from the lazy assets proxy. `onProgress` registers its handler only after the loader arrives (runner.ts:425-427). packages/engine/src/sketch/runner.ts:449-461 (`lazyCache`) gives the namespace at once, and each `get` and `put` waits for the loader.
- The proposed edit is worse than the current text. It drops the fact that `onProgress` registers its handler only when the code arrives, so a reader could expect progress events from before that point. Its other changes (one long sentence in place of three short ones, "return" in place of "answer") are a matter of taste and do not fix any real cost to a reader.

## Corrected claim or edit

None. Keep line 81 as it is.
