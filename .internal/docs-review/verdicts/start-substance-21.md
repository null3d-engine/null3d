# start-substance-21

## Finding as given

- page: getting-started/network-use
- anchor: line 17 "A replay page names a recording..."; line 43 "A recording, a replay and hold mode download them only at their loads."
- category: term-before-definition
- severity: low
- claim: Recordings, replays and hold mode are not explained or linked on this page. Line 43 is hard to parse. Lines 17 and 28 join sentences with semicolons.
- evidence: docs/api/sketch.md:101 ("Hold mode, a replay and a recording download each file at its load, as without the list").
- proposedEdit: Line 17: "A page that replays a recording ([Testing](../guides/testing.md#record-a-session-that-went-wrong)) downloads the recording from the address that the page gives. It uses no other address." Line 43: "In hold mode, a recording and a replay, each file downloads when the sketch loads it, so every run stays the same."
- generatedSource: (none, hand-written page)

Verdict: survives

## Evidence

- docs/getting-started/network-use.md:17 says "A replay page names a recording ... no other address is used for it." The page never says what a replay or a recording is, and it has no link to the testing guide. The whole page has no other mention of replay, record or hold, except line 43.
- docs/getting-started/network-use.md:43 says "A recording, a replay and hold mode download them only at their loads." "Them" and "at their loads" are vague. The source of truth, docs/api/sketch.md:101, says each listed file downloads at its load, as without the list, so runs stay the same. The page drops that reason.
- The terms are defined elsewhere: docs/guides/testing.md:52 "## Hold mode" (the `?hold=<seconds>` switch) and docs/guides/testing.md:135 "## Record a session that went wrong" (`?record`, `?replay=<file>`). So a link fixes the gap with one short phrase.
- The semicolon point is more than taste. AGENTS.md "Writing docs" allows at most 25 words per sentence, in the active voice. Line 17's last sentence has 26 words and a passive clause ("no other address is used for it"). Line 28's second sentence has 29 words.
- The proposed line 17 edit is correct: testing.md:141 confirms the page opens with `?replay=<file>` and downloads that file.

## Problems with the proposed edit

- The line 43 edit is ungrammatical ("In hold mode, a recording and a replay, each file downloads ..."). It also leaves hold mode unlinked, and "when the sketch loads it" is less exact than the setup's load.
- The edit does not fix line 28.

## Corrected edit

Line 17, last sentence:
"A page that replays a recording ([Record a session that went wrong](../guides/testing.md#record-a-session-that-went-wrong)) downloads that file from the address that the page gives. It uses no other address for it."

Line 28, second sentence:
"A feature may have both a shader module and a code module. Each loads at its own first use. A page that never uses the feature downloads neither."

Line 43:
"The `downloads` option of `defineSketch` downloads the files that it names, as soon as the sketch's module has loaded. In [hold mode](../guides/testing.md#hold-mode), and while the engine records or replays a session, each file downloads only when the setup loads it. So every run stays the same."
