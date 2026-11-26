# concepts-1-substance-04

Finding as given:

```json
{
 "page": "concepts/instances",
 "anchor": "## Limits, last bullet, line 204 \"A hull of 72 vertices drawn 30,000 times is 2,165,760 vertex shader runs\"",
 "category": "wrong-claim",
 "severity": "medium",
 "claim": "The sum is wrong. 72 times 30,000 is 2,160,000. The figure 2,165,760 is 72 times 30,080.",
 "evidence": "Arithmetic: 72 x 30,000 = 2,160,000; 2,165,760 / 72 = 30,080.",
 "proposedEdit": "'A hull of 72 vertices drawn 30,000 times is 2,160,000 vertex shader runs for one pass.'",
 "generatedSource": "",
 "id": "concepts-1-substance-04",
 "slice": "concepts-1",
 "role": "substance"
}
```

Verdict: survives

Evidence:
- docs/concepts/instances.md:204 says exactly "A hull of 72 vertices drawn 30,000 times is 2,165,760 vertex shader runs for one pass".
- Shell arithmetic: 72 x 30,000 = 2,160,000; 72 x 30,080 = 2,165,760. The page's figure does not match its own inputs.
- No other text in the repository uses 2,165,760, so the figure is not a quoted measurement that the page explains elsewhere. The page is hand-written, so there is no generated source to edit.
- The same bullet ends "the same mesh with 24 vertices does a third of that work". 24 x 30,000 = 720,000, which is exactly one third of 2,160,000. The corrected figure also makes that sentence exact.
- Severity medium is fair: a reader who checks the sum loses trust in the page's numbers, but the point of the bullet still holds.

Corrected edit: as proposed. Change "2,165,760" to "2,160,000" on line 204 and keep the rest of the sentence.
