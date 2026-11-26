# errors-substance-16

## Finding as given

- page: errors/E1218
- anchor: "A clip of more than 4,194,304 keys, its frames times its tracks, is refused too, as a clip whose keys lie hours apart is."
- category: unclear, severity: medium
- claim: The cause runs six unrelated failures together. The fix covers clip events named 'loop' or 'finished', but the cause never names that case. The last sentence is hard to parse. The core's generic message reads 'problem N, at M', and the page never says what N means.
- evidence: errors/core-failure.ts:134-143. generated/core.ts:681-695 holds the problem numbers 1-16. resample.rs:19-28 gives 30 keys per second: 23 minutes for a 65-joint rig, 45 seconds for 3,072 tracks. generated/core.ts:633 gives 4 layers.
- proposedEdit: Make the cause a short list of five cases, including the 'loop' and 'finished' event names. Add a block, <details><summary>Technical details: problem numbers and clip size</summary>, with the problem number table and the note "The engine keeps 30 keys per second for each track, so one clip holds at most 4,194,304 keys: 23 minutes for a 65-joint rig. Two keys hours apart pass it."
- generatedSource: packages/engine/src/errors/codes.ts

Verdict: partly

## Evidence

The problem is real:
- docs/errors/E1218.md: "What happened" has six sentences that name six cases. The last sentence ("..., is refused too, as a clip whose keys lie hours apart is.") is hard to read.
- packages/engine/src/scene/animation.ts:1581-1584 refuses a clip event named 'loop' or 'finished' with E1218. The cause does not name this case. The fix text (errors/fixes.ts:56) does.
- The finding misses more cases. animation.ts:1578 refuses two clips with the same name. scene.ts:3544, 4002-4007, 4035-4040 and 4485-4497 throw E1218 from the public animateProperty() (category api/animation) and from the set step of a hold script, for a bad property path, wrong keyframes or a destroyed target. The cause names none of these cases.
- errors/core-failure.ts:134-143: the generic message is "the engine refused the animation data or call (problem N, at M)". Nothing on the page explains N. generated/core.ts:681-695 holds the codes 1-14 and 16; there is no 15. Code 5 (keys) has a message of its own, so the generic message never shows 5.
- resample.rs:19-28 confirms 30 keys per second by default ("unless the caller asks for another"), and 4,194,304 keys = 23 minutes for a 65-joint rig with all three channels, or 45 seconds for 3,072 tracks.

The proposed edit is wrong in form:
- tools/lib/docs.ts:442 puts entry.cause into the page's front-matter summary, and docs.ts:466 puts it into a cell of the errors index table. A Markdown list or a <details> block in the cause would break both.
- errors/codes.ts:13 states the contract: cause is "What went wrong, in one or two sentences." The current six-sentence cause already breaks it. The fix is to shorten the cause, not to make it a list.
- The note "Two keys hours apart pass it" is ambiguous. "Pass" can mean "are accepted". The code means the opposite: they go over the limit and are refused.
- "Five cases" is too few. With the missed cases there are at least eight.

## Corrected claim

The E1218 cause packs at least eight failure cases into six sentences, against the one-or-two-sentence contract in codes.ts. It omits the reserved event names 'loop' and 'finished', duplicate clip names, and the animateProperty() and hold-script property errors. Its last sentence is hard to parse. The page never explains the "problem N" number in the generic core message.

## Corrected edit

1. In packages/engine/src/errors/codes.ts, shorten the E1218 cause to one or two sentences that work as a summary and as an index-table cell. For example: "An animation call, or animation data that the engine loads, named something that does not exist or gave a value out of range. The call may be an animator call, a morph-weight call or animateProperty()."
2. Add an optional field to ErrorEntry, such as `details`, that only errorPage() in tools/lib/docs.ts renders, under "What happened" and after the cause. Keep it out of the summary and the index table.
3. For E1218, fill that field with a short bulleted list of the cases: an unknown clip, layer, joint or morph target; an option out of range (layers 0 to 3, weights 0 to 1, fades of 0 or more); animator() on an object without clips; two clips with the same name, or a clip event named 'loop' or 'finished'; a property path or keyframes that animateProperty() or a hold script's set step does not take, or a destroyed target; animation data that the core refuses; a clip with too many keys.
4. After the list, add a closed block: <details><summary>Technical details: problem numbers and clip size</summary>. Put in it the table of problem numbers 1-14 and 16 (number 5 has its own message), and this note: "The engine keeps 30 keys per second for each track unless the file sets another rate. One clip holds at most 4,194,304 keys, counted as its frames times its tracks. That is about 23 minutes for a 65-joint rig that animates all three channels, or 45 seconds for 3,072 tracks. Two keys that lie hours apart make a clip go over this limit, so the engine refuses it." Before it goes into the docs, check that the problem numbers are stable for users.
