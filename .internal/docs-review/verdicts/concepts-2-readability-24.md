# concepts-2-readability-24

Finding as given:

```json
{
 "page": "concepts/post-processing",
 "anchor": "## Screen-space bounce light, bullet line 329 and ### Cost line 337",
 "category": "duplication",
 "severity": "medium",
 "claim": "The same timings appear twice at different precision. The bullet gives '2.475 ms ... 1.326 at Ultra ... 0.825 ms' (one figure without its unit) and the Cost section gives '2.5 ms ... 1.3 ms ... 0.8 ms'. Stray double blank lines at 311-312 and 338-339.",
 "evidence": "Lines 329 and 337.",
 "proposedEdit": "Remove the timing sentence from the bullet at 329. Keep the Cost section's rounded figures with units. Remove the extra blank lines.",
 "generatedSource": "",
 "id": "concepts-2-readability-24",
 "slice": "concepts-2",
 "role": "readability"
}
```

Verdict: survives

Evidence:
- Generated copy, docs/concepts/post-processing.md:329 ends: "At 1920 by 1080 the light costs 2.475 ms at High and 1.326 at Ultra on WebGPU, and 0.825 ms at WebGL2's Medium." The Ultra figure has no unit.
- Same file :337 (### Cost, eight lines later): "At 1920 x 1080 on the Mac it added 2.5 ms at High and 1.3 ms at Ultra on WebGPU. It added 0.8 ms at WebGL2's Medium." Same three numbers, rounded. The two sentences also spell the size differently ("1920 by 1080" and "1920 x 1080").
- Lines 311-312 and 338-339 are both pairs of empty lines before the next `##` heading. They render the same as one blank line, so that part is polish only.
- The page is hand-written, not generated. The worktree copy holds the same text at docs/concepts/post-processing.md:327 and :335. No other page or skill repeats the 2.475 or 1.326 figures.
- The edit breaks no writing rule. Every other feature on the page keeps its timings in its own "### Cost" section (for example the reflections at :307), so moving the bounce-light figures out of the bullet matches the page's pattern. The bullet still makes sense without the sentence.

Side note, not part of this finding: both places say High (4 rays) costs more than Ultra (8 rays). A reader may take that for a typo. Someone should check the measurement, or the page should say why.

Severity: medium is slightly generous. The figures do not conflict; only their precision differs. Low to medium is fair.

Corrected edit: as proposed. Optionally, while editing the Cost section, use "1920 by 1080" or "1920 x 1080" consistently with the rest of the page.
