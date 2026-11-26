# Finding concepts-2-substance-27

```json
{
 "page": "concepts/materials",
 "anchor": "## The transparent pass, line 109: \"The quality setting momentTransparency\"",
 "category": "unclear",
 "severity": "low",
 "claim": "Calling it a quality setting leads the reader to try quality.set. It is a createEngine option and a page switch, and it stays fixed while the engine runs.",
 "evidence": "docs/concepts/quality-presets.md:210; docs/api/materials.md:686.",
 "proposedEdit": "\"The momentTransparency option of createEngine, which stays fixed while the engine runs, blends the same surfaces ...\"",
 "generatedSource": "",
 "id": "concepts-2-substance-27",
 "slice": "concepts-2",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/concepts/materials.md:109 says "The quality setting `momentTransparency` blends the same surfaces in a layer of its own ...". It does not say how to turn the setting on or that it stays fixed.
- The "not a quality setting" part of the claim is wrong. `momentTransparency` is a field of `QualitySettings` (packages/engine/src/quality/presets.ts:779-781; docs/api/reference/quality.md:180), which a sketch reads in `quality.settings`. docs/api/quality.md:50 lists it with the settings that `createEngine` options replace and that stay fixed. docs/concepts/quality-preset-tables.md:50 lists it as a setting that changes "at the start". So "quality setting" is the correct term, and the docs use it the same way in five other places (api/materials.md:682, first-use-shaders.md:38, threejs-mapping.json:1057-1058).
- The real gap is smaller: the concepts sentence alone does not say that the page turns the setting on in `createEngine`, so a reader who knows `quality.set` could try it. The link in the same sentence (api/materials.md#moment-transparency, lines 680-693) shows `createEngine({ ..., momentTransparency: true })` and the `?moments=on` switch in its first code block. The cost to a reader is one click. Low severity is right.
- The proposed edit drops the correct term "quality setting" and leaves out the `?moments=` switch. It renames the thing instead of adding the missing fact.

## Corrected claim

`momentTransparency` is a quality setting, so the term is correct. But the sentence does not say that only the `createEngine` option (or the `?moments=` switch) turns it on, at the start, so a reader could try `quality.set`. The linked section answers this.

## Corrected edit

"The quality setting `momentTransparency` blends the same surfaces in a layer of its own, and it is nearer an exact back-to-front blend than the weighted average is. The page turns it on with the `createEngine` option of the same name, and it stays fixed while the engine runs. It draws each surface twice ..."
