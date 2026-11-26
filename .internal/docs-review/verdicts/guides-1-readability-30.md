# guides-1-readability-30

## Finding as given

- page: guides/audio
- anchor: ## Sources at places, lines 75-96
- category: example-placement
- severity: low
- claim: Line 75 introduces near and far with a waterfall at near 6, far 200, but the code comes at line 93, after a nine-row table and a warning. The table gives the waterfall near 5, far 400, which differs from the example.
- evidence: line 75 'A waterfall heard across a valley might take `near: 6` and `far: 200`.'; line 86 '| A waterfall, which is loud and carries | 5 | 400 |'; line 94.
- proposedEdit: Move the code block (lines 93-96) right after line 75. Make its values match the table, or say why they differ. Keep the table and warning after the code.

Verdict: survives

## Evidence

- docs/guides/audio.md:75 says a waterfall "might take `near: 6` and `far: 200`".
- docs/guides/audio.md:79-89 is a table with nine source rows. Row at line 86 gives a waterfall `near` 5 and `far` 400.
- docs/guides/audio.md:91 is the warning about a `far` that reaches a kilometre.
- docs/guides/audio.md:93-96 is the code, `sound.loop({ file: '/sounds/waterfall.mp3', near: 6, far: 200 })`.
- All line numbers and quotes in the finding match the page.
- No source in the repository sets a waterfall sound's range (the water package draws waterfalls but plays no sound), so nothing explains the difference. The page gives a reader two different answers for the same source, three lines apart in meaning, and does not say which to use. "Heard across a valley" points to a longer range, not a shorter one, so the 200 value does not read as a deliberate case.
- The placement point is weaker on its own (a reader can find the code below), but the code repeats the line 75 example, so it belongs beside it. The move keeps the table and warning intact and breaks no writing rule.

## Corrected edit

Use one set of values. The simplest fix: change line 75 to "`near: 5` and `far: 400`" and the code to `near: 5, far: 400`, then put the code block straight after the line 75 paragraph, before "Choose `far` as ...". The table, the warning and the paragraph on long sources stay in order after it.
