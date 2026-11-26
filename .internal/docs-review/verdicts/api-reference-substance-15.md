# api-reference-substance-15

## Finding as given

- page: api/reference/engine, post, scene, feature-effects, particles, three-compat, tasks, geometry
- anchor: engine.md:130 'culls buckets'; feature-effects.md:25 'The adapter calls it'; post.md:154; scene.md:385; particles.md:46 'into the core'; tasks.md:12 'the job system ... chunks of a frame'
- category: term-before-definition; severity: medium
- claim: Maintainer terms (bucket, adapter, engine core, job system, source, part) appear with no explanation and no link. The concept pages define some of them, but the reference never links there.
- evidence: Definitions exist at concepts/culling.md:38 (buckets) and api/features.md:271-280 (adapters); the reference header (tools/lib/docs.ts:335) links only the written page.
- proposedEdit: Name each thing in user terms on first use in TSDoc ('the group of objects that share a pipeline, a mesh and a material (a bucket)'; 'the engine's full-screen feature code'). Add to the reference header: 'Terms such as sketch, page, engine core and job worker: see [Architecture](../../concepts/architecture.md).'
- generatedSource: packages/engine/src/page/capabilities.ts, scene/feature-effects.ts, scene/post.ts, scene/scene.ts, scene/particles.ts, shared/run-task.ts, scene/level-rule.ts; tools/lib/docs.ts

Verdict: partly

## Evidence

The terms appear as quoted:
- engine.md:130 `directDraws`: "the engine culls buckets on the CPU". The text comes from packages/engine/src/page/engine.ts:573, not from page/capabilities.ts.
- feature-effects.md:25 `refresh()`: "The adapter calls it ...". post.md:154 `addFeatureEffect`: "The adapter loads on first use ... this adapter cannot place".
- particles.md:46 `writeRecords`: "in one call into the core ... the core's room".
- tasks.md:12 `runTask`: "A job worker leaves the job system only between the chunks of a frame".
- geometry.md:350-421 (level-rule.ts): "source", "a part's levels", "the core's culling picks every source". three-compat.md:27: "the core draws the mask".

Where the claim is wrong: "the reference never links there" is too strong. Every reference page opens with a link to its written page (tools/lib/docs.ts:335). For two of the terms, that one link already explains them:
- "adapter": api/feature-effects.md:24 says "This is the adapter for a feature description with kind: 'fullscreen'" and links to api/features.md. Its "Adapters" section (features.md:280 on) lists the five adapters.
- "job system", "chunks", "job workers": api/tasks.md:13 and :55 use the same words, explain them, and tasks.md:101 links to Architecture. Also, the `runTask` paragraph explains in the next clause what the phrase means for the reader: "so a frame never waits for a task".
- "engine core": engine.md:205 explains it in context ("the engine core's file downloads ... compiled"). api/particles.md:23 says "The engine's core writes each particle's record once", and concepts/architecture.md:20 and :40 define it.

Where the claim holds:
- "bucket" has no definition anywhere a reader would find it. backends.md:35 says "group of objects that share a pipeline, a mesh and a material", and culling.md:36 says "group", but both then switch to "bucket" without tying the two words together. api/engine.md:155 also uses "buckets" with no definition. The claim's pointer "culling.md:38 (buckets)" is weak: that line uses the word but does not define it.
- In the geometry reference (level-rule.ts), "source" and "part" are not defined on the reference page or on api/geometry.md. concepts/lod.md says "pieces", not "parts". "The core's culling" is also maintainer wording.

## Corrected claim

Two maintainer terms have no definition that a reader can reach: "bucket" (engine reference, `directDraws`) and "source"/"part" (geometry reference, the level-rule exports). "The core" in particles, three-compat and geometry is used without the full name "engine core". "Adapter" and "job system" are explained one click away, on the written page that each reference page links first. Severity medium for bucket and source/part. Low for the rest.

## Corrected edit

Fix the TSDoc where the terms appear:
- page/engine.ts:573 (`directDraws`): "True when the job workers cull on the CPU and draw each group of objects that share a pipeline, a mesh and a material directly." Use the same wording in concepts/culling.md:38 and backends.md:35, so that the docs use one word for the thing.
- scene/level-rule.ts: on first use, say what a source is ("an object, an instance row or one piece of a split mesh") and use "piece" to match concepts/lod.md. Change "the core's culling" to "the engine's culling".
- scene/particles.ts and three-compat/src/outline.ts: change "the core" to "the engine core" or to "the engine".
- scene/feature-effects.ts / scene/post.ts: optional. Add "(the engine code that places a full-screen feature, see Feature descriptions)" on the first "adapter" in `addFeatureEffect`.

Leave out the shared header line about Architecture. It would add a line to all 38 reference pages, most of which use none of these terms. It also would not cover bucket, source or adapter, which are the terms that need help.
