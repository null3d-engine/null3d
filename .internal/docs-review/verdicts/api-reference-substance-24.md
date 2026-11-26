# api-reference-substance-24

## Finding as given

- page: api/reference/time, api/reference/scene, api/reference/engine
- anchor: e.g. time.md '## `SketchTime`' then 'Interface `SketchTime`.'
- category: duplication
- severity: low
- claim: Each interface and class repeats its heading in a line 'Interface `X`.', which adds only the kind.
- evidence: tools/lib/api-docs.ts:492.
- proposedEdit: Print the kind alone ('Interface.' or 'Class, extends `Object3D`.') or move the kind into the page index table.
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- tools/lib/api-docs.ts:486-493 (renderSymbol): when an export has no signature, it writes the heading `` `Name` `` and then the line `` Kind `Name`[, which extends `Base`]. ``. The name is repeated word for word. The line does carry the kind, and for some exports the base type.
- Generated pages confirm it: time.md:13-15 (SketchTime), scene.md:13-15 and others, engine.md:15 ("Interface `CapabilityReport`, which extends `DeviceHints`."), engine.md:135 ("Class `EngineError`, which extends `Error`.").
- The pattern is not limited to the three named pages. 424 such lines appear across all docs/api/reference/*.md pages. renderSymbol is the single source for all of them (called through renderReference from tools/lib/docs.ts:579).
- The reference pages have no index table. scene.md:1-12 goes from the front matter and one pointer line straight to the first export heading. So the second option, "move the kind into the page index table", points at something that does not exist.
- tools/lib/api-docs.test.ts:258 asserts the current text ("Class `Child`, which extends `Base`."), so that test must change with the edit.
- The cost to a reader is small (one redundant name per type), so low severity is right.

## Corrected claim

On every API reference page (424 exports, not only time, scene and engine), each interface, class and namespace heading is followed by a line that repeats the name. That line adds only the kind and, when there is one, the base type.

## Corrected edit

In renderSymbol (tools/lib/api-docs.ts), print the kind without the name: "Interface." / "Class, which extends `Error`." / "Interface, which extends `DeviceHints`." Update the expectation at tools/lib/api-docs.test.ts:258. Drop the "page index table" option, because the reference pages have no index table.
