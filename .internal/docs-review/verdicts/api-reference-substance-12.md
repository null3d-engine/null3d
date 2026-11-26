# api-reference-substance-12

## Finding as given

- page: api/reference/feature-draws, feature-effects, feature-instances, materials, particles, cameras, lights, scene, assets, engine
- anchor: feature-draws.md:33, feature-effects.md:30, feature-instances.md:34 'which extends `Omit`.'; materials.md:50 `DecalOptions`
- category: missing-content; severity: medium
- claim: Base types lose their type arguments: Omit<ShaderOptions<Wgsl>, 'wgsl'> prints as `Omit`, so the options cannot be found. Seven types show no members and no base link (FeatureEffectOptions, StandardOptions, DecalOptions, ShadowCatcherValues, ParticleValues, MapControls, AmbientLight, Group, ArcCurve). Eight bases sit on other pages with no link (NodeOptions, Object3D, DeviceHints, TextureOptions, Group).
- evidence: tools/lib/api-docs.ts:454 uses t.expression.getText(). Sources: feature-effects.ts:28-29, feature-draws.ts:52-53, feature-instances.ts:56-57, resources.ts:2315,2368,2390, particles.ts:166.
- proposedEdit: Print the full heritage text (t.getText()), link each base to its page anchor, and for Omit and Pick list the inherited members or add a 'From `EffectOptions`' row.
- generatedSource: tools/lib/api-docs.ts

Verdict: partly

## Evidence

- tools/lib/api-docs.ts:454 takes `t.expression.getText()`, which drops the type arguments. renderSymbol (api-docs.ts:490-492) prints each base as a plain code span. No base is linked anywhere in the reference.
- Confirmed `which extends \`Omit\`` at feature-draws.md:33, feature-effects.md:30, feature-instances.md:34, materials.md:50 and :56. The finding misses three more: particles.md:252 (`ParticleSystemOptions` extends `Omit<ParticleBufferOptions, 'capacity'>`, packages/particles/src/system.ts:93), lines.md:54 (`LineOptions` ... `Pick`) and lines.md:75 (`LineValues` extends `Omit`, `Pick`). The lines page is not in the page list.
- FeatureEffectOptions (feature-effects.ts:28-29) has no own members and extends `Omit<EffectOptions<Wgsl>, 'order'>`. Its page shows no table and no base name. The prose hints ("as `post.addEffect` takes them"), and FeatureDrawOptions prose says "take the options of `materials.shader`". These hints help but do not name `EffectOptions` (post.md:93) or `ShaderOptions`, and do not say which keys are removed. DecalOptions (resources.ts:2368-2370) hides that `Omit<StandardMaps, ...>` is its second base.
- Counts are wrong. "Seven types" lists nine. "Eight bases" lists five.
- For the types whose base is a plain named interface, the base name already prints, so the reader can find it: StandardOptions (StandardBaseOptions, StandardMaps on materials.md:184, :199), ShadowCatcherValues (MaterialOptions, materials.md:118), ParticleValues (ParticleMotion, ParticleLook on particles.md:205, :180), AmbientLight (Light, lights.md:96), MapControls (OrbitControls, controls.md:270), ArcCurve (EllipseCurve, geometry.md:205), Group (Object3D, objects.md:42). For these, the only cost is a missing link, not missing content. NodeOptions (scene.md:293), Object3D (objects.md:42), DeviceHints (quality.md:13), TextureOptions (textures.md:116) and Group (objects.md:13) do sit on other pages with no link.
- Proposed edit: `t.getText()` returns multi-line text for DecalValues and LineValues (resources.ts:2335-2342), so it needs its whitespace collapsed before it goes into one sentence.

## Corrected claim

An `Omit` or `Pick` base prints as a bare `Omit` or `Pick`, because the generator drops the type arguments. Readers cannot tell which type the options come from or which keys are removed. This affects FeatureDrawOptions, FeatureEffectOptions, ComputeInstancesOptions, DecalOptions, DecalValues, ParticleSystemOptions, LineOptions and LineValues. FeatureEffectOptions shows nothing beyond its summary. Separately, no base type is ever linked. Where the base is a named interface (StandardOptions, ShadowCatcherValues, ParticleValues, AmbientLight, MapControls, ArcCurve, Group), its name is printed and it can be found, often on the same page. A link would be a convenience, not missing content. Bases on other pages (NodeOptions, Object3D, DeviceHints, TextureOptions, Group) are the ones where a link helps most.

## Corrected edit

In tools/lib/api-docs.ts:454, print the full heritage text with its whitespace collapsed (for example `t.getText().replace(/\s+/g, ' ')`). The sentence then reads "which extends `Omit<ShaderOptions<Wgsl>, 'wgsl'>`". In renderSymbol, link each base name that is a documented symbol to its page and anchor, using the symbol's `page` field. Use a same-page anchor when the page matches. Listing inherited members of Omit and Pick is optional once the full text and the link are shown. Include lines.md and particles.md:252 in the scope.
