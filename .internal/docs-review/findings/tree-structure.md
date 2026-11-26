# Docs tree structure review

Scope: the set of areas, groups beneath them, page order, splits, merges, renames, the newcomer path, and missing pages. Sources read: every page's front matter, the heading outlines in `stats.json`, `docs/index.md`, `docs/pages.md`, and `AREAS` and `PAGES` in `tools/lib/docs.ts`.

## How groups and order should work

- Add a `group` to each `PageEntry` in `PAGES`, and give each area in `AREAS` its ordered list of groups. `pages.md` renders a `###` heading per group. The website builds its sidebar from the same order. One source per fact: the inventory holds the group, not the front matter.
- Give generated pages a slot in the order. Today `pageList` ranks every page that `PAGES` leaves out at the end of its area, so `errors/index` comes after 80 error pages, and `quality-preset-tables`, `first-use-shaders` and `threejs-mapping` all sit last. Add an ordering list for generated pages (or let `PAGES` name them with a `generated: true` flag that the "written pages only" check skips).
- Navigation leaves out `api/reference/*` (already) and `errors/E*` (new). The error pages stay reachable from the `errors/index` table and from each error message.
- Every move below changes a page ID. Coding agents and the skills look pages up by ID (`api/materials` alone has 73 links from `skills/`). So each move updates the skills' links in the same branch, and the docs link check proves none is left. Moves are kept to pages that sit in the wrong area. Groups never change an ID.

## Proposed tree

Area order: learn, then do, then ship, then port, then reference.

`index` and `pages` stay at the root.

### 1. Getting started (`getting-started`), no groups

| # | Page | Change |
| --- | --- | --- |
| 1 | `getting-started/install` | keep |
| 2 | `getting-started/first-scene` | keep |
| 3 | `getting-started/model-viewer` | NEW. "Show a model": load a glTF model, light it with an environment map, add orbit controls. The second step after the first scene. |
| 4 | `getting-started/project-structure` | keep; title "Start from a template" |
| 5 | `getting-started/examples` | NEW. "Examples and showcases": how to run the repository's demos, and a list of demos by topic with links to `examples/<code>`. |
| 6 | `guides/agents` -> `getting-started/agents` | move. The engine is built for coding agents, so agent setup is a first step. |
| 7 | `getting-started/cdn` | keep |
| - | `getting-started/hosting` -> `deploy/hosting` | moved out |
| - | `getting-started/network-use` -> `deploy/network-use` | moved out |
| - | `getting-started/third-party-notices` -> `deploy/third-party-notices` | moved out |

### 2. Concepts (`concepts`), three groups

How the engine runs:

1. `concepts/architecture`
2. `concepts/handles`
3. `concepts/static-dynamic`
4. `concepts/backends` (title "GPU paths and tiers": the pages use "GPU path" most)
5. `concepts/quality-presets`
6. `concepts/quality-preset-tables` (generated; directly after its explanation)
7. `concepts/glossary` NEW. One line per coined term: sketch, page module, sketch worker, render worker, job workers, GPU path, tier, preset, preset check, frame-budget governor, hold mode, instance batch, row, handle, static and dynamic, scene pass, feature, add-on.

Scene data:

8. `concepts/assets`
9. `concepts/culling`
10. `concepts/lod`
11. `concepts/large-worlds`
12. `concepts/render-layers`

Rendering:

13. `concepts/color-management`
14. `concepts/materials`
15. `concepts/lighting` (split: keeps light kinds, units, clustered shading, lights as objects, ambient and hemisphere lights, lights far from the origin, lights in scene passes)
16. `concepts/environment` NEW (split from `concepts/lighting`): environment maps, reflection probes, light probe grid, sky and backgrounds, time of day, fog.
17. `concepts/shadows`
18. `concepts/render-graph`
19. `concepts/post-processing`

Moved out: `concepts/instances` -> `api/instances`; `concepts/particle-buffer` -> `extend/particle-buffer`.

### 3. Guides (`guides`), six groups

Performance:

1. `guides/performance` (split: keeps the causes of slow frames and their fixes)
2. `guides/profiling` NEW (split from `guides/performance`): Where frame time goes, Measure, Measure fairly, Memory peak, Browsers differ.
3. `guides/phones`
4. `guides/loading-screens`
5. `guides/first-use-shaders` (generated; directly after the page that explains it)

Pages and UI:

6. `guides/ui-overlays` (title "HTML UI over the scene")
7. `guides/content-pages`
8. `guides/accessibility`
9. `guides/multiple-views`
10. `guides/video-textures`

Game systems:

11. `guides/physics`
12. `guides/deterministic-simulation`
13. `guides/audio`

Rendering:

14. `guides/custom-passes`
15. `guides/baked-light-data`

Example add-ons:

16. `guides/example-add-ons` NEW. The seven example add-ons in `examples/addons` (aurora, car paint, facades, lens kit, screens, traffic lanes, weather): what each draws, how to copy one in, links to each README and demo. Four of the seven have no docs page today.
17. `guides/car-paint`
18. `guides/lens-kit`
19. `guides/screens`

Testing and debugging:

20. `guides/testing`
21. `guides/debugging`

Moved out: `guides/agents` -> `getting-started/agents`; `guides/custom-shaders` -> `shaders/custom-shaders`; `guides/assets-pipeline` -> `cli/assets`; `guides/add-ons` -> `extend/add-ons`; `guides/deploying` -> `deploy/index`; `guides/start-time` -> `deploy/start-time`.

### 4. Cookbook (`cookbook`), no groups

One recipe per page. The recipe tests already read every file in `docs/cookbook/`, so a split needs no test change.

1. `cookbook/index` (the list of recipes, with one line each)
2. `cookbook/select-objects` NEW (split): Select objects with the pointer
3. `cookbook/click-to-walk` NEW (split): Walk to the point that the user clicks
4. `cookbook/third-person-camera` NEW (split)
5. `cookbook/crowd` NEW (split): A crowd of animated characters
6. `cookbook/model-loading-screen` NEW (split): A loading screen for models
7. `cookbook/morph-targets` NEW (split): Morph targets from a model
8. `cookbook/sun-and-fog` NEW (split): A sky with a moving sun and fog
9. `cookbook/glow-effect` NEW (split): Glow and a custom effect
10. `cookbook/camera-screen` NEW (split): A screen that shows another camera
11. `cookbook/world-screens` NEW (split): Screens in the world
12. `cookbook/trail` NEW (split): A trail behind a moving object
13. `cookbook/star-field` NEW (split): A field of stars
14. `cookbook/hidden-by-walls` NEW (split): Hide what walls hide

### 5. Shaders (`shaders`), no groups

1. `guides/custom-shaders` -> `shaders/custom-shaders` (move; the area's entry page)
2. `shaders/surface-functions`
3. `shaders/builtins`
4. `shaders/library` (generated)
5. `shaders/wgsl-rules` (moved from first to last: it is the portability reference, not the start)

### 6. Deploying (`deploy`), NEW area, no groups

1. `guides/deploying` -> `deploy/index` (the checklist: build, headers, caching, Brotli, size budgets, check the deployed page; each step one short paragraph that links to the detail)
2. `getting-started/hosting` -> `deploy/hosting` (the full detail of headers, isolation, CSP, CDN files, Electron, offline play)
3. `guides/start-time` -> `deploy/start-time`
4. `getting-started/network-use` -> `deploy/network-use`
5. `getting-started/third-party-notices` -> `deploy/third-party-notices`

### 7. Porting from three.js (`porting`), no groups

1. `porting/threejs-overview`
2. `porting/threejs-loop-and-threads` (moved up: the structural change comes first)
3. `porting/threejs-mapping` (generated; moved up from last: it is the lookup table that every later page leans on)
4. `porting/threejs-materials`
5. `porting/threejs-shaders`
6. `porting/threejs-postprocessing`
7. `porting/react-three-fiber`
8. `porting/threejs-unsupported`
9. `porting/verification`

### 8. API reference (`api`), seven groups

Entry points:

1. `api/engine`
2. `api/sketch`
3. `api/page`

Scene and objects:

4. `api/scene` (split: keeps creating objects, models and copies, finding by name, the camera and background, views, decals, the one-material override, when changes take effect, warm-up, instance batches, limits)
5. `api/objects`
6. `api/cameras`
7. `api/lights`
8. `api/environment` NEW (split from `api/scene`): the environment, the light probe grid, reflection probes, fog, time of day. Its symbols move to `@category api/environment`.
9. `api/geometry`
10. `api/materials` (split: keeps the materials, shadow catchers, standard values, texture maps, texture coordinate transform, color, changing and destroying, options fixed at creation, alpha modes, hidden and double-sided surfaces, blending, depth bias, custom materials, ranges, limits)
11. `api/material-layers` NEW (split from `api/materials`): specular and index of refraction, transmission, thin surfaces, light under the surface, clear coat and sheen, iridescence and anisotropy, relief.
12. `api/textures`
13. `api/assets`
14. `api/animation`

Many copies:

15. `concepts/instances` -> `api/instances` (move; it has the same outline as sprites, points and lines, and gains a reference page)
16. `api/sprites`
17. `api/points`
18. `api/lines`
19. `api/vertex-draws`

Interaction:

20. `api/input`
21. `api/controls`
22. `api/raycast`
23. `api/ui` (title "Labels that follow objects")

Rendering and quality:

24. `api/post`
25. `api/render`
26. `api/quality`
27. `api/debug`

Utilities:

28. `api/time`
29. `api/math`

Add-on packages:

30. `api/particles`
31. `api/impostors`
32. `api/terrain`
33. `api/grass`
34. `api/splats`
35. `api/water`
36. `api/wind`
37. `api/sound`
38. `api/three-compat` (moved from between geometry and materials)

Moved out: `api/features`, `api/feature-draws`, `api/feature-effects`, `api/feature-instances`, `api/tasks` -> `extend/*`.

### 9. Extending null3D (`extend`), NEW area, no groups

For add-on authors. Most apps never need this area, and the docs home says so.

1. `extend/index` NEW. "Choose an extension point": surface function, custom effect, scene pass, vertex draw, feature draw, feature effect, instance draw, task. What each can do, its cost, and its page.
2. `guides/add-ons` -> `extend/add-ons`
3. `api/features` -> `extend/features`
4. `api/feature-draws` -> `extend/feature-draws`
5. `api/feature-effects` -> `extend/feature-effects`
6. `api/feature-instances` -> `extend/feature-instances`
7. `api/tasks` -> `extend/tasks`
8. `concepts/particle-buffer` -> `extend/particle-buffer` (its own banner says coding agents must not use these calls; it is for emitter authors)

Cost: `referencePageId` and `referenceLink` in `tools/lib/docs.ts` assume the `api/` prefix, and 52 `@category api/<page>` tags name these pages. Generalize the two functions to any area and retag. Fallback if that cost is too high: keep the five API IDs and put them in a last API group "Add-on authoring", and move only `guides/add-ons` and `concepts/particle-buffer`.

### 10. Command-line tool (`cli`), no groups

1. `cli/null3d` (split: keeps installing the tool, the list of commands, `create`, `upgrade`, `check-addon` and "Where the commands draw")
2. `cli/test` NEW (split from `cli/null3d`): `test`, `shot`, replaying a recording, timed scripts
3. `cli/bench` NEW (split from `cli/null3d`)
4. `cli/mcp` NEW (split from `cli/null3d`): the one home of the MCP server
5. `guides/assets-pipeline` -> `cli/assets` (move; merge the `assets` section of `cli/null3d` into it)

### 11. Errors (`errors`), no groups

1. `errors/index` (first, and the only error page in navigation)

## Findings, ranked

### 1. high: the docs home does not start a newcomer (index)

"Where to start" links architecture, backends, performance, phones, hosting and the three.js mapping. It never links Install or Your first scene. A newcomer who lands on the home page has no first step.

Edit: make "Where to start" a set of paths. "New to null3D": Install, Your first scene, Show a model (new), Examples (new). "Porting from three.js": the porting overview. "Working with an agent": the agents page. "Shipping": the deploy checklist. Keep architecture and backends under "How it works".

### 2. high: "Roadmap step" on 103 pages and a "Step" column (cross-page)

Every written page opens with "Roadmap step 0.x, first released in null3D 0.1.0". `index.md` and `pages.md` explain a "step column". A roadmap is an internal plan, which the writing rules keep out of `docs/`. A reader also sees `since: "0.3"` on a page that first shipped in 0.1.0, and cannot tell what 0.3 means.

Edit: name releases only. Set `since` to the first release that ships the page (0.1.0 for all current pages), print "First released in null3D 0.1.0", and rename the column "Since". Source: `tools/lib/steps.ts` (`STEPS_NOTE`, `releaseOf`, `shipsSentence`), the `since` values in `PAGES`, every page's front matter, and the step sentences in `index.md`.

### 3. high: generated pages always fall to the end of their area, and errors/E* flood the list (pages.md)

`pageList` ranks a page that `PAGES` leaves out at `MAX_SAFE_INTEGER`. So `errors/index` comes after all 80 error pages, `concepts/quality-preset-tables` sits after post-processing, `guides/first-use-shaders` after agents, and `porting/threejs-mapping` after verification. The page list shows 80 error rows that navigation should not hold.

Edit: give generated pages an order slot; list only `errors/index` in the errors area. Source: `pageList` and `pageListPage` in `tools/lib/docs.ts`.

### 4. high: no area has a group level (tools/lib/docs.ts)

API reference has 39 pages in one flat list and Guides has 25. A reader cannot scan them, and related pages sit far apart (`api/three-compat` between geometry and materials; `guides/first-use-shaders` far from `guides/loading-screens`).

Edit: add `group` to `PageEntry` and ordered groups to `AREAS`; render `###` group headings in `pages.md`. Groups per area are in the proposed tree.

### 5. medium: getting-started mixes first steps with production and licence pages

Install, first scene, then hosting (4792 words), network use and third-party notices, then the CDN, then project structure. A newcomer meets COOP, COEP, CSP and licence lists before the template command. Agent setup, which the engine's own pitch puts first, sits in Guides.

Edit: order install, first-scene, model-viewer (new), project-structure, examples (new), agents (moved from guides), cdn. Move hosting, network-use and third-party-notices to the new `deploy` area.

### 6. medium: deployment is spread over three areas and repeats itself (getting-started/hosting, guides/deploying, guides/start-time)

All three explain the two isolation headers, Brotli and cache lifetimes. `guides/deploying` sections "Send the two headers", "Let browsers keep the files", "Compress with Brotli" repeat `hosting` sections "The two headers", "Let browsers keep the build files", "Send the files with Brotli", and `start-time` "Compress every file", "Let the browser keep the files", "Serve over HTTP/2".

Edit: new area `deploy`. `deploy/index` (from `guides/deploying`) is a short checklist that links to the detail. `deploy/hosting` holds the full header, cache and compression detail once. `deploy/start-time` keeps only what is about the start and links to hosting for the rest. Move network-use and third-party-notices in too.

### 7. medium: API reference needs seven groups

Edit: Entry points (engine, sketch, page); Scene and objects (scene, objects, cameras, lights, environment, geometry, materials, material-layers, textures, assets, animation); Many copies (instances, sprites, points, lines, vertex-draws); Interaction (input, controls, raycast, ui); Rendering and quality (post, render, quality, debug); Utilities (time, math); Add-on packages (particles, impostors, terrain, grass, splats, water, wind, sound, three-compat). `api/page` moves up beside engine and sketch: it is how the two modules talk.

### 8. medium: Guides needs six groups

Edit: Performance; Pages and UI; Game systems; Rendering; Example add-ons; Testing and debugging, with pages as in the proposed tree.

### 9. medium: Concepts needs three groups and a new order

`concepts/assets` and `concepts/post-processing` come last, after LOD and culling, and the order follows no model.

Edit: How the engine runs; Scene data; Rendering, as in the proposed tree.

### 10. medium: add-on authoring pages are scattered over three areas

`guides/add-ons`, `api/features`, `api/feature-draws`, `api/feature-effects`, `api/feature-instances`, `api/tasks` and `concepts/particle-buffer` serve add-on authors only. They sit among the pages an app developer reads, and `particle-buffer` says coding agents must not use its calls.

Edit: new area `extend` with a new `extend/index` that picks an extension point. Generalize `referencePageId` and `referenceLink`, and retag the 52 `@category` tags. Fallback in the tree section.

### 11. medium: the shaders area has no entry page

The area opens with "WGSL rules for portable shaders", a list of limits. The tutorial, `guides/custom-shaders`, sits in Guides.

Edit: move `guides/custom-shaders` to `shaders/custom-shaders` as the first page; move `wgsl-rules` last.

### 12. medium: concepts/instances is an API page in the concepts area

Its outline (Create a batch, The row arrays, Static and dynamic batches, Per-row colors) matches `api/sprites`, `api/points` and `api/lines`. It has no API reference link, while its siblings do.

Edit: move to `api/instances` in the "Many copies" group; tag its symbols `@category api/instances`. The short "Automatic batching" model can stay as a section or move into `concepts/static-dynamic`.

### 13. medium: api/materials is 13,672 words in 27 sections

It is the largest written page, with 29 long paragraphs and 21 subheadings. The physical layers (transmission, subsurface, clear coat, sheen, iridescence, anisotropy, relief) are a topic of their own.

Edit: split into `api/materials` and `api/material-layers` (NEW). Retag the moved symbols. Dense formulas and ranges inside each section go into `<details>` blocks instead of being cut.

### 14. medium: api/scene holds the whole environment API

8,672 words and 28 long paragraphs. The environment, light probe grid, reflection probes, fog and time of day are a separate topic from creating objects.

Edit: split those sections into `api/environment` (NEW) in the "Scene and objects" group.

### 15. medium: concepts/lighting covers both lights and the environment

9,783 words, six Mermaid diagrams, 19 long paragraphs. Half the page (environment maps, reflection probes, light probe grid, sky, time of day, fog) is the environment.

Edit: split into `concepts/lighting` and `concepts/environment` (NEW), matching the API split.

### 16. medium: each post effect is explained twice (concepts/post-processing, api/post)

Both pages have a section per effect: bloom, ambient occlusion, screen-space reflections, depth of field, outlines, color grading, vignette, sharpening, automatic exposure. The pages are 7,853 and 6,764 words.

Edit: `api/post` holds each effect's settings and example. `concepts/post-processing` holds the chain (HDR target, order, render scale, the single final pass, devices without HDR) and links to each effect. Each effect's inner workings move into a `<details>` block under its `api/post` section.

### 17. medium: the command-line tool is one 7,450-word page, and its largest command lives in Guides

`cli/null3d` holds ten commands, five Mermaid diagrams and 13 subheadings. The `assets` command's full guide (8,386 words) is `guides/assets-pipeline`.

Edit: split `cli/test`, `cli/bench` and `cli/mcp` out of `cli/null3d`; move `guides/assets-pipeline` to `cli/assets` and merge the `assets` section into it.

### 18. medium: the MCP server is explained on three pages, the inspector on two

"The MCP server" is a section in `guides/agents` and in `guides/debugging`, and `mcp` in `cli/null3d`. Each gives the same three ways to reach a scene. "The in-page inspector" is in `api/debug` and `guides/debugging`.

Edit: one home each: `cli/mcp` for the server, `guides/debugging` for the inspector (with `api/debug` keeping only the `engine.inspect` call). The other pages keep one sentence and a link.

### 19. medium: the cookbook is one page of 13 recipes, and it sits last

3,831 words on one page. A recipe cannot be found by ID or listed in navigation. The cookbook is the closest thing to how-to examples, but it comes after Errors.

Edit: one page per recipe under `cookbook/` with `cookbook/index` as the list. Move the area after Guides.

### 20. medium: missing page, the step after the first scene (getting-started/model-viewer)

"Your first scene" ends with links to objects, static and dynamic objects, instances and messages. A newcomer's next need is a real model with good light and a camera to move. That needs three pages today: assets, lighting and controls.

Edit: NEW `getting-started/model-viewer`: load a glTF model, set an environment map, add orbit controls, wait for `firstFrame`. Add it first under "Next steps" in `first-scene`.

### 21. medium: missing page, examples and showcases (getting-started/examples)

The repository has more than 60 demos and four showcase apps (creek, island, skyway, showroom). No page says they exist or how to run them.

Edit: NEW `getting-started/examples`: how to run the demos, and a list by topic with links to `https://github.com/null3d-engine/null3d/tree/main/examples/<code>`.

### 22. medium: missing page, glossary (concepts/glossary)

The docs coin many terms: sketch, sketch worker, GPU path, tier, preset check, frame-budget governor, hold mode, row, scene pass, feature. Each is defined on a different page, and some appear before their definition.

Edit: NEW `concepts/glossary`, one line per term with a link to its page. Link it from the docs home.

### 23. low: four example add-ons have no page (guides)

`examples/addons` holds seven add-ons. Car paint, lens kit and screens have guide pages. Aurora, facades, traffic lanes and weather have none. Nothing says the three guides are example add-ons that you copy, until you open one.

Edit: NEW `guides/example-add-ons` that lists all seven and links each README and demo; group the three existing pages under it.

### 24. low: missing page, choosing an extension point (extend/index)

Seven ways to add drawing work exist: surface functions, custom effects, scene passes, vertex draws, feature draws, feature effects, instance draws, plus tasks. No page compares them.

Edit: NEW `extend/index` with a table: what each does, which thread it runs on, cost, and its page.

### 25. low: the porting area order

The mapping table, which every other porting page leans on, is last (it is generated). Threads and the loop, the biggest structural change, is fifth.

Edit: order overview, loop-and-threads, mapping, materials, shaders, post-processing, React Three Fiber, unsupported, verification.

### 26. low: near-identical titles for two UI pages (api/ui, guides/ui-overlays)

"UI overlays and labels" and "UI, HTML overlays and labels" sit in two areas. Both explain labels.

Edit: rename titles to "Labels that follow objects" (`api/ui`) and "HTML UI over the scene" (`guides/ui-overlays`). The guide links to the API page for labels and keeps the HTML layout and GUI panels.

### 27. low: guides/performance mixes measuring with fixing

8,423 words in 21 sections. "Where frame time goes", "Measure", "Measure fairly", "Memory peak" and "Browsers differ" are about measuring.

Edit: split those into `guides/profiling` (NEW). The performance guide opens with a link to it.

### 28. low: area order puts API reference before Guides

Today: getting started, concepts, API, guides, shaders, porting, CLI, errors, cookbook.

Edit: getting-started, concepts, guides, cookbook, shaders, deploy, porting, api, extend, cli, errors. Learning and doing come first, reference last.

### 29. low: concepts/lod opens with how-to steps, not the model

The concept rule asks for a diagram and a plain explanation first. `concepts/lod` opens with "Levels of meshes made in code" and "Give a mesh its levels by hand", and "How the engine picks a level" is seventh.

Edit: move "How the engine picks a level", "Fading between levels" and "Distance bands" to the top. "Cluster levels" and "Pieces of a large level" go into `<details>` blocks.

### 30. low: concepts/backends title uses three names for one idea

"GPU tiers and backends", while the pages say "GPU path" most often.

Edit: title "GPU paths and tiers"; keep the ID.

### Lower-ranked, only in this file

- low: `guides/audio` has `since: "0.1"`, but the `@null3d/sound` package it teaches is `since: "0.3"`. Align the values (moot once finding 2 lands).
- low: `api/page` as an ID reads like "the page module" or "pages.md". It matches the context field `page`, so keep the ID, and make the title "Messages between the sketch and the page" consistent in every link text.
