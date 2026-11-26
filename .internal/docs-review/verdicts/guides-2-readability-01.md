# guides-2-readability-01

## The finding as given

- Page: guides/start-time
- Anchor: ## Where the time goes (lines 27-110)
- Category: structure. Severity: high.
- Claim: Before the first instruction (line 112), the reader passes six measurement tables and four dense paragraphs. Most compare "before the changes" with "after", which is the history of the engine's own work, not what holds now. A newcomer must scroll past it to learn what to do.
- Evidence: line 29 "Before the changes that this guide describes, a first visit spent its time on these steps"; line 42 "Each change below was then measured alone"; line 60 "timed the engine before and after the changes in turns"; line 86 "Before the changes"; line 97 "With the changes". Tables at lines 31, 44, 64, 75, 88, 99.
- Proposed edit: Keep one short table: Step | Typical cost on a phone link | What shortens it (link to the section), based on the table at line 31, in present tense. Put the HTTP/1.1 and HTTP/2 tables, the two real-phone tables and lines 106-110 in one block: `<details><summary>Technical details: measured starts on a simulated phone link and on real phones</summary> ... </details>`, rewritten as present-tense figures. Drop the Change/Before/After table at line 44, or turn each row into one present-tense figure in the section it links to.

Verdict: partly

## Evidence

What holds:

- The page has six tables (lines 31, 44, 64, 75, 88, 99) and the quoted text between line 27 and the first instruction at line 112 ("## Compress every file"). The quotes at lines 29, 42, 60, 86 and 97 are exact.
- The "before the changes" / "with the changes" framing tells the story of the engine's own work. AGENTS.md "Writing docs" says a page "describes what exists now" and hard rule 41 says text "never keep[s] a log of what happened when". A reader cannot get the "before" engine, so those columns describe nothing the reader can run.
- The figures are correct, dense and useful to implementers, so a collapsed block suits them better than a cut.

What does not hold, or needs a fix:

1. Severity is medium, not high. Nothing in the section is wrong, and nothing blocks a newcomer. Line 25 says the guide "gives the steps that shorten it, in the order of the start", and the headings let a reader jump to the steps. The cost is a long scroll and a confusing frame. That is "clearly harder to read", which is medium.
2. Lines 106-110 are not history. They state present behavior: phones start at Low and run no preset check, the check settles on Low on the slow tablet, and the engine builds a refused pipeline once more, then leaves it out with E1307. The E1307 and E1302 sentences (lines 108-110) are about pipeline builds on phones. They belong in "Pipelines on phones" (line 250), as present-tense facts, not in the measurement block.
3. A "Typical cost on a phone link" column built from the line-31 table would mislead. Those costs are for a start that skips the steps (for example 2.3 s for an uncompressed core, 22 s in one scene that waits for 18 MB of models). They are not typical with the engine as shipped. The column must say what the step costs when it is not done, for example "Cost when skipped".
4. Several rows of the line-44 table already appear in the sections they link to: the splat figures at line 236 (8.8 s against 29.1 s), the stored pipeline list at lines 274-277 (3.81 s against 1.56 s), and the dev server against production build at line 292 (27 to 85 s against 4.6 to 25.7 s). Drop those rows. Move only the rows that have no home yet (compression, the preset check, Chrome's compiled core, the early downloads) as one present-tense figure each in their section.
5. The heading "### On real phones" (line 84) must go when its tables move into the block, because a block may hold no heading.

## Corrected claim

Before the first instruction (line 112), the reader passes six measurement tables. Most of them compare the engine "before the changes" with "after", which is the history of the engine's own work and breaks the rule that a page states what holds now. The figures are useful, but they push the steps far down the page. Severity: medium.

## Corrected edit

- Replace lines 29-58 with one short intro sentence about the measurement link (150 ms round trip, 10 Mbit/s, empty cache) and one table: Step | Cost when skipped | What shortens it (link to the section). Base it on the line-31 table, in present tense.
- Drop the line-44 table. Its splat, stored-pipeline and dev-server rows already appear at lines 236, 277 and 292. Move each remaining row (compression, preset check, Chrome's compiled core, the first view's downloads) as one present-tense figure into the section it links to.
- Put lines 60-104 (the HTTP/1.1 and HTTP/2 tables, the real-phone tables and line 95) in one block, without the "### On real phones" heading, with the comparisons stated as present-tense figures: "With every step on, ... Without them, ...". Use `<details><summary>Technical details: measured starts on a simulated phone link and on real phones</summary> ... </details>`. Keep line 106 (phones start at Low, the tablet's preset check) in that block.
- Move lines 108-110 (pipeline builds on phones, the E1307 retry and the tablet's E1302) to "Pipelines on phones", as present-tense behavior.
