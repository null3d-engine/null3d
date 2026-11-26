# API reference: sense and substance review

Slice: the 39 generated pages under `docs/api/reference/`. Every page comes from TSDoc comments, through `tools/lib/api-docs.ts` (reading and rendering) and `tools/lib/docs.ts` (`referencePage`, the page frame). Paths below are relative to the generated copy of the repository.

Most problems repeat on every page, so most findings name the generator. Content findings name the TSDoc source file.

Ranking: findings 1 to 30 are verified against the code. Findings 31 and later are marked "not verified".

## Findings

### 1. High: no page says which package or entry point an export comes from

- Pages: all 39. Worst: api/reference/geometry, particles, debug, math, sound, grass.
- Anchor: every `## \`<name>\`` heading.
- Claim: a reader cannot tell what to import, or from where. The geometry page mixes 30 engine exports (`MeshGeometry`, `levelAt`, `LevelView`) with 38 exports of `@null3d/geometry` (`Shape`, `extrude`, `ArcCurve`) in one alphabetical list. The particles page, titled "Particles (@null3d/particles)", holds 13 engine exports (`ParticleBuffer`, `ParticleEmitterShape`). Four exports live on subpaths that the page never names: `@null3d/engine/stats` (`countPerSecond`, `StatsPanel`), `@null3d/engine/math`, `@null3d/sound/page` (`connectSound`, `PageSound`) and `@null3d/grass/hash` (`hashAt`, `pcg`, `unitAt`). Summaries also say "the package reads..." (geometry.md `Vec2Like`) with no package named.
- Evidence: `@category` counts per package: engine has api/geometry=30 and api/particles=13; geometry has api/geometry=38; particles has api/particles=10. `tools/lib/api-docs.ts:22-39` (API_PACKAGES lists each entry point), `:51` (ApiSymbol has no entry field), `:486-503` (renderSymbol prints no import). Package export maps: `packages/engine/package.json` (`./stats`, `./math`), `packages/sound/package.json` (`./page`), `packages/grass/package.json` (`./hash`).
- Proposed edit: add `entry: string` (the import specifier, such as `@null3d/engine/stats`) to `ApiSymbol` in `readApi`, from the `ApiPackage` that exported it. In `renderSymbol`, print one line under each heading: "Import from `@null3d/geometry`." Group the page by import specifier (see finding 13).
- Generated source: tools/lib/api-docs.ts

### 2. High: class constructors are missing

- Pages: geometry (all curve classes, `Shape`, `Path`, `CurvePath`), tasks (`TaskFailure`), engine (`EngineError`), and every other class a user creates with `new`.
- Anchor: geometry.md:58 `CatmullRomCurve3`, :542 `Path`, :656 `Shape`.
- Claim: the page lists a class's properties and methods but never its constructor. A newcomer cannot learn the arguments of `new CatmullRomCurve3(...)`. The written docs show a constructor once (`new Shape(`).
- Evidence: `packages/geometry/src/curves.ts:55,106,140,191,247,269,304,357` declare public constructors. `tools/lib/api-docs.ts:220-247` reads only `type.getProperties()`, which has no construct signatures. `grep "constructor" docs/api/reference/*.md` finds nothing.
- Proposed edit: in `readApi`, for a class, read `checker.getTypeOfSymbolAtLocation(symbol, declaration).getConstructSignatures()` (skip private constructors). Render each one first in the member table as `new CatmullRomCurve3(points?: Vec3Like[], closed = false, ...)`, with the constructor's TSDoc summary. Add a docs check problem for a public constructor without a summary.
- Generated source: tools/lib/api-docs.ts

### 3. High: optional methods print as required

- Pages: sketch, engine, and every interface with an optional method.
- Anchor: sketch.md:29-32 (`SketchCallbacks`), engine.md:104 (`inspect`).
- Claim: `SketchCallbacks` shows `onFixedUpdate(step: number): void`, `onUpdate`, `onLateUpdate` and `onDestroy` as required. A newcomer thinks each sketch must return all four. `Engine.inspect` prints as always present, but its text says that release builds leave it out.
- Evidence: `packages/engine/src/sketch/define-sketch.ts:38,45,52,58` declare `onFixedUpdate?(...)` and the others as optional. `packages/engine/src/page/engine.ts:801` declares `inspect?(...)`. `tools/lib/api-docs.ts:164-188` (callableOf) never adds `?`, while `propertyOf` (`:190-215`) does.
- Proposed edit: in `membersOf`, pass the member's `ts.SymbolFlags.Optional` flag to `callableOf` and print `name?(...)`.
- Generated source: tools/lib/api-docs.ts

### 4. High: code examples and lists in TSDoc collapse into one line

- Pages: impostors, scene, engine, ui.
- Anchor: impostors.md:317 (`loadImpostorAtlas`), scene.md:492 (`timeOfDay`), engine.md:78 (`DrawPathReason`), engine.md:461 (the thread fallback reason type), ui.md:41 (`LabelTransform`).
- Claim: a fenced TypeScript example prints as "```ts const pine = ... ```" inside the paragraph, so the website shows broken text, not code. Bulleted lists print as "...: - `probe-faster`: ... - `probe-not-faster`: ...". Paragraph breaks also vanish, which makes most of the long paragraphs in finding 10.
- Evidence: `tools/lib/api-docs.ts:74` (`flat` joins every line), used by `summaryOf` at `:120-124`. Source with real blocks: `packages/impostors/src/load.ts:33-38`, `packages/engine/src/scene/time-of-day.ts:210-221`.
- Proposed edit: keep the comment's block structure. Split the summary on blank lines, keep fenced blocks and list items as they are, and join only the lines inside one prose paragraph. Use `flat` only for table cells.
- Generated source: tools/lib/api-docs.ts

### 5. High: the capability report contradicts the draw-path docs about device names

- Page: api/reference/engine.
- Anchor: engine.md:17 (`CapabilityReport` summary), :620 (`adapterInfo`), :130 and :618 (`directDraws`), :78 (`DrawPathReason`).
- Claim: `CapabilityReport` says the engine "never decides from browser or GPU names", and `adapterInfo` says "the engine reads no meaning from it". The same page then says that the draw-path probe runs only on an Apple GPU in WebKit, and that `software-renderer` means the browser draws on the CPU. The engine finds both from the adapter's reported names.
- Evidence: `packages/engine/src/page/capabilities.ts:121,176,186` (the two claims). `packages/engine/src/shared/webkit.ts:60-76` reads `vendor`, `architecture` and `description` for "Apple". `packages/engine/src/shared/software.ts:1-13` reads the names for SwiftShader, llvmpipe and others.
- Proposed edit: in capabilities.ts, rewrite the `CapabilityReport` summary as: "The engine picks its build and GPU path from these feature tests, and its quality preset from the device hints. It reads a device name in two cases only: to find an Apple GPU in WebKit, where it measures the draw path, and to find a software renderer." Rewrite `adapterInfo` the same way.
- Generated source: packages/engine/src/page/capabilities.ts

### 6. High: a decision record number and a repository benchmark command reach the docs

- Pages: api/reference/engine, api/reference/scene. The same pattern is in written pages api/geometry, api/raycast, api/controls and api/scene.
- Anchor: engine.md:618 "(D-174)"; scene.md:492 "`bun run bench:allocation --time-of-day` checks that."
- Claim: D-174 is a maintainer decision record. `bun run bench:allocation` is a command of the engine's own repository, which a user cannot run in a project. The written pages go further: api/controls.md:106 names `tests/image/controls.spec.ts`.
- Evidence: `packages/engine/src/page/capabilities.ts:115`; `packages/engine/src/scene/time-of-day.ts:207-208`. Written pages: api/geometry.md:204, api/raycast.md:23, api/controls.md:106, api/scene.md:341 and :462. AGENTS.md "Writing docs": "never explain where a fact came from in those terms".
- Proposed edit: delete "(D-174)". Replace the benchmark sentence with "The call allocates nothing, so a sketch can move the time in every frame." Make the same cut on the written pages. Add `D-[0-9]+`, `bench:` and `tests/` to the docs style check for `docs/` and for TSDoc on `@category` exports.
- Generated source: packages/engine/src/page/capabilities.ts, packages/engine/src/scene/time-of-day.ts

### 7. High: wind, grass and water say "a page" for code that runs in the sketch

- Pages: api/reference/wind, grass, water.
- Anchor: grass.md:19 "A page awaits it in its setup"; wind.md:19 "the calls that a page uses to set the wind"; wind.md:65 "a page reads it in its next `onUpdate`"; grass.md:115; water.md `WaterWind`, `OCEAN_BANDS`.
- Claim: elsewhere the docs use "page" for the main thread and "sketch" for the sketch's thread (engine.md `sketchThread`; sound.md "the page's half, `connectSound`"). Here `createWind` and `createGrass` take a `SketchContext` and run in the sketch, yet the text calls their caller "a page". A reader can put the call on the wrong thread.
- Evidence: wind.md:16 `createWind(ctx: SketchContext, ...)`; grass.md:16 `createGrass(ctx: SketchContext, ...)`. Counts of "a page" in sources: `packages/wind/src/wind.ts` 13, `analytic.ts` 10, `packages/grass/src/grass.ts` 6, `packages/water/src/water.ts` 6. Examples: `packages/grass/src/grass.ts:363`, `packages/wind/src/wind.ts:130`.
- Proposed edit: replace "a page" with "a sketch" in the TSDoc of these three packages wherever the code runs in the sketch. Keep "page" only for the main thread.
- Generated source: packages/wind/src/*.ts, packages/grass/src/*.ts, packages/water/src/*.ts

### 8. High: grass says the governor lowers the preset, but it never does

- Page: api/reference/grass.
- Anchor: grass.md:115 `PLANT_SWAY_DISTANCE`: "a governor step that lowers the preset shortens the distance with it".
- Claim: the frame-budget governor lowers settings one step at a time. It never changes the preset. A reader waits for a preset change from the governor and never gets one.
- Evidence: `packages/engine/src/quality/governor.ts:1-9` lists the governor's steps: budgets, render scale, level-of-detail threshold, shadow cascades, shadow filter, bloom, ambient occlusion, contact shadows, far characters, volumetric fog. The preset is not among them. quality.md:78 says the same. Only `quality.setPreset` (quality.md:81) changes the preset. Source of the claim: `packages/grass/src/sway.ts:9-10`.
- Proposed edit: "A sketch reads it from the engine's preset. Read it again, and call `grass.setSwayDistance`, after `quality.setPreset` changes the preset."
- Generated source: packages/grass/src/sway.ts

### 9. Medium: member descriptions in table cells run to hundreds of words

- Pages: 19 pages. Cells over 90 words: engine 25, scene 21, materials 12, assets 12, debug 7, geometry 6, quality 6, render 4, objects 4, lights 4, post 4, textures 4, cameras 3, animation 3, ui 2, terrain 2, sketch 2, particles 1, wind 1. In all, 123 of 2,704 member cells.
- Anchor: the longest: geometry.md:492 `buildLevels` (463 words), render.md:173 `addPass` (303), engine.md:212 `preload` (288), debug.md:31 `view` (281), scene.md:412 `pick` (263), materials.md:142 `shader` (261), scene.md:385 `addFeatureDraw` (255), engine.md:111 `destroy` (239).
- Claim: the page statistics count paragraphs only, so they miss these cells. A table cell cannot hold paragraphs, lists or code. The facts in them are correct and useful for implementers, but in one cell they are a wall of text.
- Evidence: measured over `docs/api/reference/*.md` rows that start with "| `".
- Proposed edit: in `renderSymbol`, keep the first paragraph of each member's TSDoc in its cell. Print the later paragraphs after the table, one block per member:

  ```
  <details>
  <summary>Technical details: `buildLevels`</summary>

  (the later paragraphs)

  </details>
  ```

  Then split the long TSDoc comments into a short first paragraph (what it does, what it returns, what it throws) and later paragraphs (limits, memory, timing). This needs finding 4's fix, so the paragraph breaks survive.
- Generated source: tools/lib/api-docs.ts, then the TSDoc of the members listed

### 10. Medium: long summary paragraphs on 22 pages

- Pages and lines (from the page statistics): assets 258, 328; controls 36, 44, 125, 180; debug 18; engine 47, 55, 71; features 58; geometry 134, 222, 362, 381, 450, 491, 517; impostors 20, 135, 318; input 10; lights 26, 167; materials 12, 20, 141; math 26; particles 25, 31, 126, 147; post 213; render 36; scene 108, 144, 485; splats 48; tasks 12; water 44, 360.
- Anchor: worst: tasks.md:12 `runTask` (381 words, 18 sentences), scene.md:485 `timeOfDay` (191), impostors.md:318 `mergeFarGeometry` (169), render.md:36 (141), engine.md:71 `DrawPathReason` (140), splats.md:48 `createSplats` (136), features.md:58 `defineFeature` (134), debug.md:18 `Debug` (132).
- Claim: most of these are several TSDoc paragraphs joined by the generator (finding 4). The rest put implementation detail in the main text. Examples: `runTask` explains the job system's chunk scheduling and `SharedArrayBuffer` ordering. The `Debug` summary ends with "apart from one traversal of the scene's objects whose meshes have levels".
- Evidence: page statistics, `longParagraphs` for each api/reference page.
- Proposed edit: fix finding 4 first. Then give each summary a first paragraph of at most three sentences. Move the rest into one `<details><summary>Technical details: <name></summary>` block under the summary. For `runTask`, keep "Runs a task in a job worker and resolves with its output" and the input rules in the main text, and move the scheduling, shared memory and fallback worker paragraphs into the block.
- Generated source: tools/lib/api-docs.ts, then the TSDoc of each symbol listed

### 11. Medium: `@param`, `@returns` and `@throws` text is dropped

- Pages: impostors, grass, engine, geometry.
- Anchor: impostors.md `loadImpostorAtlas` (the throw condition is lost), `handOverToCards`, `bakeImpostorAtlas`; grass.md `createGrass`, `swayDistanceFor`, `pcg`, `hashAt`, `unitAt`; engine.md `checkAddonVersion`, `checkPluginInterface`; geometry.md `levelSwitchDistance`, `levelDistances`, `levelAt`.
- Claim: 13 public exports describe their parameters, results or errors in tags. The page shows none of it, so `levelAt`'s five numeric parameters (`scale`, `radius`, `distance`) have no meaning on the page.
- Evidence: `tools/lib/api-docs.ts:99` knows the tags, but `summaryOf` (`:120-124`) reads only the documentation comment. Sources: `packages/impostors/src/load.ts:40-43`, `packages/engine/src/scene/level-rule.ts:147-150,172-173`, `packages/grass/src/hash.ts`.
- Proposed edit: render the tags under the summary as a "Parameters" table (name, description), a "Returns" line and a "Throws" line. Or make the docs check refuse `@param` on public exports, so authors write the facts in the summary as the rest of the API does. Pick one rule and apply it to all 13.
- Generated source: tools/lib/api-docs.ts

### 12. Medium: base types lose their arguments, and inherited members are invisible

- Pages: feature-draws, feature-effects, feature-instances, materials, particles, cameras, lights, scene, assets, engine, objects.
- Anchor: feature-draws.md:33 and feature-effects.md:30 "which extends `Omit`."; feature-instances.md:34; materials.md:50 `DecalOptions`, "which extends `DecalValues`, `Omit`."
- Claim: `Omit<ShaderOptions<Wgsl>, 'wgsl'>` prints as `Omit`, so a reader cannot find the options at all. Seven types show no members of their own and no link to their bases: `FeatureEffectOptions`, `StandardOptions`, `DecalOptions`, `ShadowCatcherValues`, `ParticleValues`, `MapControls`, `AmbientLight`, `Group`, `ArcCurve`. Eight bases sit on other pages with no link: `CameraOptions` and `LightOptions` extend `NodeOptions` (scene page); `Camera` and `Light` extend `Object3D` (objects page); `CapabilityReport` extends `DeviceHints` (quality page); `LoadTextureOptions` extends `TextureOptions` (textures page); `PrefabInstance` extends `Group` (objects page).
- Evidence: `tools/lib/api-docs.ts:454` (`t.expression.getText()` drops type arguments). Source: `packages/engine/src/scene/feature-effects.ts:28-29`, `feature-draws.ts:52-53`, `feature-instances.ts:56-57`, `resources.ts:2315,2368,2390`, `particles.ts:166`.
- Proposed edit: print the full heritage text (`t.getText()`), so the line reads "extends `Omit<EffectOptions<Wgsl>, 'order'>`". Link each base to its page and anchor. For `Omit` and `Pick`, add a line listing the members that the type takes from its base, or list the inherited members under a "From `EffectOptions`" row.
- Generated source: tools/lib/api-docs.ts

### 13. Medium: pages are alphabetical walls with no index and no grouping

- Pages: all; worst: scene (36 sections, 11,511 words), engine (40, 10,305), geometry (69, 9,538), debug (44, 7,398), materials (31, 6,954), water (36, 6,011).
- Anchor: debug.md:13: the page opens with `countPerSecond`, a stats helper from `@null3d/engine/stats`, before the main `Debug` interface at :21. engine.md opens with `CapabilityReport` and `checkAddonVersion` before `createEngine`.
- Claim: a reader who looks up "how do I start" or "what does this page cover" must scroll the whole list. User API, add-on author API and helpers for other engines mix with no label: `checkAddonVersion` and `checkPluginInterface` (engine), `ParticleBuffer.writeRecords` "into the core" (particles.md:46), `StatsPanel` "a page that draws with another engine" (debug).
- Evidence: `tools/lib/api-docs.ts:471` (`symbols.sort` by name), `:505` (renderReference prints in that order).
- Proposed edit: open each page with an index table: export, kind, first sentence, import path. Group sections by import path, and within a group put functions that make things first, then classes and interfaces, then types and constants. Optionally read a TSDoc `@group` tag such as "add-on authors" for a second level.
- Generated source: tools/lib/api-docs.ts, tools/lib/docs.ts (referencePage)

### 14. Medium: type names in signatures and text are not links

- Pages: all.
- Anchor: e.g. impostors.md `LoadedImpostorAtlas` (`Texture`, `OctahedralAtlas`); `Vec3Like` appears on 17 pages and is defined only on math; `ColorInput` only on materials; `Vec3` and `Quat` only on objects.
- Claim: a reader who meets `Vec3Like` on the controls page has no way to find what it is.
- Evidence: `tools/lib/api-docs.ts:486-503` prints signatures in a code block and names as plain code spans.
- Proposed edit: after all symbols are known, link each inline code span that is exactly an export name to `<page>.md#<anchor>`. Under each signature block, add a "Types:" line that links the exported types the signature names (the `used` nodes already collected in `readApi`).
- Generated source: tools/lib/api-docs.ts

### 15. Medium: terms used before any page explains them

- Pages: engine, scene, post, feature-effects, particles, three-compat, tasks, geometry.
- Anchor: engine.md:130 and :315 "culls buckets on the CPU"; feature-effects.md:25 "The adapter calls it when the engine's quality changes"; post.md:154 and scene.md:385 "the adapter does not download"; particles.md:46 "in one call into the core, which packs them"; three-compat.md `createOutlinePass` "the core draws the mask"; tasks.md:12 "A job worker leaves the job system only between the chunks of a frame"; geometry.md `levelAt` "which is how the core's culling picks every source".
- Claim: bucket, adapter, engine core, job system and source are maintainer words. The concept pages define some of them (concepts/architecture.md, concepts/culling.md, concepts/backends.md, api/features.md), but the reference never links there.
- Evidence: the anchors above; definitions at concepts/culling.md:38 (buckets) and api/features.md:271-280 (adapters).
- Proposed edit: in the TSDoc, name the thing in user terms on first use: "the group of objects that share a pipeline, a mesh and a material (a bucket)"; "the engine's full-screen feature code (its adapter)". In `referencePage`, add to the header line: "Terms such as sketch, page, engine core and job worker: see [Architecture](../../concepts/architecture.md)."
- Generated source: TSDoc in packages/engine/src/page/capabilities.ts, scene/feature-effects.ts, scene/post.ts, scene/scene.ts, scene/particles.ts, shared/run-task.ts, scene/level-rule.ts; tools/lib/docs.ts

### 16. Medium: the level-of-detail rule exports have no stated purpose

- Page: api/reference/geometry.
- Anchor: geometry.md:336-421 (`LEAST_LEVEL_DISTANCE`, `levelAt`, `LevelBounds`, `levelDistances`, `LevelDistances`, `levelSwitchDistance`, `LevelView`).
- Claim: seven exports describe the engine's own rule for picking a level ("the rule", "a source", "a part"), but no text says when a user calls them. The written geometry page never mentions them. The only users are a showcase scene and the terrain package.
- Evidence: `packages/engine/src/scene/level-rule.ts:139-200`; users: `examples/showcase/creek/valley.ts`, `packages/terrain/src/quadtree.test.ts`. `grep levelAt docs/api/geometry.md` finds nothing.
- Proposed edit: open `levelAt`'s TSDoc with the use: "Picks a level the way the engine does, for code that draws its own levels, such as a terrain or a custom draw." Say "an object or an instance row" for "source" and "a mesh part" for "part". Add a short section to docs/api/geometry.md that links them.
- Generated source: packages/engine/src/scene/level-rule.ts

### 17. Medium: the same type is exported twice under two names, or twice under one name

- Pages: particles; geometry and math.
- Anchor: particles.md:21 `EmitterShape` and :122 `ParticleEmitterShape`; geometry.md:823 and math.md:174 `Vec2Like`.
- Claim: `EmitterShape` (from `@null3d/particles`) and `ParticleEmitterShape` (from the engine) have the same union and the same 100-word text, one after the other on one page. Two `Vec2Like` types, one per package, have different explanations. A reader cannot tell whether they differ.
- Evidence: `packages/particles/src/system.ts:46`, `packages/engine/src/scene/particles.ts:229`; `packages/geometry/src/types.ts:9`, `packages/engine/src/math/types.ts:11`.
- Proposed edit: in `@null3d/particles`, write `export type EmitterShape = ParticleEmitterShape` with a one-line summary: "The engine's `ParticleEmitterShape`, under the name the system's options use." In `@null3d/geometry`, re-export the engine's `Vec2Like` rather than declare its own.
- Generated source: packages/particles/src/system.ts, packages/geometry/src/types.ts

### 18. Medium: a TSDoc comment points to a section "above" that is not on the page

- Page: api/reference/input.
- Anchor: input.md:83 `ObjectEventType`: "The section on pointer events above says when each one comes."
- Claim: the reference page has no such section. It is on the written page api/input.md.
- Evidence: `packages/engine/src/scene/pointer-events.ts:37`.
- Proposed edit: "[Input](../input.md#pointer-events) says when each one comes." (check the anchor). Or list the order of the events in the comment.
- Generated source: packages/engine/src/scene/pointer-events.ts

### 19. Medium: the sketch "runs in the sketch worker", but it can run on the page's thread

- Pages: sketch, engine.
- Anchor: sketch.md:13 `defineSketch` "in the sketch worker"; sketch.md:107 `SketchSetup` "The engine calls it once, in the sketch worker"; engine.md:174 `sketch` "which runs in the sketch worker".
- Claim: the same reference says that `sketchThread: 'main'` and the single-threaded build run the sketch on the page's main thread (engine.md, `sketchThread`). The three sentences contradict it.
- Evidence: `packages/engine/src/sketch/define-sketch.ts:201,265`; `packages/engine/src/page/engine.ts` (the `sketchThread` option).
- Proposed edit: "in the sketch's thread: a worker by default, or the page's main thread with `sketchThread: 'main'`."
- Generated source: packages/engine/src/sketch/define-sketch.ts, packages/engine/src/page/engine.ts

### 20. Medium: `VERSION` shows `'0.0.0'`

- Page: api/reference/engine.
- Anchor: engine.md:561-565.
- Claim: the page prints the literal type of the constant in the source tree, `'0.0.0'`. The release stamps the real version later, so the website states a version that no user has.
- Evidence: `packages/engine/src/shared/version.ts:15`; `packages/engine/package.json:3`; `tools/lib/api-docs.ts:463`.
- Proposed edit: annotate the constant as `export const VERSION: string = '0.0.0'`, or let the generator print `string` for constants whose summary says "version". Add to the TSDoc: "It equals the installed package's version."
- Generated source: packages/engine/src/shared/version.ts

### 21. Medium: no reference page links a demo

- Pages: all (the statistics list no example links on any of them).
- Anchor: each page's header line.
- Claim: a demo shows each visual API at work, but the reference never points to one. The demo map in the per-page sections below gives the codes.
- Evidence: page statistics, `exampleLinks: []` for all 39 pages; `tools/lib/docs.ts:325-338`.
- Proposed edit: read a TSDoc tag such as `@demo water/` on an export (add it to DOC_TAGS), and render "Demo: [Water](https://github.com/null3d-engine/null3d/tree/main/examples/water/)" under that export's heading. Start with the main make function of each package page.
- Generated source: tools/lib/api-docs.ts, tools/lib/docs.ts

### 22. Low: default values name private constants; constant values are hidden

- Pages: tasks, debug, grass, water.
- Anchor: tasks.md:16 `transfer: Transferable[] = NO_TRANSFER`; debug.md:527 `maxTargetFps = CHECK_MAX_FPS`; grass.md:112 `PLANT_SWAY_DISTANCE: Readonly<Record<QualityPreset, number>>`; water.md `OCEAN_BANDS: readonly OceanBand[]`.
- Claim: `NO_TRANSFER` and `CHECK_MAX_FPS` are not on any page, so the default is unknown. The sway distances (8, 16, 24 and 32 meters) appear nowhere on the page.
- Evidence: `packages/engine/src/shared/run-task.ts:18`, `packages/engine/src/quality/check.ts:18`, `packages/grass/src/sway.ts:14-19`.
- Proposed edit: when a default names a constant, print the constant's value (`= []`, `= 60`). For object constants, state the values in the TSDoc: "8 m at Low, 16 at Medium, 24 at High and 32 at Ultra."
- Generated source: tools/lib/api-docs.ts, packages/grass/src/sway.ts, packages/water/src/ocean.ts

### 23. Low: page titles repeat "API" and stack colons

- Pages: post, quality, render, engine, sketch; header line of all add-on pages.
- Anchor: titles "Post-processing API: API reference", "Quality API: API reference", "Render graph API: API reference", "Page API: createEngine: API reference", "Sketch API: defineSketch and the context: API reference". Header: "The engine's doc comments make this page" on pages of `@null3d/water`, `@null3d/wind` and others.
- Evidence: `tools/lib/docs.ts:328,333,335`.
- Proposed edit: build the title as `${title without a trailing " API"} reference`, and use the part before the first colon when there is one: "Post-processing reference", "Page reference". Say "The doc comments in the code make this page."
- Generated source: tools/lib/docs.ts

### 24. Low: "Interface `X`." repeats the heading under every type

- Pages: all.
- Anchor: e.g. time.md "## `SketchTime`" then "Interface `SketchTime`."
- Claim: the line adds only the kind. It doubles the heading 600 times.
- Evidence: `tools/lib/api-docs.ts:492`.
- Proposed edit: print "Interface." or "Class, extends `Object3D`." (the kind alone), or move the kind into the index table of finding 13.
- Generated source: tools/lib/api-docs.ts

### 25. Low: British and American spelling mix, in text and in one API name

- Pages: impostors (colour 11 times), water (2), terrain (1), geometry (centre 3 times); engine (honour).
- Anchor: geometry.md:360 `LevelBounds.centre`, while `MeshGeometry.center` is on the same page.
- Claim: every other page writes "color" and "center". The API field name `centre` differs from the engine's `center`, so a user can type the wrong one.
- Evidence: `packages/engine/src/scene/level-rule.ts` (`centre`), `packages/impostors/src/*.ts`.
- Proposed edit: write "color" and "center" in TSDoc. Rename `LevelBounds.centre` to `center`.
- Generated source: packages/impostors/src/*.ts, packages/engine/src/scene/level-rule.ts, packages/water/src/*.ts, packages/terrain/src/*.ts

### 26. Low: impostor constants describe each other and talk about the code's own past

- Page: api/reference/impostors.
- Anchor: impostors.md:96 `HAND_OVER_GROUPS`; :37 `Direction`.
- Claim: the `HAND_OVER_GROUPS` summary also explains the spread, which is `HAND_OVER_SPREAD`. It says "a tree's own swap is as it was", which compares with an older behavior. `Direction` says "this module makes it unit length", and the reader sees no module.
- Evidence: `packages/impostors/src/hand-over.ts:17-25`; `packages/impostors/src/octahedral.ts:13`.
- Proposed edit: `HAND_OVER_GROUPS`: "The number of groups that a plant's trees hand over in. Trees in different groups swap to their cards a little before or after one another, so a frame loses one group's cards at a time." `Direction`: "It need not have length 1: the functions on this page normalize it."
- Generated source: packages/impostors/src/hand-over.ts, packages/impostors/src/octahedral.ts

### 27. Low: `TaskLoadError` describes the worker's internals

- Page: api/reference/tasks.
- Anchor: tasks.md:43.
- Claim: "The worker knows it by its name, which every copy of this module gives it." A task author needs to know when to throw it, not how the worker detects it.
- Evidence: tasks.md:43-50; `packages/engine/src/shared/task-load-error.ts:11`.
- Proposed edit: "Throw it from a task's `run` when the task's code or WebAssembly cannot start, so the failure reports `stage: 'load'` rather than `'run'`." Move the detection detail into a code comment.
- Generated source: packages/engine/src/shared/task-load-error.ts:11

### 28. Low: `Debug`'s summary carries build internals in its main text

- Page: api/reference/debug.
- Anchor: debug.md:18 (132 words).
- Claim: the summary ends "apart from one traversal of the scene's objects whose meshes have levels, which the culling sph...". That is true and useful to someone who counts bytes, but it buries the rule that only development builds draw.
- Evidence: debug.md:18; stats `longParagraphs` for debug.
- Proposed edit: keep "Each drawing call draws for one frame only. Only development builds draw; a release build drops the drawing code." Move the traversal detail into a technical details block.
- Generated source: packages/engine/src/debug/debug.ts:76

### 29. Low: `FeatureEffect.refresh` says "the adapter calls it"

- Page: api/reference/feature-effects.
- Anchor: feature-effects.md:25.
- Claim: the reader does not know what the adapter is, or that it is the engine. The sentence matters: it tells the add-on when it must call `refresh` itself.
- Evidence: feature-effects.md:25; api/features.md:278 defines the full-screen adapter.
- Proposed edit: "The engine calls it when its quality changes. Call it yourself after a change that the sketch makes, such as a switch of its own."
- Generated source: packages/engine/src/scene/feature-effects.ts

### 30. Low: `MeshGeometry` names an id that the page does not show

- Page: api/reference/geometry.
- Anchor: geometry.md:480 `MeshGeometry`: "its id in the engine core, its bounding radius, and its morph targets".
- Claim: no `id` member appears in the table. The summary promises a field that a user cannot read.
- Evidence: geometry.md:476-493.
- Proposed edit: "A mesh the engine can draw: its bounds, its morph targets, its levels of detail and the calls that change its vertices."
- Generated source: packages/engine/src/scene/resources.ts:419

### 31. Not verified. Low: the stats panel's text speaks to comparison pages

- Page: api/reference/debug. Anchor: `StatsPanel` "a page that draws with another engine makes its own". The audience is the engine's comparison pages. Proposed edit: say that it is for pages that measure another engine beside null3D, and group it under the `@null3d/engine/stats` import (finding 1).

### 32. Not verified. Low: `LevelView.threshold` ties its default to presets

- Page: api/reference/geometry. Anchor: `LevelView.threshold` "The default is 1, the setting of the presets that High and above draw." Check against the quality preset tables; if the presets differ, state the value alone.

### 33. Not verified. Low: hold mode wording assumes the reader knows image tests

- Page: api/reference/engine. Anchor: `hold` "for image tests", `stats` "A held engine for image tests shows no overlay". The testing guide explains image tests; link guides/testing.md on first use.

## Screenshots, demo links and concepts without a demo, per page

Reference pages are lookup tables. A picture helps only where a type names a set of looks. Each image path follows `docs/images/api/reference/<page>/<name>.webp`, and each needs the generator to print it (finding 21). Demo links use `https://github.com/null3d-engine/null3d/tree/main/examples/<code>`.

### api/reference/animation
- Shots: none.
- Demos: `Animator` (play, blend, layers) under `Animator`: character/; `LookAtOptions`: look-at/; `PropertyAnimation`, `PropertyKeyframes`: property-animation/.
- No demo: `AnimationEvent` handlers, `StopOptions`.

### api/reference/assets
- Shots: none.
- Demos: `loadGltf`: gltf-model/; `loadEnvironment`: environment/; animated glTF: character/.
- No demo: glTF extension handlers (`registerGltfExtension`), download progress handlers.

### api/reference/cameras
- Shots: none.
- Demos: `SceneView`, `SceneViewOptions`: multiple-views/; `PerspectiveCamera` lens: camera-lens/; `Ray`: picking/.
- No demo: `OrthographicCamera`.

### api/reference/controls
- Shots: gizmo handles (`GizmoAxis`), reference image of gizmos/.
- Demos: `createFirstPersonControls`, `createFlyControls`: walk-and-fly/; `createTransformControls`: gizmos/; `createOrbitControls`: generators/ (and most feature demos).
- No demo: `createMapControls`, `createDragControls`.

### api/reference/debug
- Shots: the stats overlay open over a demo (scripted, instances/ with `?stats`), under `Debug`'s `stats` member.
- Demos: none of the drawing calls.
- No demo: `debug.line`, `box`, `axes`, `grid`, `frustum`, `view`, `frameStats`, `StatsPanel`.

### api/reference/engine
- Shots: none.
- Demos: `hold` option: hold-mode/; `largeWorld`: large-world/ and far-from-origin/; `transparent`: depth-only/.
- No demo: `registerVideo`, `saveRecording` with `?record`, `simulateGpuLoss`, `capture`.

### api/reference/feature-draws
- Shots: none. Demos: none (the splats package uses `addFeatureDraw` internally).
- No demo: `FeatureDraw`, `FeatureDrawOptions`.

### api/reference/feature-effects
- Shots: none. Demos: none. No demo: `FeatureEffect`, `post.addFeatureEffect`.

### api/reference/feature-instances
- Shots: none. Demos: none. No demo: `ComputeInstances`, `addFeatureInstances`.

### api/reference/features
- Shots: none.
- Demos: `defineFeature` with a sky layer: aurora/.
- No demo: `declareAddonNamespace`, the draw, effect and instance kinds.

### api/reference/geometry
- Shots: none (the written page owns the shape pictures).
- Demos: generators: generators/; `fromArrays`: mesh-arrays/; `@null3d/geometry` shapes and curves: extra-shapes/; `updateVertices`: vertex-updates/; levels of detail: forest/; morph targets: morph-flowers/.
- No demo: the level rule functions (`levelAt` and the others), `CurvePath`, `Path`.

### api/reference/grass
- Shots: none.
- Demos: `createGrass`: vegetation-wind/ and contact-shadows/.
- No demo: `hashAt`, `pcg`, `unitAt`, `GrassBladeShape`.

### api/reference/impostors
- Shots: none.
- Demos: `createImpostors`, `bakeImpostorAtlas`, `mergeFarGeometry`, hand-over: impostors/.
- No demo: `loadImpostorAtlas` (a file the command line tool writes).

### api/reference/input
- Shots: none.
- Demos: `Input`, `InputActions`: input/; object pointer events: picking/.
- No demo: `InputTouch`.

### api/reference/lights
- Shots: the light kinds side by side (scripted from the test pages lights-rect, lights-tube, lights-spot, lights-hemisphere), under the page's index.
- Demos: `RectAreaLight`, `TubeLight`: area-lights/; `SpotLight.setMap`: spot-cookies/; `DirectionalLight` shadows: hero-shadow/.
- No demo: `AmbientLight` alone, `LightImagePixels`.

### api/reference/lines
- Shots: none. Demos: `LineBatch`: sprites-lines/. No demo: none.

### api/reference/materials
- Shots: `AlphaMode` values side by side (scripted from the test pages alpha-mask, alpha-hash, alpha-coverage, blending), under `AlphaMode`.
- Demos: `materials.shader`: shader-inputs/; clear coat, sheen: coat-and-sheen/; iridescence, anisotropy: iridescence-and-anisotropy/; transmission: translucency/; subsurface: subsurface/; decals: decals/; weighted blending: weighted-transparency/.
- No demo: `ShadowCatcherValues`.

### api/reference/math
- Shots: none. Demos: `vec3`, `quat`, `createMath`: math/. No demo: `color` namespace on its own.

### api/reference/objects
- Shots: none. Demos: `setParent`, `Group`: objects/; layers: layers/. No demo: `setOccluder`.

### api/reference/particles
- Shots: none.
- Demos: `createParticles`, `particleTextures`, sub-emitters: particles/.
- No demo: `ParticleBuffer` used directly.

### api/reference/points
- Shots: none. Demos: `PointBatch`: galaxy/. No demo: none.

### api/reference/post
- Shots: `ToneMapping` curves side by side (scripted from the test pages tone-agx, tone-agx-punchy, tone-aces, tone-neutral, tone-reinhard, tone-cineon, tone-none), under `ToneMapping`.
- Demos: post chain: post-effects/; `AutoExposureSettings`: auto-exposure/; `SsrSettings`: wet-street/; `DofSettings`: camera-lens/; bounce light: bounce-light/; `toneMapped: false`: tone-mapped/.
- No demo: `GradingSettings`, `SplitToningSettings`, `VignetteSettings`, `OutlineSettings`.

### api/reference/quality
- Shots: none (the quality preset pages own the side-by-side pictures).
- Demos: `quality.set`: forest/ and showroom/.
- No demo: `quality.setBudget`, `QualityGovernor`, `PresetCheck`.

### api/reference/raycast
- Shots: none. Demos: picking and raycasts: picking/. No demo: `raycastBatch`, overlap queries.

### api/reference/render
- Shots: none.
- Demos: scene pass: security-camera/; compute passes: ocean/; reflection pass: water/.
- No demo: `ComputeFallback`, `PassReadResult`.

### api/reference/scene
- Shots: `FogMode` values side by side (scripted from the test pages fog-linear, fog-exponential, fog-exp2, fog-height), under the fog type.
- Demos: `timeOfDay`: time-of-day/; `AtmosphereBackground`: atmosphere/; reflection probes: reflection-probes/; instance batches: instances/; environment: environment/; sky layer: aurora/.
- No demo: `addFeatureDraw`, `bakeProbes`.

### api/reference/sketch
- Shots: none. Demos: fixed steps and seeded runs: replay/. No demo: `SketchPreferences`.

### api/reference/sound
- Shots: none. Demos: `createSound`, `connectSound`, groups, shots, loops: sound/. No demo: none.

### api/reference/splats
- Shots: none. Demos: `createSplats`, streaming: splats/. No demo: `decodeSpz`, `encodeSpz`, `parseStreamIndex`, `chunkSplats`.

### api/reference/sprites
- Shots: none. Demos: `SpriteBatch`: sprites-lines/. No demo: `SpriteAtlas`.

### api/reference/tasks
- Shots: none. Demos: none. No demo: `runTask`, `TaskModule`, `WasmFile`.

### api/reference/terrain
- Shots: none. Demos: `createTerrain`, `terrainTextures`: terrain/. No demo: `createHeightfield` on its own.

### api/reference/textures
- Shots: `TextureWrap` values (scripted, a test page with clamp, repeat and mirror side by side).
- Demos: `textures.fromCanvas`: canvas-screen/; `textures.fromPass`: security-camera/.
- No demo: `textures.fromVideo`, compressed formats.

### api/reference/three-compat
- Shots: none. Demos: none. No demo: `createOutlinePass`, `cineon`, `reinhard`.

### api/reference/time
- Shots: none. Demos: hold mode and `held`: hold-mode/. No demo: none.

### api/reference/ui
- Shots: `LabelTransform` values: reference image of css3d-labels/ shows `world` labels; picking/ shows `screen` labels.
- Demos: `trackLabel`, `EngineLabels.bind`: picking/ and css3d-labels/.
- No demo: `rotation` on a billboard label.

### api/reference/vertex-draws
- Shots: none. Demos: `VertexDraw`: rain/. No demo: none.

### api/reference/water
- Shots: none.
- Demos: `createWater`, `foamMap`: water/; `createOcean`: ocean/; `createWaterfall`, `createUnderwater`: showcase/creek/.
- No demo: `waveHeight` used by a sketch.

### api/reference/wind
- Shots: none. Demos: `createWind`: vegetation-wind/. No demo: `WindReading` in a custom material.
