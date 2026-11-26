# api-reference-substance-03

## Finding as given

- page: api/reference/sketch, api/reference/engine
- anchor: sketch.md:29-32 `SketchCallbacks`; engine.md:104 `inspect`
- category: wrong-claim
- severity: high
- claim: Optional methods print as required. SketchCallbacks shows onFixedUpdate, onUpdate, onLateUpdate and onDestroy with no '?', so a newcomer thinks a sketch must return all four. Engine.inspect prints as always present, though its text says release builds leave it out.
- evidence: packages/engine/src/sketch/define-sketch.ts:38,45,52,58 declare them optional; packages/engine/src/page/engine.ts:801 `inspect?(`. tools/lib/api-docs.ts:164-188 (callableOf) never adds '?', while propertyOf (:190-215) does.
- proposedEdit: In membersOf, pass the member's ts.SymbolFlags.Optional flag to callableOf and print `name?(...)`.
- generatedSource: tools/lib/api-docs.ts

Verdict: survives

## Evidence

- docs/api/reference/sketch.md:29-32 print `onFixedUpdate(step: number): void`, `onUpdate(dt: number): void`, `onLateUpdate(dt: number): void` and `onDestroy(): void`, with no '?'. No text in the SketchCallbacks section says the members are optional.
- packages/engine/src/sketch/define-sketch.ts declares all four as optional method signatures (`onFixedUpdate?(`, `onUpdate?(`, `onLateUpdate?(`, `onDestroy?(`).
- docs/api/reference/engine.md:104 prints `inspect(call: string, args?: unknown): Promise<unknown>`; packages/engine/src/page/engine.ts declares `inspect?(call: string, args?: unknown)`. The member text does say a release build leaves it out, so the signature contradicts the text on the same row.
- tools/lib/api-docs.ts: `callableOf` (about lines 164-188) builds `${name}${generic}(...)` and never reads the optional flag. `propertyOf` (about line 203) reads `member.flags & ts.SymbolFlags.Optional` and adds '?'. `membersOf` sends every method declaration to `callableOf`.
- No row in any docs/api/reference page prints `name?(`, while the package sources hold 17 optional method signatures outside tests, so the defect is general, not only these two pages.
- Mitigation checked: guides such as docs/guides/physics.md return objects with only some callbacks, and `SketchSetup` (sketch.md:110) may return undefined. These help a reader who reads the guides, but the reference page itself still states a wrong signature. The severity could be argued as medium for SketchCallbacks because the examples show partial returns; for `inspect` the wrong signature tells a TypeScript user they can call it without a check, which the type checker would reject, so the row contradicts itself.

## Corrected edit

The proposed edit is right. In `membersOf`, compute `member.flags & ts.SymbolFlags.Optional` once and pass it to `callableOf`, which prints `${name}?${generic}(...)` when it is set (`declaration.questionToken` on a method signature would work too). This fixes every optional method in the reference, not only these two.
