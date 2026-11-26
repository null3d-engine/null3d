# guides-1-readability-28

## Finding as given

- Page: guides/car-paint
- Anchor: ## How the parts draw line 78; ## Cost line 100
- Category: technical-details-block
- Severity: low
- Claim: Line 78 (125 words, 7 sentences) explains the glint model; the user's point is that flakes sparkle up close and look like smooth metal far away. Line 100 lists per-pixel costs in a paragraph.
- Evidence: stats.json lines 71 (125 words, 7 sentences), 93 (77, 5).
- Proposed edit: Keep line 78's first sentence and add the user-facing point; move footprint counting and the lobe average into `<details><summary>Technical details: the glint model</summary>`. Make line 100 a table (part, cost per pixel, cost per light) and keep the 'no flakes, seams or weave' sentence.

## Verdict: partly

## Evidence

- The stats line numbers (71, 93) count from after the front matter. They match page lines 78 and 100 of docs/guides/car-paint.md. Both paragraphs are long, as the stats say.
- The paragraph at line 78 already states the user-facing point. Sentence 4 says a pixel draws no highlight or a bright spot (the sparkle up close). Sentence 5 says "a car far away draws as smooth metal, without shimmering as it moves". The point does not need to be added. It needs to be kept in the main text.
- Sentence 5 joins the implementer fact ("The count's average is the smooth lobe") with the user result. The edit says to move "the lobe average" into the block. If the whole sentence moves, the main text loses the far-away result.
- Sentences 6 and 7 (the sparkle follows each light; the clear coat keeps its own smooth normal) are user-facing too. The edit keeps only sentence 1, so it would hide them in the block.
- The source agrees with the page: examples/addons/car-paint/paint.wgsl lines 2-3 and 169-172 (Deliot and Belcour's count in the lobe), lines 40-43 and 94 (the footprint from derivatives), line 107 (seam width from fwidth). So no fact is wrong. The issue is only layout.
- Line 100: the costs do not fit a "cost per pixel / cost per light" table. Only the flakes' lobe has a stated per-light cost. The seams and weave have none, and the weave's cost is given as "its own pattern, slope and roughness change", with no unit. Most cells would be empty or vague. The counts of hashes and derivatives are implementer detail, so a details block fits the user's request better than a table.

## Corrected claim

Line 78 already makes the user-facing point (sparkle up close, smooth metal far away), but it is mixed with the counting method. Line 100 gives implementer-level costs (derivatives, hashes) in one paragraph.

## Corrected edit

Line 78: keep in the main text sentence 1, the sparkle result (a pixel draws no highlight or a bright spot), the far-away result without the "count's average is the smooth lobe" clause, the "sparkle follows each light" sentence and the clear coat sentence. Move sentences 2 and 3 (the footprint of flake cells and the count of flakes that reflect a light) and the "count's average is the smooth lobe" fact into
`<details><summary>Technical details: the glint model</summary>`.

Line 100: keep one plain sentence in the main text, for example "The flakes add a small cost for each light. The seams and the weave add a small cost for each pixel." Keep the "no flakes, seams or weave" sentence. Move the derivative and hash counts into
`<details><summary>Technical details: what each part costs</summary>`. Do not use a table.
