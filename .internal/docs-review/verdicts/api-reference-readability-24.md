# Verdict: api-reference-readability-24

## Finding as given

```json
{
 "page": "api/reference/controls",
 "anchor": "lines 43 `createMapControls`, 51 `createOrbitControls`, 132 `FirstPersonControls`, 187 `FlyControls`",
 "category": "scan-order",
 "severity": "medium",
 "claim": "Gestures are listed in prose, and each create function is far from its class and options. OrbitControls has 47 members in one table.",
 "evidence": "stats.json controls 36 and 44 (39 words, 5 sentences each), 125 (73 words), 180 (79 words). create* at lines 13-53; classes at 69-389. Sources packages/controls/src/orbit-controls.ts:1311, 1326; first-person-controls.ts:109; fly-controls.ts:40.",
 "proposedEdit": "Write gestures as an Input | Action table (left drag or one finger, wheel or pinch, right drag or two fingers). Order by control: createOrbitControls, OrbitControls, OrbitControlsOptions, then the next. Group OrbitControls members into state, limits and methods.",
 "generatedSource": "packages/controls/src/orbit-controls.ts",
 "id": "api-reference-readability-24",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The facts hold. The OrbitControls table has 47 rows (docs/api/reference/controls.md lines 270-325). The create functions sit at lines 13-59, and their classes and options come later, at lines 69-457.
- The gesture table already exists. The reference page links its concept page at line 11. That page (docs/api/controls.md) has an Input table for orbit and map controls at lines 54-62, one for fly controls at lines 154-162, and one for first-person controls from line 185. A second table in the TSDoc summary would copy it onto a lookup page. The orbit and map summaries are 39 words each, so they are short.
- The order does not come from orbit-controls.ts. tools/lib/api-docs.ts:471 sorts every reference page's symbols by name (`symbols.sort((a, b) => a.name.localeCompare(b.name))`). A per-control order needs a change to that generator, and the change applies to every reference page, not only this one. The finding names the wrong source.
- The OrbitControls members are already partly grouped. All properties come first and all methods after them (from `update` on). The concept page also groups the options by purpose in its Options table (docs/api/controls.md lines 83-98).
- With the gesture part and the methods grouping removed, what is left is the create-far-from-class order. That is polish (low), not medium.

## Corrected claim

The create functions sit far from their classes because the reference generator sorts every page by name, and OrbitControls has 47 members in one table. The gestures do not need a table here, because the linked concept page already has gesture tables for each control. Severity: low.

## Corrected edit

Drop the gesture table. If an ordering change is wanted, make it in tools/lib/api-docs.ts (line 471): sort each `create*` factory directly before the class it returns, then that class's options. This applies to all reference pages. Optionally, the OrbitControls TSDoc can point to the concept page's Options and Gestures sections. A state and limits split of the properties is not needed, because the concept page already groups them.
