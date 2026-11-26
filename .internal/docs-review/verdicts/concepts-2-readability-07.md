# concepts-2-readability-07

## Finding as given

- page: concepts/quality-presets
- anchor: title 'Quality presets, dynamic resolution and frame budgets'
- category: split-page
- severity: high
- claim: At 6,748 words with 29 long paragraphs, the page covers two topics. One is choosing a preset at start-up. The other is during-play resolution and the governor, which has its own diagrams, rules and API.
- evidence: stats.json words 6,748, 29 longParagraphs. H2s 'Dynamic resolution' (241) and 'The frame-budget governor' (289) with H3s.
- proposedEdit: Keep lines 9-239 as concepts/quality-presets. Move 241-333 (Dynamic resolution, governor, lowest tier, add-on settings) to a new concepts/frame-budget page ('Dynamic resolution and the frame-budget governor'), and link the two both ways. Update the inbound anchors from post-processing.md 60 and 107, render-graph.md 142 and guides/phones.md 91.
- generatedSource: (none)

Verdict: partly

## Evidence

What holds:
- The page has two separable topics. Lines 9-239 cover how a preset is chosen, checked, switched and what each preset sets. Lines 241-333 cover what happens during play: render scale control (diagram at 243), the governor (diagram at 291, ten numbered steps at 302-311), the lowest tier (319) and add-on settings (331). The title itself names three topics.
- Measured split: lines 241-334 hold about 2,127 words, lines 9-240 about 4,554. Each half reads on its own once the shared "target frame rate" section (109) stays on the presets page and the new page links to it.
- The new page can open with its existing Mermaid diagram, so it meets the concept-page rule in AGENTS.md "Writing docs".

What does not hold:
1. Severity is overstated. The page has clear H2/H3 headings and a related-pages list. Its length makes it harder to use, but it neither misleads a reader nor blocks a newcomer. It is also not the longest concept page: lighting (9,823 words), post-processing (7,942) and shadows (7,536) are longer. Medium fits.
2. The split does not fix the long paragraphs. About 20 of the 29 long paragraphs (stats.json lines 56-230) stay on the presets page. That needs its own finding.
3. The inbound-link list is wrong and incomplete.
   - post-processing.md 107 links to the page root (`quality-presets.md`), not an anchor. Its text ("lists the governor's ...") must still be retargeted, and so must the related-pages line at post-processing.md 420.
   - These links to moved anchors are missing from the edit: guides/phones.md 55 (#dynamic-resolution), guides/performance.md 99 and 271 (#the-frame-budget-governor), guides/start-time.md 248 (#the-lowest-quality-tier), concepts/backends.md 78 and concepts/architecture.md 66 (#dynamic-resolution), api/quality.md 71 (#the-lowest-quality-tier), 98 (#dynamic-resolution) and 102 (#the-lowest-quality-tier and #the-frame-budget-governor), api/post.md 412 (#dynamic-resolution).
   - Links inside the page also break: lines 83 and 220 (#the-lowest-quality-tier) and 95 and 111 (#the-frame-budget-governor) point down into the moved part. Lines 258 and 315 in the moved part point back to #the-target-frame-rate and must become cross-page links.
4. Other required edits are missing:
   - The new page needs an entry in PAGES in tools/lib/docs.ts, since docs/pages.md is generated from it. The presets entry at tools/lib/docs.ts:96 and the page's front matter (lines 3, 6) still name dynamic resolution and the governor in the title and summary, so both must change.
   - The opening note (line 11) and the start-up diagram (line 28, "The governor starts") describe the governor; they need a link to the new page.
   - "Docs and skills stay in sync": skills/null3d-develop/references/performance.md lines 116, 167 and 169 cite this page for dynamic resolution and the governor (169 uses #the-frame-budget-governor). They must cite the new page.
   - Both pages need their Related pages lists updated (line 335 on).

## Corrected claim

The page holds two separable topics, preset choice (lines 9-239, about 4,550 words) and during-play scaling and the governor (lines 241-333, about 2,130 words). A split would make each page easier to use. This is a medium issue, not high. A split alone leaves most of the 29 long paragraphs on the presets page.

## Corrected edit

Move lines 241-333 to a new concepts/frame-budget page ("Dynamic resolution and the frame-budget governor") that opens with the render scale diagram. Keep "The target frame rate" on the presets page and link to it from the new page. Then:
- Add the page to PAGES in tools/lib/docs.ts, and change the presets title and summary there (line 96) and in the page's front matter, for example to "Quality presets".
- Add a link from the opening note (line 11) and after the start-up diagram to the new page. Rewrite in-page links at 83, 95, 111 and 220 as cross-page links, and on the new page turn the #the-target-frame-rate links (from 258 and 315) into links back to quality-presets.md.
- Retarget every inbound link: guides/phones.md 55 and 91; guides/performance.md 99 and 271; guides/start-time.md 248; concepts/backends.md 78; concepts/architecture.md 66; concepts/post-processing.md 60, 107 and 420; concepts/render-graph.md 142; api/quality.md 71, 98 and 102; api/post.md 412.
- Update skills/null3d-develop/references/performance.md 116, 167 and 169 to cite the new page.
- Give each page a Related pages entry for the other.
