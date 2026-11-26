# concepts-1-readability-11

## Finding as given

- page: concepts/lod
- anchor: ## How the engine picks a level, lines 136 and 139; ## Small objects, line 194
- category: term-before-definition
- severity: medium
- claim: Line 136 gives a formula with no 'factor'. Line 139 then says 'The factor is the render height in pixels times the projection's P[1][1], over twice the threshold'. Line 194 gives 'pixels = diameter × factor × threshold / distance', and line 153 says 'The bias divides the factor'. The reader cannot connect the three forms.
- evidence: lod.md:136, 139, 145, 153, 194
- proposedEdit: Right after the first formula, define the factor in plain words: 'The engine folds the render height, the field of view and the threshold into one number per view, the factor. A level switches in where error × scale × factor / distance falls under 1.' Use the same form at 194. Move the P[1][1] form and the distance rules of line 145 (center less half the radius, cap at twice the nearest point, the 2 km ground) into a block 'Technical details: how the engine measures the distance'.

Verdict: survives

## Evidence

- lod.md:136 gives `pixels = error × scale × render height / (2 × distance × tan(field of view / 2))`. It has no factor.
- lod.md:139 opens with "The factor is ...", with "the", as if the reader already knows the term. Nothing on the page says that P[1][1] is 1 / tan(field of view / 2), so the reader cannot see that 139 restates 136.
- lod.md:153 ("The bias divides the factor") and lod.md:160 ("The same factor moves the distance at which the object hides") lean on the term.
- lod.md:194 writes `pixels = diameter × factor × threshold / distance`. The "× threshold" exists only to undo the threshold inside the factor. A reader who did not derive the factor sees the threshold twice: once in the formula and once in the comparison at 197.
- The math itself is right, so this is a readability issue, not a wrong claim. Source: packages/engine/src/scene/level-rule.ts:106-111 (`factor = height × P[1][1] / (2 × threshold)`, with P[1][1] = 1 / tan(fov/2) at 101-104) and :132 (switch distance = error × scale × factor / bias). The core says the same at crates/null3d-core/src/levels.rs:11, 25 and 45-46: "the source hides while `diameter × factor < distance`, the same comparison that picks every level", and computes it at :843.
- The proposed rule "error × scale × factor / distance falls under 1" matches level-rule.ts:221 (a level draws when its switch distance is under the measured distance). "Use the same form at 194" gives "diameter × factor / distance falls under 1", which is the core's own wording at levels.rs:46. So the edit is correct.
- The proposed block is allowed by the contract: it holds dense, correct detail, no headings, and the main text still reads with it closed.

## Notes on the edit

- Line 145 holds more than the distance rules. Its last sentences ("Turning the camera never changes a level", a camera inside the bounds keeps full detail, a render pass picks with its own camera, mirrors and the outline effect pick as the main camera does) are user-facing behavior. Keep them in the main text; move only the half-radius rule, the twice-the-nearest-point cap and the 2 km ground example into the block, as the finding lists.
- In the block, state that P[1][1] is 1 / tan(field of view / 2), so the P[1][1] form visibly equals the formula at 136.
- At 194, drop "× threshold": write that the object hides where diameter × factor / distance falls under 1, with the bias dividing the factor as at 153.
