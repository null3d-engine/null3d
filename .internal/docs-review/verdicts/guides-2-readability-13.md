# guides-2-readability-13

## Finding as given

- page: guides/start-time
- anchor: ## What the engine does while the core downloads, lines 154-166
- category: unclear
- severity: medium
- claim: Line 166 starts 'The sketch module's top-level code therefore runs before the engine has started'. Its reason is the list at line 156, but a Vite paragraph (162) and a measure sentence (164) sit between, so 'therefore' reads as if it follows the measure figure. Line 162 ends with maintainer history.
- evidence: lines 160-166; line 162 'The engine's package keeps no `sideEffects` list: one was measured, and it made the start slower.'
- proposedEdit: Move line 166 to follow line 160. Move line 164 to '## Measure a start'. Rewrite the last sentence of line 162 as a present fact ('The engine's package has no `sideEffects` list, because such a list makes the start slower.') or cut it.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/guides/start-time.md:154-166. The order is as the finding says: the list (156-158), "So when the core arrives..." (160), the Vite plugin paragraph (162), the `engine.measure()` sentence (164), then "The sketch module's top-level code therefore runs..." (166). The reason for "therefore" is the first bullet at 156 (the sketch worker imports the sketch module while the core downloads). With 162 and 164 between them, the link is lost. This part holds.
- docs/guides/start-time.md:162 ends with "one was measured, and it made the start slower". That is a report of a past test, not a fact a user can act on. A user cannot change the engine's package file. This part holds.
- docs/guides/start-time.md:304. The "Measure a start" table already has a `load.drawingStart` row that says the same thing as line 164, in more detail. Moving line 164 there would add a duplicate. Line 164 should be cut, not moved.
- .dev/implementation-notes.md:110 gives the measurement behind line 162. Over HTTP/1.1 the list made the first frame later. Over HTTP/2 with Brotli the result was mixed: one demo 31 ms sooner, another 62 ms later. So the proposed rewrite "because such a list makes the start slower" states a general rule that the measurement does not support. Cut the sentence instead.
- stats.json counts paragraph 162 at 90 words and 6 sentences. Cutting its last sentence also brings it under the limit.

## Corrected claim

The order problem is real: "therefore" at line 166 is separated from its reason (the first bullet at line 156) by the Vite paragraph and the measure sentence. Line 164 repeats the `load.drawingStart` row that "Measure a start" already has. The last sentence of line 162 reports a past test and does not help a reader.

## Corrected edit

1. Move line 166 to follow line 160, so the section reads: the list, "So when the core arrives...", then the sketch module paragraph. Optionally write "So the sketch module's top-level code runs..." to avoid two "so" links in a row.
2. Cut line 164. The `load.drawingStart` row at line 304 already says it, and the "Measure a start" link appears elsewhere on the page.
3. Cut the last sentence of line 162 ("The engine's package keeps no `sideEffects` list: ..."). Do not rewrite it as "such a list makes the start slower", because over HTTP/2 the measured result was mixed.
