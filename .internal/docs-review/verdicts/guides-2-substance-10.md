# guides-2-substance-10

## Finding as given

- page: guides/loading-screens, guides/start-time
- anchor: loading-screens lines 57-59; start-time lines 200-202
- category: duplication
- severity: medium
- claim: Both pages repeat the download list rules (two at a time, a load moves a file to the front, up to four) and the serial-load warning. loading-screens line 57 is hard to follow: "A load of a later file moves it to the front of the list. Up to four listed files then download while loads wait for them."
- evidence: packages/engine/src/sketch/runner.ts:264 LISTED_AT_ONCE = 2, :272 LISTED_MOST = 4. The facts are right. The problem is the second copy and the wording.
- proposedEdit: Keep the rules on the Sketch API page, which both guides link to. On each guide keep: "Name the files that the first frame needs in downloads, in the order that the setup needs them." Rewrite: "Two listed files download at a time. When the setup asks for a listed file that has not started, it starts at once, and up to four then download together."

Verdict: partly

## Evidence

- The wording problem holds. docs/guides/loading-screens.md:57 says "A load of a later file moves it to the front of the list. Up to four listed files then download while loads wait for them." "A later file" does not say later than what, and "then" hides the rule. start-time.md:200 says the same rule more clearly ("A load that waits for a listed file moves it to the front, and up to four then download at once").
- The duplication is real but small. The same rules live in docs/api/sketch.md:98 (download list) and :108 (serial-load warning). Both guides link to those sections (loading-screens.md:57 and :59; start-time.md:200). Each guide gives a short summary plus a link. The AGENTS.md "Writing docs" section has no rule against a short summary on a task guide. Three copies of the numbers (two and four) can drift, so trimming has some value, but this is not a medium-severity cost to a reader.
- The proposed edit drops a reason the guides need. The "two at a time, so the engine's own files still find free connections" clause (loading-screens.md:57, start-time.md:200) is why a reader should list only the first frame's files. Cutting the guides to one sentence loses that link between rule and advice.
- The proposed rewrite is not exact about the code. packages/engine/src/scene/downloads.ts:190-201 (`ask`): a load of a listed file that has not started begins at once only while fewer than four listed files download; otherwise it waits, ahead of the rest of the list (startQueued, :228-240). "It starts at once" is wrong when four already download.
- The edit is also self-contradictory: it says to keep only one sentence on each guide, then gives a rewrite of the rule sentence.

## Corrected claim

loading-screens.md:57 states the front-of-list rule in a hard-to-follow way. Both guides repeat the Sketch API page's download-list rules and serial-load warning in short form with links; this is low-severity duplication, not a misleading copy.

## Corrected edit

On loading-screens.md:57, replace the two sentences "A load of a later file moves it to the front of the list. Up to four listed files then download while loads wait for them." with:
"When the setup loads a listed file that has not started, that file goes first: it starts at once, unless four listed files already download."
Keep the "two at a time, so the engine's own files still find free connections" reason and the link on both guides. Optionally drop the numbers from start-time.md:200 and leave them to the Sketch API page's download-list section, so only one page states them.
