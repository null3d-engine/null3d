# tree-structure-27

## The finding as given

- page: guides/performance
- anchor: ## Measure
- category: split-page
- severity: low
- claim: The performance guide mixes measuring with fixing in 8,423 words and 21 sections.
- evidence: guides/performance sections: Where frame time goes ... Measure | Measure fairly | Memory peak | Browsers differ.
- proposedEdit: Split 'Where frame time goes', 'Measure', 'Measure fairly', 'Memory peak' and 'Browsers differ' into guides/profiling NEW. The performance guide opens with a link to it.
- generatedSource: tools/lib/docs.ts (PAGES)

Verdict: partly

## Evidence

- The counts hold. stats.json gives 8,423 words and 21 second-level sections for guides/performance.
- The measuring sections are one block at the end of the page (docs/guides/performance.md:302-410): Measure, its subsection on the presented rate, Measure fairly, Memory peak and Browsers differ. They are about 2,280 words, about 27% of the page. The rest of the page (lines 59-300) is causes and fixes. So the page does mix two jobs, and the measuring part is large enough to stand alone.
- Other pages already treat this block as the measuring reference. Seven links in six pages point at it: cli/null3d.md:347 and guides/start-time.md:298 and api/debug.md:403 (#measure), getting-started/cdn.md:234, api/engine.md:167 and api/debug.md:337 (#measure-fairly), and guides/phones.md:77 (#memory-peak). A separate measuring page gives those links a clearer target.
- "Where frame time goes" (lines 19-57, 311 words) must NOT move. It is the guide's opening model: the three kinds of cost, the thread diagram, and "Make your own loops tight before you look at the engine". The fix sections after it rely on that model, and the intro (line 15) promises it. Moving it leaves the performance guide with no opening frame.
- The edit leaves out the seven incoming links. Each must point at the new page, or the split breaks them.
- The source is wrong. docs/guides/performance.md is a hand-written page, not generated. tools/lib/docs.ts:150 holds only its PAGES entry. The edit goes in docs/guides/performance.md, a new docs/guides/<new>.md, and a new PAGES entry beside line 150. The summary in both the page's front matter and PAGES ("Measuring; the frame budget; ...") and the intro sentence "and how to measure" (line 15) must change too.
- "Memory peak" (lines 375-395) ends with a fix list ("When a scene comes too close"). It can move with the section, but the performance guide's "Textures and memory" section should then link to it.

## Corrected claim

The performance guide mixes measuring (lines 302-410, about 2,280 words) with causes and fixes in 8,423 words and 21 sections. Other pages already link to the measuring sections as a reference.

## Corrected edit

Move "Measure" (with its subsection), "Measure fairly", "Memory peak" and "Browsers differ" to a new hand-written page, guides/profiling (or guides/measuring). Keep "Where frame time goes" in the performance guide as its opening. Replace the intro line "Measure in every rendering mode..." with a link to the new page, and change "and how to measure" in line 15. Add the new page to PAGES in tools/lib/docs.ts next to guides/performance, and change the performance summary there and in the front matter so it no longer leads with "Measuring". Point the seven incoming links at the new page: cli/null3d.md:347, guides/start-time.md:298, api/debug.md:337 and :403, api/engine.md:167, getting-started/cdn.md:234, guides/phones.md:77. Link the new page's memory section from "Textures and memory".
