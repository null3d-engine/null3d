# api-1-substance-24

## Finding as given

- page: api/animation
- anchor: ## Errors, E1218 row (line 484)
- category: wrong-claim
- severity: low
- claim: The row lists setWeight on a clip that does not play as an E1218 cause with no build qualifier. Only development builds throw; in production the call does nothing.
- evidence: docs/api/animation.md:203, 484; packages/engine/src/scene/animation.ts:696-699 (if (DEV && set === 0) refuse(...)).
- proposedEdit: Write 'setWeight on a clip that does not play (development builds)'.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- The code claim holds. In packages/engine/src/scene/animation.ts:696-699, the "does not play" refusal runs only when DEV is true. In a release build, the loop finds no slot and the call does nothing.
- The page already gives the qualifier in prose. docs/api/animation.md:203 says: "In development builds, `setWeight` on a clip that does not play throws E1218." A reader of the setWeight section is not misled.
- The proposed edit is too narrow. The same E1218 row (line 484) lists other causes that are also development-only:
  - "an option out of range, such as a negative weight": checkWeight and checkFade run inside `if (DEV)` in setWeight (animation.ts:685-687) and in play/crossFade (animation.ts:1059-1069).
  - The whole E1203 row (NaN or infinite fade, speed, time, weight) comes from checks.checkNumber calls inside the same DEV blocks.
  - Other causes in the row throw in every build, for example an unknown clip name: the private clip() lookup (animation.ts:1298-1305) refuses with no DEV guard.
- So the row mixes development-only and every-build causes. Tagging only setWeight makes the other development-only causes look like they throw in production too, which is a new inaccuracy.
- No other errors table in docs/api/ tags single causes by build; only engine.md:70 (E1402) names builds, because that error's check itself differs by build.

## Corrected claim

The E1218 and E1203 rows list several causes with no build qualifier, but some of them throw only in development builds: setWeight on a clip that does not play, out-of-range options such as a negative weight or fade, and every NaN or infinite value in the E1203 row. An unknown clip name throws in every build. The setWeight section (line 203) already says its check is development-only, so the cost to a reader is low.

## Corrected edit

Do not tag one item. Add one sentence under the Errors table:

"Development builds run every check in this table. Release builds keep only the checks that guard engine memory, such as a clip name that the object does not have, and skip the rest, such as range checks and `setWeight` on a clip that does not play."

Before adding it, check each remaining E1218 cause against its DEV guard in packages/engine/src/scene/animation.ts, so that the sentence's examples are correct.
