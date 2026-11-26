# api-reference-substance-02

## Finding as given

```json
{
 "page": "api/reference/geometry,api/reference/tasks,api/reference/engine",
 "anchor": "geometry.md:58 `CatmullRomCurve3`, :542 `Path`, :656 `Shape`",
 "category": "missing-content",
 "severity": "high",
 "claim": "Class constructors are missing from every page. A reader cannot learn the arguments of new CatmullRomCurve3(...), new Shape() or any curve class. The written docs show a constructor only once.",
 "evidence": "packages/geometry/src/curves.ts:55,106,140,191,247,269,304,357 declare public constructors. tools/lib/api-docs.ts:220-247 (membersOf) reads only type.getProperties(). No 'constructor' text in docs/api/reference/*.md.",
 "proposedEdit": "In readApi, for a class read the construct signatures of its static type (skip private ones) and render each first in the member table as `new Name(params)`, with the constructor's TSDoc summary. Add a docs-check problem for a public constructor with no summary.",
 "generatedSource": "tools/lib/api-docs.ts",
 "id": "api-reference-substance-02",
 "slice": "api-reference",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- The main claim holds. `membersOf` (tools/lib/api-docs.ts:220-249) walks only `type.getProperties()` on the instance type. Construct signatures are never read. The reference pages list 70+ classes ("Class `X`" lines), and none of them shows a `new X(...)` row. Examples: geometry.md:58-70 (`CatmullRomCurve3`), :542-560 (`Path`), :656-664 (`Shape`).
- The curve constructors are public and already have TSDoc summaries that the generator drops. Examples: curves.ts:139 "Makes the curve. Each point defaults to (0, 0).", and curves.ts:187-190 for `EllipseCurve`. `Path` takes `points?` (path.ts:158). `Shape` (path.ts:316) has no constructor of its own and inherits the one from `Path`.
- The written page does not fill the gap. docs/api/geometry.md:83 names `CatmullRomCurve3` and the other curves but gives no arguments. So a reader cannot find the parameter order of `EllipseCurve` (8 positional arguments) or `CatmullRomCurve3` without reading the source.
- "The written docs show a constructor only once" is wrong. Written pages call constructors in several places: `new Shape()` (api/geometry.md:69), `new FeatureHost(...)` (guides/add-ons.md:80, api/features.md:195, api/feature-effects.md:68), `new FeatureRegistry()` (api/features.md:35), `new StatsPanel(canvas, options)` (api/debug.md:344, :362), `new PageMemorySampler()` (api/debug.md:361) and `new LightProbeGridData(...)` (api/scene.md:350).
- The proposed edit is not safe as written. "Skip private ones" is not enough. Most engine class constructors are public in TypeScript but tagged `@internal`: scene.ts:351, :1111, :1911, :2028, :2118, :2776, :3764, textures.ts:347, :493, resources.ts:460, :4123, :4496. Users get these objects from factory calls such as `scene.createMesh`. If the edit skips only `private`, the pages would show `new Mesh(...)`, `new Camera(...)` and `new Texture(...)` as public API, which would mislead readers. The filter must use the existing `isHidden` check (private, protected, `#name`) and the `isInternal` check (api-docs.ts:94, :134) on each constructor declaration.
- Pages: tasks and engine are weak examples. `TaskFailure` (shared/task-failure.ts:19), `TaskLoadError` (no own constructor) and `EngineError` (errors/engine-error.ts:109) are errors that the engine throws and the app catches. Their constructors have no TSDoc. The proposed docs check would flag them, so each one needs a summary or an `@internal` tag. The real gap is on geometry (all curve and path classes), plus classes that users build themselves, such as debug (`StatsPanel`, `PageMemorySampler`), features (`FeatureHost`, `FeatureRegistry`) and scene (`LightProbeGridData`).

## Corrected claim

The API reference never shows a class constructor, because the generator reads only instance members. This hides the public, documented constructors that users call. The worst case is the geometry curves and paths: for example, `EllipseCurve` takes 8 arguments by position, and `CatmullRomCurve3` and `Path` also need theirs. The written docs give no arguments for these. Other user-built classes are affected too: `StatsPanel`, `PageMemorySampler`, `FeatureHost`, `FeatureRegistry` and `LightProbeGridData`. The written docs do show some constructors in examples, so the claim that they show only one is wrong. Most engine classes have `@internal` constructors and must stay hidden.

## Corrected edit

In tools/lib/api-docs.ts, for a class declaration, read the construct signatures of its static type: `checker.getTypeOfSymbolAtLocation(symbol, declaration).getConstructSignatures()`. Inherited signatures are included, so `Shape` shows `new Shape(points?)`. Drop a signature when its declaration fails `isHidden` (private, protected) or has an `@internal` tag. Also drop the implicit signature of a class whose base constructor is hidden or internal. Render each signature that is left as the first row of the member table, as `new Name(params)`, with the constructor's TSDoc summary. In the docs check, flag a shown constructor that has no summary. Then either add summaries or mark `@internal` on `TaskFailure`, `EngineError` and any other constructor that users do not call.
