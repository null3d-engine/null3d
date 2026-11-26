# Verdict on api-1-readability-10

## The finding as given

- Page: api/debug
- Anchor: ### The card (lines 226-250); ### Memory figures (line 312)
- Category: heading-depth. Severity: medium.
- Claim: Eight bold run-in labels act as hidden H4 headings: The target, The work bars, The thread modes, The colors, Held back by, The add-ons' rows, Figures that the browser gives, and Memory by system. They do not show in the outline, and no link can point at them. The reader sees one 37-line block under one H3.
- Evidence: In the stats.json outline, nothing sits under '### The card'. Bold labels open debug.md:226, 228, 236, 244, 246, 248, 250 and 312.
- Proposed edit: On the new stats page, make 'The card' an H2 and each label an H3 (The target, Work bars, Thread modes, Colors, Held back by, Add-on rows, Figures that the browser gives). Make 'Memory by system' an H3 under 'Memory figures'. Turn 'The colors' into a table Color | Work bar | Memory bar | Time.

Verdict: partly

## Evidence

- The eight bold labels exist at docs/api/debug.md lines 226, 228, 236, 244, 246, 248, 250 and 312. The stats.json outline has no heading between "### The card" (line 213) and "### Triangles and objects" (line 291). The core claim holds: the labels act as headings, they do not show in the outline, and no link can point at them.
- debug.md is the only page under docs/ that uses bold run-in labels of this form, and no page under docs/ uses an H4. So the labels are also out of line with every other page.
- The "37-line block" figure is wrong. "### The card" runs from line 213 to line 290, about 78 lines: a paragraph, a table, a paragraph, the eight labelled paragraphs (lines 226 to 250), the `debug.frameStats()` text, a code sample and a 20-row table.
- The proposed edit has three faults:
  1. Scope of "Figures that the browser gives". The text after line 250 is not about browser figures. Lines 252 to 290 describe `debug.frameStats()`, with a code sample and the figures table. If line 250 becomes a heading and nothing follows it, all of that falls under "Figures that the browser gives", and the outline then misleads. The edit needs one more heading before line 252, such as "Frame figures in the sketch".
  2. Scope of "Memory by system". Line 314 ("Some browsers offer the measurement but never answer it...") continues the whole-page measurement paragraph at line 310. It is not about the per-system rows. If line 312 becomes a heading, line 314 falls under the wrong heading. Move line 314 up to follow line 310 before adding the heading.
  3. Dependency on the page split. The edit only works if finding api-1-readability-4 (move the stats sections to a new api/stats page) is accepted. On the current page, "The card" is an H3 under "## Stats overlay and frame figures", so the labels would need to be H4s, which no docs page uses. The edit must say what to do in both cases.
- The colors table, Color | Work bar | Memory bar | Time, mixes two color systems in one grid. Blue, purple and green name who did the work or owns the memory. Green, amber and red name time against the target. The paragraph also gives the amber chrome and the ring gauge's 90% and 75% limits, and the proposed columns have no place for them. A table is fine, but it needs a "Ring gauge" column, or two short tables (part colors; status colors).

## Corrected claim

Eight bold run-in labels on api/debug (lines 226 to 250 and 312) act as hidden headings. They are absent from the outline, no link can point at them, and no other docs page uses this form. "### The card" runs about 78 lines (213 to 290) with no subheading.

## Corrected edit

- If the stats sections move to their own page (finding api-1-readability-4): make the current H3s there ("The card", "Triangles and objects", "Memory figures", "GPU memory", "Cost") H2s. Turn each bold label into an H3 in sentence case: "The target", "Work bars", "Thread modes", "Colors", "Held back by", "Add-on rows", "Figures that the browser gives", and "Memory by system" under "Memory figures".
- If the page is not split: keep "### The card", and turn the labels into H3 siblings after it with no H4. For example, "### The target and the work bars", "### Thread modes", "### Colors", "### Held back by", "### Add-on rows" and "### Figures that the browser gives".
- In both cases: add a heading such as "Frame figures in the sketch" before line 252 (`debug.frameStats()`), so its code sample and figures table do not sit under "Figures that the browser gives". Move line 314 up to follow line 310, before the "Memory by system" heading.
- Colors: use a table with the columns Color | Work bar part | Memory bar part | Time against the target | Ring gauge, or two short tables. Keep the line about the amber chrome as one sentence under the table.
