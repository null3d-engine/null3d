# concepts-2-substance-28

Finding as given:

```json
{
 "page": "concepts/shadows",
 "anchor": "## A hero shadow, line 392: \"the demo's 4.4 m car\"",
 "category": "unclear",
 "severity": "low",
 "claim": "The text says \"the demo\" but does not name it. The demo appears only in Related pages.",
 "evidence": "docs/concepts/shadows.md:392, 448.",
 "proposedEdit": "\"the [hero shadow demo](https://github.com/null3d-engine/null3d/tree/main/examples/hero-shadow/)'s 4.4 m car\".",
 "generatedSource": "",
 "id": "concepts-2-substance-28",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: survives

Evidence:
- docs/concepts/shadows.md lists "demo" only twice: line 392 ("the demo's 4.4 m car") and line 448 (the Related pages link). The section "A hero shadow" (line 360 on) never introduces a demo before line 392, so "the demo" has nothing to refer to.
- The demo exists: examples/demos.ts:539-546 has name 'hero-shadow', code 'hero-shadow/', a car on a launch pad. So the link target in the edit is right and matches the website contract (code value 'hero-shadow/').
- The page is hand-written, not generated, so no generated source is needed.
- Severity low fits: a reader can guess the demo from the Related pages, but only after reaching the end.

Edit note: the claim holds. The proposed wording puts a possessive after a link ("...demo](...)'s"), which reads badly and can render oddly. Better wording:

"At those defaults the 4.4 m car in the [hero shadow demo](https://github.com/null3d-engine/null3d/tree/main/examples/hero-shadow/) gets at least four times the texel density of the cascade that holds 10 m, on every preset."
