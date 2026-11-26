# concepts-1-substance-17

## Finding as given

- page: concepts/lod
- anchor: ## How the engine picks a level, line 139 "The factor is the render height ..."; ## Small objects, line 193 `pixels = diameter × factor × threshold / distance`
- category: unclear
- severity: medium
- claim: The formula at line 136 has no term named 'factor', so line 139 explains a word the reader has not met. At line 193 the threshold multiplies and the factor divides by it, so the threshold cancels out. The reader must work that out alone.
- evidence: lod.md:136, :139, :193.
- proposedEdit: Write one formula with named parts: 'pixels = size × H × P[1][1] / (2 × distance), where H is the render height in pixels and P[1][1] = 1 / tan(fov / 2).' Then: 'A level switches in where its error × scale gives fewer pixels than lodThreshold. An object hides where its diameter gives fewer pixels than lodThreshold. The bias divides the pixels.'
- generatedSource: (none; the page is hand-written)

Verdict: partly

## Evidence

- docs/concepts/lod.md:136 gives `pixels = error × scale × render height / (2 × distance × tan(field of view / 2))`. It has no term named "factor".
- docs/concepts/lod.md:139 starts "The factor is the render height in pixels times the projection's `P[1][1]`, over twice the threshold in pixels." The page has not named a factor before. The claim holds.
- docs/concepts/lod.md:193 gives `pixels = diameter × factor × threshold / distance`. With factor = H × P[1][1] / (2 × threshold), the threshold cancels to diameter × H × P[1][1] / (2 × distance). The claim holds.
- The math on the page is correct. packages/engine/src/scene/level-rule.ts:110-115 computes factor = height × P[1][1] / (2 × threshold), and :132 gives the error switch distance as error × scale × factor / bias. crates/null3d-core/src/levels.rs:25-29 and :45-46 say the bias divides the factor of both rules, and a source hides while diameter × factor < distance. So the proposed formula and "the bias divides the pixels" are also correct.
- The proposed edit is incomplete. The page uses "factor" in four more places: line 153 ("The bias divides the factor that picks the levels"), line 160 ("The same factor moves the distance at which the object hides"), line 190 ("follows from the same factor as every level's switch distance") and line 196 ("all feed the factor"). If the edit drops the word, those lines lose their meaning. If the edit keeps it, it must define it.

## Corrected claim

The claim holds as stated. The proposed edit must also deal with the other four uses of "factor" (lines 153, 160, 190, 196). It can define the factor once, or reword those lines to say "the pixels".

## Corrected edit

At line 136, keep one formula with named parts:

```text
pixels = size × H × P[1][1] / (2 × distance × bias)
```

Then: "H is the render height in pixels, with the render scale. P[1][1] is 1 / tan(field of view / 2). For a level, size is its error × scale. A level switches in where its pixels fall under `lodThreshold`."

Replace line 139's first sentence with: "So a level switches in at the distance error × scale × factor / bias, where the factor is H × P[1][1] / (2 × lodThreshold)." This names the factor that lines 153, 160, 190 and 196 use. Keep the rest of line 139.

At line 193, use the same formula with size = diameter, and write "The object hides where its diameter gives fewer pixels than `lodThreshold`, that is past the distance diameter × factor / bias." This drops the threshold that cancels out.

Optional: put the definition of the factor and P[1][1] in a "Technical details" block after line 136. The main text then reads: a level switches in where its error covers fewer pixels than the threshold, and the bias divides the pixels. If the block is used, lines 153, 160, 190 and 196 should say "the pixels" or "the switch distance", not "the factor", so the main text makes sense with the block closed.
