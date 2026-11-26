# concepts-1-substance-20

## The finding as given

- page: concepts/instances
- anchor: ## The row arrays, line 74 "... one that is wrong all the same can shear its row by up to about four per cent. Well outside the band, a mistyped quaternion is scaled and only turns its row."
- category: unclear
- severity: medium
- claim: 'Wrong all the same' and 'only turns its row' do not tell the reader what to do. The rule is simple: write unit quaternions, because the engine does not correct small errors.
- evidence: crates/null3d-core/src/math.rs:67-96 (within about 1% of unit length, used as written; beyond that, scaled).
- proposedEdit: 'Write unit quaternions. The engine uses a quaternion within about 1% of unit length as written, so a small error stretches or shears the row by up to about 4%. It scales a quaternion further from unit length, so a larger error only turns the row.'
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/concepts/instances.md:74 opens "To turn rows, write quaternions." The paragraph never says the target is unit length. A grep of the page finds no "unit quaternion" instruction. So the core point holds: the reader is not told plainly to write unit quaternions, and "one that is wrong all the same" is vague about what "wrong" means.
- crates/null3d-core/src/math.rs:82-92 (`unit_rotation`): the test is on the squared length, in [0.98, 1.02]. That is a length within about 1% of unit. Inside the band the quaternion is used as written. Outside it (and not zero) it is scaled to unit length. The four-at-once form at math.rs:279 uses the same band. The doc comment at math.rs:67-80 gives the four per cent shear figure. The page's facts are correct.
- "Only turns its row" is not unclear in context. It contrasts with "shear" in the sentence before: the scaled quaternion turns the row without stretching it. The proposed edit keeps the same phrase ("only turns the row"), so the finding's complaint about that phrase is not consistent with its own fix.
- The proposed edit drops a useful fact: "a rounded rotation is not moved". That is the reason the band exists (math.rs:68-70: scenes write rounded quaternions such as [0, 0.38, 0, 0.92], squared length 0.9908, inside the band). Without it, "Write unit quaternions ... the engine does not correct small errors" may lead readers to think a rounded quaternion is an error they must fix. The edit also changes "per cent" words to "%" figures for no gain.
- Severity: low to medium. The page facts are right, and the math helpers that the paragraph links to make unit quaternions, so few readers are misled.

## Corrected claim

The paragraph never names unit length as the goal, and "wrong all the same" does not say what is wrong. "Only turns its row" is clear in context. The fix should add the instruction but keep the point that rounded quaternions are used as written.

## Corrected edit

Replace the paragraph at line 74 with:

"To turn rows, write unit quaternions, whose length is 1. The engine uses a quaternion within about one per cent of unit length exactly as written, so a rounded rotation such as `[0, 0.38, 0, 0.92]` does not move. The engine does not correct an error inside that band: it can stretch or shear the row by up to about four per cent. The engine scales a quaternion further from unit length to unit length, so a mistyped one turns its row without stretching it. The [math helpers](../api/math.md) make unit quaternions without allocating:"
