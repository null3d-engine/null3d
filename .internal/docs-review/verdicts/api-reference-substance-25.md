# api-reference-substance-25

## Finding as given

```json
{
 "page": "api/reference/geometry,api/reference/impostors,api/reference/water,api/reference/terrain",
 "anchor": "geometry.md:360 `LevelBounds.centre`; impostors.md 'colour' (11 times)",
 "category": "unclear",
 "severity": "low",
 "claim": "British and American spelling mix. The API field LevelBounds.centre differs from MeshGeometry.center on the same page, so a user can type the wrong name.",
 "evidence": "packages/engine/src/scene/level-rule.ts (centre); packages/impostors/src/*.ts; counts: colour impostors 11, water 2, terrain 1; centre geometry 3.",
 "proposedEdit": "Write 'color' and 'center' in TSDoc, and rename LevelBounds.centre to center.",
 "generatedSource": "packages/engine/src/scene/level-rule.ts, packages/impostors/src/*.ts, packages/water/src/*.ts, packages/terrain/src/*.ts",
 "id": "api-reference-substance-25",
 "slice": "api-reference",
 "role": "substance"
}
```

Verdict: survives

## Evidence

- The counts hold. In the generated pages: geometry.md has "centre" 3 times (lines 356, 360) beside "center" 18 times and "centered" 10 times. impostors.md has "colour" 11 times and "colours" 2 times. water.md has "colour" 2 times. terrain.md has "colour" 1 time.
- The field name clash is real. geometry.md:360 lists `readonly centre` on `LevelBounds`. geometry.md:487 lists `readonly center` on the mesh bounds on the same page. The source is packages/engine/src/scene/level-rule.ts:71-73. `LevelBounds` and `levelDistances` are public exports (packages/engine/src/index.ts:192, 200), so users type this name.
- The mix is worse on impostors.md: the prose says "colour" right beside fields named `color` (impostors.md:164, 181, 230). A reader sees two spellings for one thing in one table row.
- The project already has the rule. tools/lib/docs-style.ts:172-178 says "the docs spell every word the American way" and matches colour, centre and others. It runs on every docs/ page (tools/hooks/check-docs-style.ts isStyleChecked), but only as a warning, so these generated pages pass with the British words in them. Code spans are exempt, which is why the field `centre` itself is not caught.
- I found no rule or page that this edit would break. Severity low fits: it is polish, with a small real cost (a wrong field name in a typed object literal gives a type error).

## Notes for the edit

The proposed edit is right. The rename of the field must also update its users:
- packages/engine/src/scene/level-rule.ts:178 (`bounds.centre`) and the TSDoc at lines 66, 72, 99, 173.
- packages/engine/src/scene/level-rule.test.ts:86-129 (object literals with `centre:`).
- examples/showcase/creek/valley.ts:243 (`centre:` key passed to `levelDistances`).

The `Card.centre` field in packages/engine/levels/planner.d.ts is an internal asset tool type that the API pages do not show; it is out of scope for this finding.
