# api-3-substance-15

## Finding as given

- Page: api/sketch
- Anchor: ## Options table, line 65: `lowestTier`
- Category: unclear. Severity: medium.
- Claim: "The governor's lowest quality tier" has no link or explanation, and "for a scene that its own sketch thread limits" is hard to parse. The source states the reason: the tier only draws a smaller picture, which does not help when sketch code is the slow part.
- Evidence: packages/engine/src/sketch/define-sketch.ts:220-226; docs/concepts/quality-presets.md (frame-budget governor).
- Proposed edit: "`false` stops the [frame-budget governor](../concepts/quality-presets.md) from dropping to its lowest tier, which draws a smaller picture. Use it when the sketch's own code, not the GPU, makes frames slow. The page's `?tier=off` switch does the same."
- Generated source: none (docs/api/sketch.md is hand-written; it exists in the repository's docs/ folder).

Verdict: partly

## Evidence

- docs/api/sketch.md:65 reads "False keeps the governor's lowest quality tier out, for a scene that its own sketch thread limits". The cell has no link, and no other line on the page names the governor or the tier. The only quality link is line 124, to the Quality API. So the missing link and the awkward phrase both hold.
- docs/concepts/quality-presets.md:319-329 has a section "The lowest quality tier" that explains this option (line 329). The best link target is that anchor, `#the-lowest-quality-tier`, not the top of the page.
- The claim that the tier "only draws a smaller picture" is wrong. quality-presets.md:321 lists its cuts: a third-size render scale floor, no sun shadows, no bloom, reflection passes at a quarter size, and no depth prepass on WebGL2. The TSDoc at packages/engine/src/sketch/define-sketch.ts:220-226 says the tier's "cuts reach the scene's settings" and names the smaller render as one loss, not the only cut.
- `?tier=off` does keep the tier out (define-sketch.ts TSDoc; docs/api/quality.md:55), so that sentence of the edit is correct.

## Corrected claim

The `lowestTier` cell has no link to the lowest quality tier and its phrase "for a scene that its own sketch thread limits" is hard to parse. The tier cuts the render scale, sun shadows, bloom and reflection size, not only the picture size. None of these cuts make the sketch's own code faster, so a scene that its sketch code slows only loses detail.

## Corrected edit

Replace the cell at docs/api/sketch.md:65 with:

"`false` keeps the governor out of its [lowest quality tier](../concepts/quality-presets.md#the-lowest-quality-tier), which cuts the render scale, shadows and bloom. Set it when the sketch's own code, not the GPU, makes frames slow: the cuts cannot make that code faster. The page's `?tier=off` switch does the same."
