# Verdict: api-2-readability-12

## The finding as given

- page: api/quality
- anchor: ## Choosing the preset on the page, table lines 42-57
- category: structure
- severity: medium
- claim: One table mixes ten createEngine options with six URL test switches, and the '?tier=lowest' cell is a 75-word paragraph. A page author must read past test switches to find the options.
- evidence: lines 44-52 are options and lines 53-57 are URL switches; line 54 is the ?tier=lowest row.
- proposedEdit: Split the table into 'Options of createEngine' and 'URL switches for tests and debugging'. Cut the ?tier=lowest cell to one sentence and a link to the lowest quality tier section of the quality presets page.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/api/quality.md:42 heads the table "Option or switch | What it does".
- Lines 44-52 are nine option rows, and lines 53-57 are five URL switch rows. The finding says ten and six; both counts are wrong.
- The option rows come first and the switch rows follow them. A page author does not "read past test switches to find the options". The options are at the top. That part of the claim is false.
- Each switch row says it "wins over" a named option (lines 53, 56, 57). So the two groups are related, and one table with a "switch" header is a fair choice. Two tables would be a little clearer, but this is a matter of taste with a small cost. It is not medium.
- Line 54, the `?tier=lowest` cell, is 71 words in 4 sentences (counted from the cell text). stats.json does not list it, because it measures paragraphs, not table cells. It is the longest cell in the table by far.
- Every fact in that cell is also in docs/concepts/quality-presets.md:319-327 ("The lowest quality tier"): the third-size render scale floor, no sun shadows, no bloom, reflections at a quarter of the render size, the depth prepass off on WebGL2, the presets keep their values, and the governor enters the tier when frames still miss at the floor. Line 327 there names `?tier=lowest` itself. The anchor `../concepts/quality-presets.md#the-lowest-quality-tier` exists and line 71 of the same page already links to it.
- So the cut loses no information. A details block is not needed, because the linked section holds the detail.

## Corrected claim

The `?tier=lowest` cell (line 54, 71 words) repeats the lowest quality tier section of the quality presets page and makes the table hard to scan. The table holds nine option rows and then five URL switch rows. The options come first, so a reader does not have to read past the switches. A split into two tables is optional polish.

## Corrected edit

Cut the line 54 cell to one sentence with a link:

| `?tier=lowest` | Starts in the [lowest quality tier](../concepts/quality-presets.md#the-lowest-quality-tier), for tests and weak devices. |

Optionally, split the table after line 52, with a short lead-in such as "URL switches set the same choices for tests. Each wins over its option:". Severity: low.
