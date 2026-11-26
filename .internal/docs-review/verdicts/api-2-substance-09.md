# api-2-substance-09

## Finding as given

- page: api/impostors
- anchor: ## Bake the atlases, 'taller than that height by the bake's room' (line 107)
- category: term-before-definition
- severity: medium
- claim: room is used but not explained. The reader cannot tell whether it is a length, a margin or a factor. It is a factor: the picture's height divided by the card's height.
- evidence: docs/api/impostors.md:107; packages/impostors/src/batch.ts:74-77; packages/impostors/src/bake.ts:267 (room: Math.hypot(2 * reach, objectHeight) / objectHeight).
- proposedEdit: 'Each view's picture is taller than the card, because a view from above must hold the object's whole width too. room is that factor: the picture's height divided by the card's height. Pass the bake's room to createImpostors. A picture that you paint to fit the card takes the default, 1.'

Verdict: partly

## Evidence

- docs/api/impostors.md:107 says the picture "is taller than that height by the bake's `room`". "Taller by X" reads as a length added, not a factor. The page never says that `room` is a ratio. The other mentions (line 111, line 219 code comment) only name the field.
- The code confirms a factor: packages/impostors/src/bake.ts:267 sets `room` to `Math.hypot(2 * reach, objectHeight) / objectHeight`. The TSDoc at bake.ts:117-119 and batch.ts:74-76 says "How many times taller a view's picture is than a card's height". createImpostors uses it as a scale (batch.ts:203, `picture: [options.room ?? 1, 0, 0, 0]`).
- Mitigation: the linked API reference (docs/api/reference/impostors.md:184, :288) says "How many times taller". But the guide page links to it only at its end (line 274), and two reference rows (167, 308, from atlas-file.ts:43 and load.ts) say "How much taller", which has the same ambiguity. So the main claim holds.
- The proposed edit's reason is not exact. The picture's height is not set by the view from above alone. bake.ts:14-17 and :255 make it the diagonal of the card's width and the object's height (`Math.hypot(2 * reach, objectHeight)`), so that the object fits from every view angle. Line 107 already says "Each picture also holds the object from above", which is also slightly loose.

## Corrected claim

The page says the picture is "taller by `room`", which reads as an added length. `room` is a factor: the picture's height divided by the card's height. The picture's height is the diagonal of the card's width and the object's height, so the object fits from every view angle, from the side through to straight above. The API reference defines it as a factor, but the guide page does not, and two reference rows (atlas-file.ts:43, load.ts `room`) say "How much taller", with the same ambiguity.

## Corrected edit

Replace the last two sentences of line 107 with:

"Each view's picture is taller than the card, so that the object fits from every angle, from the side through to straight above. The picture's height is the diagonal of the card's width and the object's height. The bake's `room` is the factor between the two: the picture's height divided by the card's height. Pass it to `createImpostors` as `room`. A picture that you paint to fit its card takes the default, 1."

Optional, same issue at the source: change the TSDoc at packages/impostors/src/atlas-file.ts:43 and the `room` field in packages/impostors/src/load.ts from "How much taller" to "How many times taller", to match bake.ts and batch.ts.
