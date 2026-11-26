# guides-1-substance-26

## Finding as given

- Page: guides/car-paint
- Anchor: ## Options table and bullets (lines 51-74)
- Category: missing-content
- Severity: low
- Claim: The page does not say what a weave takes when the look gives weave: {} or some fields (the code fills cells [90, 150], shine 0.85). The table lists seams.shade but no bullet explains it.
- Evidence: examples/addons/car-paint/index.ts:49, 96, 98.
- Proposed edit: weave default: "false. An object fills missing fields from { cells: [90, 150], shine: 0.85 }." Add: "seams.shade is how dark the groove draws, from 0 for none to 1 for black."

Verdict: survives

## Evidence

- docs/guides/car-paint.md:60 gives the weave row as `{ cells, shine }`, or `false`, with default `false`. No line on the page gives the weave's field defaults. The flakes row (line 58) and seams row (line 59) do show their field defaults, so the weave is the only part without them.
- docs/guides/car-paint.md:73-74 explain weave.cells and weave.shine, but give no numbers.
- docs/guides/car-paint.md:62-74: there is a bullet for every field in the table except `seams.shade`. The table lists it at line 59.
- examples/addons/car-paint/index.ts:98: `DEFAULT_WEAVE = { cells: [90, 150], shine: 0.85 }`.
- examples/addons/car-paint/index.ts:111-112: `weave: {}` or a partial weave merges over DEFAULT_WEAVE, so the claim about the code is correct.
- examples/addons/car-paint/index.ts:49: the TSDoc for shade says "How dark the groove draws, from 0 for none to 1 for black." The proposed bullet copies it exactly.
- The page is hand-written, not generated, so the edit goes into docs/guides/car-paint.md.

I could not disprove the finding. Low severity is right: a reader can read the source, but the table is the place they look first.

## Better edit

The same merge applies to flakes and seams (index.ts:109-110). The page does not say that a partial object keeps the defaults for the fields it leaves out. One general sentence covers all three parts, and it keeps the table cell short:

- Weave row default: `false`. A weave object starts from `{ cells: [90, 150], shine: 0.85 }`.
- Add under the table, before the bullets: "A part given as an object keeps the default for each field it leaves out."
- Add after the `seams.width` bullet: "- `seams.shade` is how dark the groove draws, from 0 for none to 1 for black."
