# start-substance-15

## The finding as given

- page: getting-started/hosting
- anchor: line 199 "In this version, a pipelined page's start downloads about:"
- category: term-before-definition
- severity: medium
- claim: "Pipelined" is defined only on the architecture page, so the reader cannot tell whether their page is pipelined. "In this version" suggests a later change.
- evidence: hosting.md:199; pages.md:28 (the pipelined frame belongs to concepts/architecture).
- proposedEdit: "With the default threaded setup, a page's start downloads about:" Drop "In this version". Link [Architecture](../concepts/architecture.md) if the latency mode matters.

Verdict: partly

## Evidence

- hosting.md:199 is the only use of "pipelined" on the page. Everywhere else the page talks of the threaded and single-threaded builds (lines 16-17, 20, 110-115, 150, 156, 190, 195). The page never says what "pipelined" means, and its only link to the architecture page is in the closing list (line 398). So the term-before-definition part holds.
- The word is not wrong. The size check measures each thread mode on its own: tools/lib/size-report.ts:768-835 lists "pipelined", "low latency", "drawing on the main thread", "single-threaded" and "sketch on the main thread", each with different files. The figures describe the pipelined mode. concepts/architecture.md:122 says pipelined is the default when the page can use threads. So "the default threaded setup" names the same case in words this page already uses.
- "In this version" is not an internal process word under the AGENTS.md "Writing docs" rule (milestones, checkpoints, task IDs, plans). It only marks the numbers as subject to change, and "about" already does that. Dropping it is a matter of taste.
- Severity: the sentence only introduces a table whose point (Brotli downloads less than gzip) is clear without the term. guides/deploying.md:92 gives the same 130 KB figure with no mode word. The cost to a reader is small, so low fits better than medium.

## Corrected claim

"Pipelined" appears on the hosting page only at line 199 and is not explained there. The page frames everything as threaded or single-threaded. The figures are for the default mode of a threaded page, so the page should say that in its own terms. "In this version" is harmless; removing it is optional polish. Severity low.

## Corrected edit

"On a threaded page, in the default latency mode ([Architecture](../concepts/architecture.md#latency-modes)), the start downloads about:"
Keep or drop "In this version" as the editor prefers. Do not write only "a page's start", because the single-threaded build and the other modes download different files.
