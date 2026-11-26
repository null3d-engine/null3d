# api-reference-substance-17

## The finding as given

- page: api/reference/particles, api/reference/geometry, api/reference/math
- anchor: particles.md:21 `EmitterShape` and :122 `ParticleEmitterShape`; geometry.md:823 and math.md:174 `Vec2Like`
- category: duplication
- severity: medium
- claim: EmitterShape (@null3d/particles) and ParticleEmitterShape (engine) have the same union and the same 100-word text on one page. Two Vec2Like types, one per package, carry different explanations. A reader cannot tell whether they differ.
- evidence: packages/particles/src/system.ts:46; packages/engine/src/scene/particles.ts:229; packages/geometry/src/types.ts:9; packages/engine/src/math/types.ts:11.
- proposedEdit: In @null3d/particles write `export type EmitterShape = ParticleEmitterShape` with a one-line summary. In @null3d/geometry re-export the engine's Vec2Like rather than declare its own.
- generatedSource: packages/particles/src/system.ts, packages/geometry/src/types.ts

Verdict: survives

## Evidence

- particles.md:21 (`EmitterShape`) and particles.md:122 (`ParticleEmitterShape`) are both on the particles page. The two unions are the same, member for member (packages/particles/src/system.ts:46-51, packages/engine/src/scene/particles.ts:229-234).
- The two texts are nearly the same. The only difference: the particles copy adds "as a fountain or a flame does" to the cone sentence. So "the same text" is true in practice, not word for word. This does not weaken the finding.
- They are the same thing at run time too. The particles package passes its `shape` option straight to the engine core (packages/particles/src/system.ts:191). The page also uses both names for the same option: particles.md:110 `shape?: ParticleEmitterShape` and particles.md:262 `shape?: EmitterShape`, each with the same description. A reader sees two names and two sections for one thing.
- Vec2Like: geometry.md:823 and math.md:174 each have their own section. The type is the same in both (`{ [index: number]: number }`), but the text is not: geometry says "A 2D vector (x, y)... The package reads its first two elements" (packages/geometry/src/types.ts:3-9). Math says "A point or a direction (u, v), such as a texture coordinate... A helper that reads it reads its first two elements" (packages/engine/src/math/types.ts:5-11). The engine exports its Vec2Like (packages/engine/src/index.ts:53). Geometry exports its own (packages/geometry/src/index.ts:45).
- The proposed edit can be done. Both packages already depend on @null3d/engine as a peer dependency and import types from it (particles system.ts:16-26; geometry curves.ts:5 and math.ts:5 import Vec3Like from the engine).
- Effect on the generated pages (tools/lib/api-docs.ts):
  - The generator lists one symbol once when two entry points export it under the same name (api-docs.ts:411-416). If geometry re-exports the engine's Vec2Like, the geometry page loses its own Vec2Like section. Only the math page's section stays.
  - `type EmitterShape = ParticleEmitterShape` is its own alias declaration, so it keeps its own section. ParticleEmitterShape is exported, so the generator does not expand it (aliasOf, api-docs.ts:288-309; expand at :457). The section shows `type EmitterShape = ParticleEmitterShape;`, which is what the finding wants.
  - The generator needs a TSDoc summary and a `@category` tag on every export (api-docs.ts:428-429). The proposed edit already asks for a one-line summary. Keep `@category api/particles`.

## Notes on the edit

- A rename re-export such as `export type { ParticleEmitterShape as EmitterShape }` would not help. The generator skips a symbol only when it has the same name (api-docs.ts:414). So that form would print a second full section with the same body. Use the alias declaration, as the finding proposes.
- Optional: the "as a fountain or a flame does" example is only in the particles copy. Move it into the engine's ParticleEmitterShape comment so that it is kept.
- Geometry files that import Vec2Like from './types' (curve.ts:15, curves.ts:8, extrude.ts:10) still work if types.ts re-exports it with `export type { Vec2Like } from '@null3d/engine'`.
