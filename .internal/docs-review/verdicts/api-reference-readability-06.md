# Verdict: api-reference-readability-06

## Finding as given

- page: api/reference/feature-draws, feature-effects, feature-instances, materials, lines, particles, vertex-draws
- anchor: "which extends `Omit`" (feature-draws line 33, feature-effects 30, feature-instances 34, materials 56, lines 75, particles 252, vertex-draws 42)
- category: wrong-claim
- severity: high
- claim: The extends line drops the type arguments, so "Interface `FeatureDrawOptions`, which extends `Omit`." tells the reader nothing about the inherited options. LineValues reads "which extends `Omit`, `Pick`."
- evidence: readApi: bases = extended.map((t) => t.expression.getText()). The source is "extends Omit<ShaderOptions<Wgsl>, 'wgsl'>" (packages/engine/src/scene/feature-draws.ts:53).
- proposedEdit: Print the full heritage type and link its base, or say it in words: "It takes every option of [`ShaderOptions`](materials.md#shaderoptions) but `wgsl`."
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- The bug is real. tools/lib/api-docs.ts:450-454 collects the heritage types and keeps only `t.expression.getText()`, which is the bare name `Omit` or `Pick` with no type arguments. renderSymbol (tools/lib/api-docs.ts:490-492) prints those names as the "which extends" line.
- The sources confirm the lost arguments: feature-draws.ts:52-53 `Omit<ShaderOptions<Wgsl>, 'wgsl'>`, feature-effects.ts:28-29 `Omit<EffectOptions<Wgsl>, 'order'>`, feature-instances.ts:56-57 and vertex-draws.ts:37-38 `Omit<ShaderOptions<Wgsl>, 'wgsl'>`, resources.ts:2335-2337 `Omit<StandardValues, ...>`, lines.ts:48-50 `Omit<MaterialOptions, 'alphaCutoff'>, Pick<StandardValues, 'metalness' | 'roughness' | 'emissive' | 'emissiveIntensity'>`, particles system.ts:93 `Omit<ParticleBufferOptions, 'capacity'>`.
- The member tables do not fill the gap. membersOf (tools/lib/api-docs.ts:220-230) skips every member whose owner is not the interface itself, so inherited options are never listed.
- The scope is wider than the finding says. The same broken line is on four more lines: lines.md:54 (`LineOptions` extends `LineValues`, `Pick`), materials.md:50 (`DecalOptions` extends `DecalValues`, `Omit`), sprites.md:49 (`SpriteOptions` extends `SpriteValues`, `Omit`) and points.md:35 (`PointOptions` extends `PointValues`, `Omit`).
- "Tells the reader nothing" is overstated for some pages. The summary under the line already names the base in words for FeatureDrawOptions (feature-draws.md:35, "take the options of `materials.shader`"), ComputeInstancesOptions (feature-instances.md:36), VertexDrawOptions (vertex-draws.md:44, "every option of `materials.shader`") and FeatureEffectOptions (feature-effects.md:32, "as `post.addEffect` takes them ... the options take no order"). There a reader can still find the inherited options, though the "extends `Omit`" line itself is noise. For DecalValues, LineValues and ParticleSystemOptions the summary does not name the base type or the omitted keys exactly, so the reader cannot find the full option set. High severity holds for those; medium fits the four with good summaries.
- The proposed edit fits the rules and the website contract. The anchor `materials.md#shaderoptions` matches the heading "## `ShaderOptions`" on materials.md. The fix belongs in tools/lib/api-docs.ts, not in TSDoc.

## Corrected claim

The API reference generator keeps only the bare name of each extended type, so eleven "which extends" lines on nine reference pages show `Omit` or `Pick` with no base type or keys: feature-draws 33, feature-effects 30, feature-instances 34, materials 50 and 56, lines 54 and 75, particles 252, sprites 49, points 35, vertex-draws 42. The tables list only the interface's own members, so the inherited options are not shown. On feature-draws, feature-instances, vertex-draws and feature-effects the summary already names the base in words, so the line is noise there. On materials (DecalValues), lines (LineValues) and particles the reader cannot find the full option set.

## Corrected edit

In tools/lib/api-docs.ts, keep the type arguments of each heritage type (for example, record the base name and the omitted or picked keys). Render `Omit<X, 'a' | 'b'>` as "every option of [`X`](<page>.md#x) but `a` and `b`", `Pick<X, 'a' | 'b'>` as "the `a` and `b` options of [`X`](<page>.md#x)", and a plain base as a link to its heading. Fall back to the full heritage text in code when the base is not a known export. Apply it to all eleven lines listed above.
