# errors-readability-15

## Finding as given

- page: errors/E1218
- anchor: page lines 13 and 17
- category: long-paragraph
- severity: medium
- claim: The cause is 95 words in 6 sentences and the fix is 91 words in 6 sentences. The fix covers clip event names 'loop' and 'finished', but the cause never names that case, so a reader cannot match their error to it. 'is refused too, as a clip whose keys lie hours apart is' is hard to parse.
- evidence: stats.json E1218: line 6 (95, 6), line 10 (91, 6). codes.ts line 202; fixes.ts line 56.
- proposedEdit: Cause: 'An animator call got a name or a value that the object's animation does not take.' Then a table Case | Fix: unknown clip, layer or joint; value out of range; animator() on an object without clips; event named 'loop' or 'finished'; unknown morph target; refused animation data; clip too long (with the 4,194,304-key limit).
- generatedSource: packages/engine/src/errors/codes.ts (E1218); packages/engine/src/errors/fixes.ts (E1218)

Verdict: partly

## Evidence

- docs/errors/E1218.md lines 13 and 17 hold the cause and the fix. Counts (95/6, 91/6) come from stats.json and are facts.
- The cause (codes.ts:202) does not name the reserved event names. The fix (fixes.ts:56) does. The engine throws E1218 for them: packages/engine/src/scene/animation.ts:1581-1584 (startRig refuses an event named 'loop' or 'finished'), through the E1218 thrower at animation.ts:345-347. So the gap is real.
- The last cause sentence ("is refused too, as a clip whose keys lie hours apart is") is hard to parse. That holds.
- The proposed table is wrong for this source:
  - The cause string is not only the "What happened" body. tools/lib/docs.ts:442 puts it in the page's front-matter summary, and docs.ts:466 puts it in a cell of the error index table. A table cannot live in either.
  - The fix string is not only the "How to fix it" body. engine-error.ts:111 (messageFor) splices it into the runtime EngineError message, which a developer reads as plain text in the console. Markdown table pipes would show there as noise.
  - errorPage (docs.ts:436-460) gives every error code the same "What happened / How to fix it" layout. A Case | Fix table merges the two sections for one code only, and needs a change to the shared generator or Markdown inside a string that has three plain-text uses.
- A details block also does not fit: the page has no dense implementer detail to hide; each sentence is one error case that a reader must be able to match.

## Corrected claim

The cause is long and hard to scan, it does not name the reserved event names 'loop' and 'finished' that the fix covers (the engine does throw E1218 for them), and its last sentence is hard to parse. The fix is long but each sentence maps to one case, so it needs only reordering to match the cause. Fix the plain-text strings in codes.ts and fixes.ts; do not add a table.

## Corrected edit

codes.ts E1218 cause (plain sentences, one case each, same order as the fix):

"An animator call got a name or a value that the object's animation does not take. It named a clip, layer or joint that the animation does not have, or gave an option out of range, such as a negative fade. Or animator() was called on an object that has no animation clips. Or setMorphWeight or getMorphWeight named a morph target that the mesh does not have. Or the engine refused the model's animation data: a skeleton that lists a joint before its parent, a clip event named 'loop' or 'finished', or a clip of more than 4,194,304 keys (its frames times its tracks), such as a clip whose keys lie hours apart."

fixes.ts E1218: keep the sentences, put them in the same order as the cause (names and ranges, animator() target, morph targets, then event names and long clips). No Markdown, because the text also goes into the runtime error message.
