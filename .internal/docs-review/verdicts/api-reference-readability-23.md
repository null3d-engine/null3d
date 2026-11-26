# api-reference-readability-23

## Finding as given

- page: api/reference/particles
- anchor: lines 32 `EmitterShape`, 38 `ParticleBuffer`, 133 `ParticleEmitterShape`, 154 `ParticleFacing`
- category: long-paragraph
- severity: medium
- claim: Four long paragraphs, two of them the same text, all walking through values in prose.
- evidence: stats.json particles 25 (100 words), 31 (103 words), 126 (93 words, same text as 25), 147 (57 words, 5 sentences). Sources packages/particles/src/system.ts:37, packages/engine/src/scene/particles.ts:72 and 547.
- proposedEdit: Make the shapes one Shape | Where particles start | Direction table, kept in one place. Make ParticleFacing a four-row table. Split ParticleBuffer into what it is and how to fill it.
- generatedSource: packages/particles/src/system.ts

Verdict: partly

## Evidence

- The page has the four paragraphs at lines 32, 38, 133 and 154. The stats counts are facts.
- The two shape paragraphs are almost the same, not the same. The one for the particles package's shape (page line 32, packages/particles/src/system.ts:37-43) adds "as a fountain or a flame does". The engine's shape (page line 133, packages/engine/src/scene/particles.ts:220-225) does not.
- They are two separate exported types with the same members: the particles package's `EmitterShape` (system.ts:46, used at system.ts:110) and the engine's `ParticleEmitterShape` (engine particles.ts:229, used at :280). "Kept in one place" needs a code change: make the particles package's type an alias of the engine's type, with a short comment that points to it. Two comments alone cannot share one table.
- The proposed edit cannot work by a change to the doc comments alone. The reference generator puts every summary on one line: `flat` at tools/lib/api-docs.ts:74 replaces every newline with a space, and `summaryOf` (api-docs.ts:119-123) applies it. `renderSymbol` then prints the summary as one line (api-docs.ts:494). A table or a paragraph break written in a doc comment would render as one long line with literal pipe characters. The same is true of a `<details>` block, because GitHub Flavored Markdown needs blank lines around the Markdown inside it.
- The source files are wrong or missing in the finding. `ParticleBuffer` is at packages/engine/src/scene/particles.ts:547. `ParticleFacing` is at engine particles.ts:72. `ParticleEmitterShape` is at engine particles.ts:220. The finding gives only packages/particles/src/system.ts as the source.
- The `ParticleFacing` paragraph (57 words, four values) reads well as it is. A four-row table is a small gain. It is low severity, not medium.

## Corrected claim

Three paragraphs walk through values in prose. Two of them describe the emitter shapes almost word for word: the particles package and the engine each export their own copy of the shape type. The `ParticleBuffer` paragraph mixes what the buffer is with the order of calls in each frame. The `ParticleFacing` paragraph is long only by sentence count (low).

## Corrected edit

1. Change tools/lib/api-docs.ts so that a symbol's summary keeps its blank-line paragraph breaks, Markdown table rows and `<details>` blocks. Join lines only inside each paragraph. Keep the one-line `flat` form for member table cells.
2. In packages/particles/src/system.ts:37-51, make `EmitterShape` an alias of the engine's `ParticleEmitterShape`, with a one-line comment that links to it. In packages/engine/src/scene/particles.ts:220-225, write the shapes as one table: Shape | Where particles start | Which way they set off. Keep the fountain or flame example on the cone row.
3. In packages/engine/src/scene/particles.ts:538-544, split the `ParticleBuffer` comment into two paragraphs: what the buffer is (a scene object with one quad per live record, which the GPU moves and ages), then how to fill it each frame (`write` or `writeRecords`, then `frame`, then `commit`). The sentence about typed arrays and no allocation can go into a "Technical details" block.
4. Optional, low: write `ParticleFacing` (engine particles.ts:72-77) as a four-row table: Value | How the quad turns | Example.
