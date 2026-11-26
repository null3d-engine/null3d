# api-reference-readability-17

## Finding as given

```json
{
 "page": "api/reference/geometry,api/reference/controls,api/reference/math",
 "anchor": "geometry `EllipseCurve` line 205",
 "category": "missing-content",
 "severity": "medium",
 "claim": "Classes a user constructs show no constructor, so the reader cannot see how to make an EllipseCurve, LineCurve or Shape. The section lists fields such as aX and aStartAngle but not the call that sets them.",
 "evidence": "packages/geometry/src/curves.ts has constructors at lines 55, 106, 140, 191, 247; geometry lines 205-221 show none. membersOf in tools/lib/api-docs.ts never reads the constructor signature.",
 "proposedEdit": "Print the constructor signature in a ts code block under the kind line, such as `new EllipseCurve(aX = 0, aY = 0, xRadius = 1, ...)`, with its comment.",
 "generatedSource": "tools/lib/api-docs.ts",
 "id": "api-reference-readability-17",
 "slice": "api-reference",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- The core claim holds for the geometry page. `docs/api/reference/geometry.md` lines 205-221 (`EllipseCurve`) show the kind line, the summary and a member table, with no constructor. No `new` call or constructor appears for any curve class on that page (grep finds none).
- The cause is right. `membersOf` in `tools/lib/api-docs.ts` (line 220) walks `type.getProperties()` of the instance type, which never holds the constructor. The class branch (lines 448-454) prints only bases and members.
- The constructor comments exist and say useful things the page lacks. `packages/geometry/src/curves.ts` lines 186-200: "Makes the curve. The defaults give a full circle of radius 1 about the origin, drawn counterclockwise." The positional order of eight parameters (`aX, aY, xRadius, yRadius, aStartAngle, aEndAngle, aClockwise, aRotation`) cannot be guessed from the member table. The same goes for `ArcCurve` (line 247), `LineCurve` (55), the Bezier curves (106, 140), `SplineCurve` (269), the 3D curves and `Path` (`path.ts` line 158).
- `Shape` is the weakest example. It has no constructor of its own; it inherits `Path`'s `constructor(points?)`. The linked overview page `docs/api/geometry.md` line 69 shows `new Shape().moveTo(...)`. Still, the reference page does not show it.
- The math page is wrong to include. `docs/api/reference/math.md` has no classes at all: its exports are namespaces such as `mat4`, `quat` and `vec3`, made with `create()`, which the page prints.
- The controls page is wrong to include. Each control class summary names its factory, for example `docs/api/reference/controls.md` line 73: "`createDragControls` makes them", and line 274 for `createOrbitControls`. The constructors take engine-internal arguments: `packages/controls/src/orbit-controls.ts` line 454 takes a `SketchContext` and a private `grabsGround` flag. Printing them would tell readers to call `new OrbitControls(...)`, which the docs do not intend.

## Corrected claim

On the geometry reference page only, the curve and path classes that a user makes with `new` (`LineCurve`, `QuadraticBezierCurve`, `CubicBezierCurve`, `EllipseCurve`, `ArcCurve`, `SplineCurve`, their 3D forms, `CatmullRomCurve3`, `Path` and `Shape`) show no constructor. The reader cannot see the parameter order or the defaults, which the constructor comments already state. The controls page is fine because its classes come from factories that each summary names. The math page has no classes.

## Corrected edit

In `tools/lib/api-docs.ts`, in the class branch, read the construct signatures of the class (use `checker.getTypeOfSymbol(symbol).getConstructSignatures()`, so that `Shape` gets the constructor it inherits from `Path`). Skip a constructor that is private, protected or tagged `@internal`. Print each one as `new Name(params)` in a ts code block under the kind line, followed by the constructor's TSDoc summary. Add the parameter type nodes to `used` so the check for unexported types covers them.

For the control classes, tag the constructors `@internal` in `packages/controls/src/*-controls.ts`, because their factories are the public way to make them. Otherwise the new output prints calls that need a `SketchContext`, and the check for unexported types may flag them.
