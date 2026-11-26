# Verdict for api-3-readability-07

## The finding as given

```json
{
 "page": "api/render",
 "anchor": "## Errors, E1220 row, line 474",
 "category": "wall-of-text",
 "severity": "medium",
 "claim": "The E1220 cell lists about 25 causes in one run of sentences inside a table cell. A reader cannot find the cause of the error they got.",
 "evidence": "line 474 'Options that render.addPass does not take, a writes or name that another pass has, or a 32nd pass. Both a size and a scale ...' and ends with eight call names.",
 "proposedEdit": "Make the row 'E1220 | An option or value that a pass does not take. The list below gives each cause.' Under the table add a list grouped by Any pass, Scene passes, Reflection passes, Full-screen passes, Compute passes, render.readPass, and Calls given something that is not a pass, one cause per bullet.",
 "generatedSource": "",
 "id": "api-3-readability-07",
 "slice": "api-3",
 "role": "readability"
}
```

Verdict: survives

## Evidence

- docs/api/render.md:474 is one table cell of 9 sentences. I count 24 separate causes, so "about 25" holds. It ends with a list of eight calls (`render.setPassEnabled` to `textures.fromPass`).
- The page is hand-written (docs/api/render.md, not docs/api/reference/), so the edit goes straight into this file. No generated source is involved.
- Nothing else on the page sorts these causes. Lines 432 to 436 (readPass) and 445 (layers, WebGL2 fallback) mention a few of them inside their own sections, but not as a lookup list.
- The linked-by-code error page docs/errors/E1220.md does not help either. It is one long paragraph too, and it lists fewer causes (no reflection, history, steps, layers or readPass causes).
- A grouped list under the table is plain Markdown, breaks no writing rule and fits the website contract. It should stay open, not go in a collapsible block: a reader who gets the error needs exactly this list.

## Correction to the proposed edit (placement only)

- "Both a `size` and a `scale`" applies to scene, full-screen and compute passes (docs/api/render.md:47-48, 208-209, 300-301). Put it under "Any pass", not under "Scene passes". Keep "a scene pass with neither" under "Scene passes".
- "`render.setPassSteps` or `render.resetPass` on a pass of another kind" and "more than one step of a pass without history" belong under "Compute passes" (or the calls group), not split across groups.
- The new row text should also cover the wrong-call causes, for example: "E1220 | An option that a pass does not take, or a call given something that is not a pass of the right kind. The list under the table gives each cause."
