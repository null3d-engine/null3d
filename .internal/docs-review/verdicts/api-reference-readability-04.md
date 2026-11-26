# api-reference-readability-04

## Finding as given

- page: api/reference/geometry, api/reference/particles, api/reference/debug, api/reference/math, api/reference/sound
- anchor: particles `EmitterShape` line 21 and `ParticleEmitterShape` line 122; geometry `BoxOptions` beside `EllipseCurve`
- category: missing-prerequisite
- severity: high
- claim: Pages that mix packages never say which package an export comes from, so a newcomer cannot tell what to import from where. On particles, engine and add-on twins look like duplicates: EmitterShape and ParticleEmitterShape have the same type and the same 100-word text.
- evidence: particles lines 32 and 133 are identical paragraphs. packages/particles/src/index.ts:10 exports EmitterShape; packages/engine/src/index.ts:225 exports ParticleEmitterShape. Same for ParticleBurst/ParticleEmitterBurst and SubEmitter/ParticleEmitterSub. Geometry mixes packages/engine/src/index.ts and packages/geometry/src/index.ts exports (API_PACKAGES) with no mark.
- proposedEdit: Store the package (and subpath entry) on each ApiSymbol and print 'From `@null3d/geometry`.' under each H2. For twin types, keep the full text once and make the other say 'The same shape as [`ParticleEmitterShape`](#particleemittershape), for code that imports @null3d/particles.'
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

The main claim holds:
- tools/lib/api-docs.ts:10-15: `ApiPackage` has only `entry` and `source`. `ApiSymbol` (lines 50-63) has no package field, and `renderReference` (line 505) prints no import path. No reference page names the package of an export.
- The pages do mix entry points. Geometry: `BoxOptions`, `MeshGeometry`, `levelAt` come from `@null3d/engine`; `EllipseCurve`, `extrude` come from `@null3d/geometry`. Debug: `Debug`, `FrameStats` come from `@null3d/engine`; `countPerSecond`, `measurePageMemory`, `StatsPanel`, `statsText` come only from `@null3d/engine/stats`. Sound: `NAMESPACE` only from `@null3d/sound`; `PageSound`, `connectSound` only from `@null3d/sound/page`. Math: `createMath` only from `@null3d/engine/math`; the rest also from `@null3d/engine`.
- Particles is the worst case. Its title says "Particles (@null3d/particles)", but it lists engine-only exports (`ParticleBuffer`, `ParticleLook`, `ParticleMotion`, `ParticleEmitter*`, and others from packages/engine/src/index.ts:221-235). docs/api/particles.md never names `ParticleBuffer` or an engine import for these types. A reader who imports `ParticleLook` from `@null3d/particles` gets an error. High severity is fair for this page.
- The explaining pages (docs/api/geometry.md:56-66, debug.md:342-358, sound.md:27-61, math.md:111-118) do give import paths for the main exports. This lowers the cost on geometry, debug, sound and math, but the reference pages still give no mark per export.

Parts that do not hold:
- "Identical paragraphs" is wrong. The add-on `EmitterShape` text (packages/particles/src/system.ts:40) adds "as a fountain or a flame does"; the engine text does not. The types are the same. They are two separate declarations, not one aliased symbol, so the generator lists both.
- `ParticleBurst` and `ParticleEmitterBurst` have the same members and nearly the same text (particles reference lines 75-99). That pair is a twin.
- `SubEmitter` and `ParticleEmitterSub` are NOT twins. `SubEmitter` has `system: ParticleSystem` (packages/particles/src/system.ts:76-85); `ParticleEmitterSub` has `buffer: ParticleBuffer` (particles reference lines 135-146). The proposed "The same shape as ..." line would be false for that pair.
- The twin text is not made by tools/lib/api-docs.ts. It comes from TSDoc in packages/particles/src/system.ts and packages/engine/src/scene/particles.ts. The package mark goes in tools/lib/api-docs.ts.

## Corrected claim

Reference pages never say which package or subpath entry an export comes from. Geometry, debug, sound and math mix entry points. The particles page title names `@null3d/particles` but half its exports come only from `@null3d/engine`, which misleads. Two pairs on the particles page are near-duplicates: `EmitterShape`/`ParticleEmitterShape` (same type, nearly the same text) and `ParticleBurst`/`ParticleEmitterBurst`. `SubEmitter` and `ParticleEmitterSub` differ (one takes a system, one takes a buffer), but neither text says how.

## Corrected edit

1. tools/lib/api-docs.ts: add an import path to each `ApiPackage` (for example `'@null3d/engine/stats'`, `'@null3d/sound/page'`). Copy it onto each `ApiSymbol` from the first entry that exports it. The list puts the engine's main entry first, so a shared export names `@null3d/engine`. In `renderReference`, print a line such as "Import from `@null3d/geometry`." under each heading.
2. packages/particles/src/system.ts: give `EmitterShape` and `ParticleBurst` one-line summaries, for example "The same as the engine's `ParticleEmitterShape`. `createParticles` takes this one, from `@null3d/particles`." Or define them as aliases of the engine types, so the page shows `type EmitterShape = ParticleEmitterShape`. Keep the full text on the engine types.
3. Do not call `SubEmitter` a twin. Add one sentence to each: `SubEmitter` bursts another `ParticleSystem`; the engine's `ParticleEmitterSub` bursts a `ParticleBuffer`, for code that drives buffers without the add-on.
