# guides-1-substance-19

## Finding as given

- page: guides/debugging
- anchor: long paragraphs at lines 97, 124, 138, 146
- category: long-paragraph
- severity: medium
- claim: The stats overlay paragraph (line 138, 180 words) covers the header, the card, add-on rows, Memory by system, three ways to show it and debug.frameStats. Line 97 lists three reason codes inline. Line 124 mixes views, a switch and shadow cascades.
- evidence: .internal/docs-review/stats.json guides/debugging (statistics lines 90, 117, 131, 139).
- proposedEdit: Line 138: two short paragraphs (what it shows, how to show it), with add-on rows and Memory by system in a 'Technical details: the rows of the stats card' block. Line 97: a three-row table of renderFallback reasons. Line 124: split at 'To see whether shadow edges crawl'.

Verdict: partly

## Evidence

- The four long paragraphs are facts from stats.json (lines 90, 117, 131, 139 there are page lines 97, 124, 138, 146, offset by the front matter). The 180-word, 12-sentence stats paragraph is real.
- Line 138: the two sentences on add-on rows and `Memory by system` repeat detail that the linked page already holds in full: docs/api/debug.md:248 ("The add-ons' rows") and docs/api/debug.md:312 ("Memory by system"), plus the Steps row at docs/api/debug.md:221. The paragraph already links to that page. A details block here would make a third copy that must be kept in step with the API page. The split into "what it shows" and "how to show it" is right; the block is not.
- Line 97: the three reason values are written out nowhere else in the hand-written docs. The link at the end, docs/api/engine.md#what-the-engine-reports, does not describe each value: docs/api/engine.md:156 only says the field "says why the page draws where a worker was meant to, or is null". The values live only in the generated reference (docs/api/reference/engine.md:461, from the TSDoc of RenderFallback). So a three-row table on this page is a good edit and keeps useful detail. The link text "describes each value" is false and should change to point at the generated reference, or say less.
- Line 124: the split at "To see whether shadow edges crawl" is sound. The shadow cascade sentences are a separate task, and the debug.shadowCamera section (docs/api/debug.md:156-158) is linked.
- Line 146: the anchor names this paragraph (93 words, 6 sentences) but the proposed edit gives it no change. The list of object fields could become a short list, or the last sentence (frame figures at the panel's foot) could start its own paragraph.

## Corrected claim

The four paragraphs are long, as stated. On line 138, the add-on rows and Memory by system detail is already on the linked API page (docs/api/debug.md:248 and :312), so it should not be copied into a block. On line 97, the reason values are not on the linked page either, so this guide is the only hand-written place that lists them. Line 146 has no proposed edit.

## Corrected edit

- Line 138: split into two paragraphs. First: the header, the card and its main figures, per-pass GPU time. Second: the three ways to show it (`createEngine({ stats: true })`, `engine.stats(true)`, `?stats`, and `debug.stats(true)` in the sketch), `debug.frameStats()`, and that both work in production builds. Replace the add-on rows and Memory by system sentences with one short line: "Add-on features and, in a development build, each engine table get rows of their own." Then keep the link to [Debug drawing and stats](../api/debug.md#stats-overlay-and-frame-figures). No details block, because the linked page holds that detail.
- Line 97: keep the first sentence, then a three-row table (`no-surface`, `no-answer`, `failed-to-start` with what each means), then the dev-build warning and the shared-thread cost. Change the last link: the engine page does not describe each value. Point it at the generated reference entry for the render fallback type in docs/api/reference/engine.md, or drop "describes each value".
- Line 124: split at "To see whether shadow edges crawl", as proposed.
- Line 146: turn the object's fields into a short bulleted list, or start a new paragraph at "The panel also shows the frame figures".
