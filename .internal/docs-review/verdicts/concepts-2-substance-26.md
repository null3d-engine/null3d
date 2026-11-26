# concepts-2-substance-26

## Finding as given

- page: concepts/particle-buffer
- anchor: ## Limits, line 192: "A softness above 0"
- category: term-before-definition
- severity: low
- claim: This is the first mention of the softness option, and the page never says what it does.
- evidence: packages/engine/src/scene/particles.ts:149-153.
- proposedEdit: "The softness option fades particles near the surfaces behind them. A value above 0 makes the camera copy its opaque depth in each frame, which is one full-screen pass."
- generatedSource: (none; hand-written page)

Verdict: survives

## Evidence

- docs/concepts/particle-buffer.md: the only lines with "soft" are 36 ("a soft round dot", not the option), 69 ("keep the particles faint and soft", not the option) and 192. Line 192 is the first and only mention of the `softness` value. The page never says what it does, and it has no link to the section that does.
- packages/engine/src/scene/particles.ts:149-153: TSDoc says softness is "the distance over which particles fade out where they near the surfaces behind them, in meters ... 0 turns it off. The default is 0." So the proposed wording is correct.
- docs/api/particles.md:175-177 ("### Soft particles") explains the option and its cost. The particle-buffer page links to api/particles.md only at the top and in Related pages, not from this bullet, so a reader at line 192 gets no help.
- Cost to a reader is small (low severity is right), but real: the bullet names a cost for a setting the reader cannot place.

## Corrected edit (small improvement)

Keep the proposal, add the unit and a link to the section that covers it:

"- The `softness` value fades particles out over that distance, in meters, where they near the surfaces behind them ([Soft particles](../api/particles.md#soft-particles)). A value above 0 makes the camera copy its opaque depth in each frame, which is one full-screen pass. The Low preset turns soft particles off."
