# start-readability-26

## Finding as given

```json
{
 "page": "getting-started/cdn",
 "anchor": "lines 111, 150, 226",
 "category": "duplication",
 "severity": "low",
 "claim": "The rule that a worker does not read the page's import map, so the sketch imports by full address, appears three times.",
 "evidence": "cdn.md line 111, line 150, line 226.",
 "proposedEdit": "Keep it once in ## Import maps (line 150) with the reason; at 111 and 226 keep only a link to #import-maps.",
 "generatedSource": "",
 "id": "start-readability-26",
 "slice": "start",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- docs/getting-started/cdn.md is a hand-written page, so the edit goes in the page itself.
- Line 111 (under "One HTML file"): "It imports the engine from the CDN by its full address. That works in a worker too, where a page's import map does not reach."
- Line 150 (under "Import maps"): "A worker does not read the page's import map. A sketch that runs in a worker imports the engine by its full address."
- Line 226 (under "Add-ons from the CDN"): "An import map can name an add-on for the page's own modules, but a worker reads no import map. Name the add-on by its full address in the sketch, as the example does."
- The finding misses a fourth copy. Line 187, which opens "Add-ons from the CDN", says: "A page imports it by its full address, as it imports the engine, so a sketch in a worker reaches it too." So the add-ons section says the same thing twice, at 187 and 226.

What holds: the rule really repeats. The worst case is inside the add-ons section, where 187 and 226 say the same thing.

What does not hold:
- The count is wrong. The rule appears four times, not three.
- "Only a link" at 111 is too much. Line 111 tells the reader why the example uses a full address. The import maps section comes later, at line 129. If 111 shrinks to a bare link, the example's choice goes unexplained at the point where the reader sees it.
- Line 226 carries the one instruction for add-ons in an import-map setup: "Name the add-on by its full address in the sketch". A bare link would drop that instruction. Line 187 states it as a fact, not as a step to take.

## Corrected claim

The worker and import map rule appears four times on the page: lines 111, 150, 187 and 226. Two of those copies, 187 and 226, sit in the same add-ons section.

## Corrected edit

- Line 150: keep the full rule here, in "Import maps".
- Line 111: keep one short clause that explains the example, with a link. For example: "It imports the engine from the CDN by its full address, which also works in a worker ([Import maps](#import-maps))."
- Lines 187 and 226: say it once in the add-ons section. Keep 187 as it is. Cut 226 down to the part that is new: "An import map can name an add-on for the page's own modules, but not for a sketch in a worker ([Import maps](#import-maps))."
