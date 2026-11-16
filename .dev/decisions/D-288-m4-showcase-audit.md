# D-288: M4 starts by auditing and fixing the showcase scenes

Status: decided by the owner. Tasks: M4-S1 to M4-S9.

Summary: M4 starts by auditing every showcase scene with one set of methods, and fixing what they find. The Island scene then continues to its full brief: real models, the FFT ocean, scripted people and cars, and fine detail at any zoom. This record holds that brief, every open fault, what was tried and rejected, and what a session owes to land the `m3-start-2` branch. It stands alone: nothing else records these rulings.

## Question

The Island is a mock-up with known faults, and the other showcase scenes have not had the same scrutiny. What must M4 do first, and how does an engineer with no history of this work do it?

## Decision

| Task | Work |
|---|---|
| M4-S1 | Build the audit tools and run the audit on Creek, Skyway and any other showcase scene. Fix what it finds |
| M4-S2 | Island: settle speed at High, the slow mode, and the stats card's memory reading |
| M4-S3 | Island: the tree hand-over and the forest's look |
| M4-S4 | Island: the route's pace and framing, and the water's remaining faults |
| M4-S5 | Island: real models, fine detail, and imported plants where needed |
| M4-S6 | Island: the FFT ocean with surf and waves |
| M4-S7 | Island: scripted people and cars |
| M4-S8 | Engine: the smaller faults and limits below, and the bounce light's cost for its owner |
| M4-S9 | Real phones, tablets, Firefox and Safari for every showcase scene |

## M4-S1: the audit

Run each method on each showcase scene, on every rendering mode and preset. A whole-route figure comes from the whole route: a part of it misled this work more than once. Repeat each speed run, since one run misleads too.

| Method | What it shows | How to rebuild it |
|---|---|---|
| Held frames at route times | The look at known moments, with no timing noise | Open `tests/pages/image.html?sketch=<scene>&hold=<seconds>&size=1280x720&preset=<preset>&gpu=<path>` in Playwright through `launchChromium` from `packages/cli/src/browser.js`. Wait for `globalThis.__null3dHold`, then write its `pixels` with `writePng` from `packages/cli/src/png.js` |
| A held camera at any pose | A close look at one fault | A temporary `?pose=x,y,z,tx,ty,tz` read in the scene's sketch, which sets the camera after the route's update. Remove it before committing |
| Live manual camera | Zoom, orbit and pan as a visitor does | Open the demo page, press `C`, and drive it with Playwright's mouse and keys |
| Plan map | Roads, houses and trees from above, with counts | Import the scene's plan under `bun --conditions=null3d-source`, and draw its roads, lots and spots into a PNG |
| Route sampling | Speed, acceleration, turning rate, joins | Step `routePosition(routeTimeline(SHOTS), t, out)` at 60 Hz in a test file. `examples/lib/showcase-routes.test.ts` holds the limits |
| Frame-by-frame recording | Popping, flicker, flashes | CDP `Page.startScreencast` on the live page, with each frame's own time. Hide the page's panels first. Load the frames with `decodePngRgba` |
| A fixed-step route | The same path in two builds | A temporary line in the sketch that calls `film.update` with a fixed step, from a fixed start |
| One-frame jump finder | Where to look, never a verdict | Split frames into tiles, and flag a tile whose change in one frame exceeds its neighbours in time and the frame's median. Its counts swing by a factor of two between like runs, so judge by looking at the flagged frames |
| Camera jump | Whether a reflection or other second view lags | `tests/image/reflection-lag.spec.ts` and its page |
| Whole-route speed | Frame rate, frame work, triangles, render scale | Open the demo with `stats=open`, read the overlay's text each second for the whole route, and print average, 5th percentile, slowest second and seconds under 60. Set `deviceScaleFactor` to fix the pixel ratio. Note the machine's load |
| GPU call and thread cost | What a slow thread does | `bun run bench:profile`, with `--thread sketch` and a core built by `bun tools/build-wasm.ts --names`. Wrap WebGL calls on the render worker with a timer to find a blocking call |

Modes: `?gpu=webgpu&direct=off`, `?gpu=webgpu&direct=on`, `?gpu=compat`, `?gpu=webgl2`, and `?preset=low` to `ultra`. A request for High on WebGL2 and compatibility runs at Medium, from the tier ceiling. With no preset, the start-up check picks one, and on this Mac it picks Low on WebGL2.

Look for: popping as levels and cards hand over; flicker on still and moving cameras; a route's speed changes and whips; levels of detail on at the start (the shared showcase controls leave them off unless a scene asks); memory on each path; flashes in the first and last frames of a page; the page returning to its loading screen.

Open a test browser with `--window-position` at the screen's edge and a `--window-size`, so that it does not block a person's view. On macOS the window is clamped to the screen, and the page stays visible at full frame rate. Check `document.visibilityState` in any new setup.

The route code's acceleration limits cover the Island and Creek. Skyway stays outside them: its route turns at 361 degrees a second near 155 s. Decide whether that is meant.

## The Island's brief

These are the owner's requirements. They all hold.

- It is a showcase of the engine at its fullest: an isolated Mediterranean island town. Several hills, hillsides and hilltops hold houses. There is a town centre, forest, parks, a golf course on a headland, a beach and a harbour bay with boats at anchor.
- Fidelity and layout match the concept pictures: architecture, beach and bay, church and market square, harbour, parks, golf course, cypress forest.
- It is summer. The sun stands at 10am by default, and the time of day stays adjustable.
- The visitor can orbit the whole island, and zoom or pan to any point, and see fine detail there: vegetation, roads, houses, buildings, beach and household objects.
- Placement is never random. It looks realistic, as in the pictures: roads first, houses along them, then trees.
- Roads make sense. No road ends abruptly or plunges down a hillside and stops. None is too steep. There are no hairpins, sharp corners or jagged edges, and curves are smooth. Side roads fork neatly or meet at right angles.
- Most houses have a road leading to them, even a small side road. Some are reached by a footpath, which really connects them to a road.
- The island stands alone in open sea, so the guide's ring of mountains does not apply. The owner exempts it.
- The layout is approved as the base for models. Do not reopen land, roads or house placement without the owner's ruling.
- The bounce light stays off on the island, on every preset, by the owner's ruling. The engine's default stays on from High up.

**Concept pictures.** The chosen set is the Mediterranean concept: whitewashed houses with terracotta roofs over several hills, a blue-domed church and market square, a small harbour, a curved golden beach, cypress forest, parks and a golf course on a headland. The pictures are in the owner's Higgsfield gallery, under these job IDs:

| Picture | Job ID |
|---|---|
| Bird's-eye | c2d952d1-829f-4d32-9505-8a34fe1cde50 |
| Surf | 828f12de-2b89-4792-aec5-148fa6630a5d |
| Hilltop | 04eaf279-ba67-4720-8ce8-e13e6e3ab906 |
| Overhead | 3d446b6d-a9c2-44a6-9977-5c76665053a1 |
| Town centre | 821dc1d9-d446-43c8-aafa-d4fe3b763285 |
| Hillside homes | 3d2f699e-30b7-4d61-98a5-5b2952cf5863 |
| Golf | 3537adfa-bb9c-45d0-8eb3-805680dbeb35 |
| Forest park | 8424bf29-afac-4038-b93a-a7a7edb803f0 |

### M4-S5: models and detail

Buildings, cars, objects and people become pre-made model files, complex ones. Only terrain and vegetation are generated, at load, and they come out the same every time. Vegetation may also be imported where needed. `examples/showcase/island/kit.ts` holds the mock-up's code-built meshes that the models replace.

These wait for models, so do not fix them before: tower, wall and house surfaces; boat decks and hulls; crude rocks and the breakwater's lumps; the tan rim on the headland; close-up cypress and olive form; climbing flowers, which are flat squares up close; parasols; plain window panes; flat road surfaces at eye level.

Near plants: eye-level forest floor has no litter or undergrowth, and the golf turf has no mown stripes. Both are open.

### M4-S6: the ocean

The FFT ocean is on the milestone. Swap it in through `examples/showcase/island/sea.ts`, which keeps the swap to one file, with surf and waves. Evenly spaced foam arcs read like ripples from above, and breaking waves are missing, so both belong here.

### M4-S7: scripted people and cars

Start with a few characters, and scale up over iterations. People walk around, get in and out of cars, and enter and leave buildings. They are animated. Cars drive around and park. All of it is scripted, nothing moves in sync, and there is enough randomness that it does not feel repetitive.

## Open faults

### M4-S2: speed and memory

- **Speed at High is not settled.** Readings on nearby code run from about 38 to 118 fps. On the last whole route with bounce off, at pixel ratio 1 on a busy machine: WebGPU High 73 average, slowest 45, 21 of 144 seconds under 60; a High request on WebGL2 72, slowest 48, 31 under 60. Render scale reached 0.8 on both. Take the figure on a quiet Mac, twice per path, at High on WebGPU and at Medium on WebGL2.
- **The slow mode.** Some runs read about 100 fps and some about 70, on old and new code alike, with sketch time doubled. The cause is unknown. The pixel ratio of the test's window changes the figures a lot, so fix it first.
- **The stats card reads 776 to 947 MiB of GPU textures in some runs,** on all paths, and 318 to 358 in others, steady over 70 s. It does not follow the bounce light or the pixel ratio. A spike or a counting fault: find out which.
- **The page returns to its loading screen** in some runs, seen three times. One was the dev server reloading. The other two were not explained.
- The route's card work costs about 117 to 100 fps over four pairs, half for cards that face the eye and start earlier, and half for 81 views. Low keeps 25.
- WebGL2's whole route, before the sky change: Low 68 and 51 fps, slowest 39 and 29; Medium 53 and 52, slowest 31 and 30.
- The physical sky on Low costs nothing measurable on a Mac. Its cost on a phone is unmeasured.

### M4-S3: trees and the forest

- **Trees change character as they hand over,** the owner's main complaint. Near trees are big, smooth, dark crowns. A little further out they are smaller, paler and speckled, and screen-door dots cross whole crowns during the change, at 105 to 128 s over the golf course and beach, and at any camera at that range. Match crown size, colour and gaps between the near tree and its card first: dots matter less once they match.
- **From straight above, the forest turns to rust.** The hills turn orange-brown with scattered trees, and each village sits in a dark red disc. Keep the cards' cover when looking down, and darken and mute the ground.
- **Brown chute on the south face.** A long, straight-sided bare strip with a flat top runs down the hill, clearest at 47 to 72 s and 127 s. Break its edges with trees and shrubs. Planting may move the stored plan.
- **Golf cypresses read near black** against bright turf.
- Low views' near leaves still read slightly brighter than their cards, and the olives' near colour was capped without a new measure.

Causes already fixed, so do not chase them again: near and far trees casting different shadows; flat roofs with faces at one depth; far houses without terrace rooms and chimneys; cards arriving late; cards squashed from above; pale patches from the sun's gloss on single leaves. Mesh level steps are not a cause.

### M4-S4: route and water

- **The camera whips away from the tower** at 100 to 103 s, from 5 to 12 m/s to 48 m/s within 3 s while turning at up to 48 degrees a second. For about a second the frame is almost all empty sea. Give the leg to the eastern hill much more time, or add a shot that keeps land in frame.
- **The tower's top is cropped** for much of the close-up, at about 77 to 97 s. Aim higher, or stand 10 to 15 m further out. The camera may not look up past the bounds' polar limit, and the test's clearance of 40 m holds.
- **A speed surge into the town climb,** 13 to 43 m/s in about 4 s at 37 to 47 s, and a dip to 5 m/s at 96 s. Even out the shot lengths.
- **Bare knob and court wall.** The knob under the tower is a smooth brown cone, and the court wall's corner meets it in a sharp V. Add scrub and rock, which may move the plan, and bury the corner.
- **Reflections, as the owner reported them: flickering, and delayed by a few frames.** Two causes are fixed. Fine ripples broke thin masts into dashes (e0a69a9f). The governor raised the count of frames between reflection draws to 8 at High and 16 at the page's own preset within seconds, so the water showed a reflection that many frames old (1d016784, which keeps the Island's count at 1). At a count of 1, a reflection changes in the same frame as what it mirrors on all three paths. Masts still zigzag continuously from the waves, which is how a thin line reflects in ripples. Check that the owner agrees. Other scenes keep the governor's raised count, and so the lag: reading the stale image with the camera that drew it would remove it for all of them.
- **Open sea flashing near black on WebGL2 at Low,** at 1.77 s of the owner's video, and on a recording at 58, 60, 71, 73 and 109 s, for up to about 10 frames. A resting reflection's new texture stayed empty after a render scale change (fixed by b9802d49, and made rarer by 1d016784). A whole WebGL2 route and three 85 s runs after that show none. Keep watching, since the cause of those exact moments was not isolated.
- **`tests/image/island-water.spec.ts` fails on d4525fa2,** 1.65% and 1.57% against its limit of 1.5%. Find the commit that moved it, and re-aim the test rather than raising the limit. Recheck on the latest code first.
- **Hard navy slab on the harbour water.** The mole's shadow is a sharp parallelogram offset from the mole. Boats and rocks no longer cast, so the mole could stop too.
- **Murk over the reef when zoomed in:** near purple-black water, brown-teal clouds and a dark contour along the shelf edge. Soft dark blotches near the reef remain from above.
- **Harbour colour** reads 36,116,103 against the concept's 12,85,105.
- **A pale milky plume** with a soft straight edge by the golf headland, and a dark smear where sand meets the brown bank.
- **Far ground through roads.** Ground at coarser cells can rise through a road by up to 1.8 m at the 7 m cell and 5.1 m at the 14 m cell, reduced by the allowed error set per preset. No test holds it, as the plan does not pass.
- **15 joins under 60 degrees** at 30 m back, 13 of them within 3 degrees, for the owner to rule on: 8,216 (52), -466,-349 (54), -124,84 and 0,203 (57), then 59 at -197,273, -383,-289, -100,0, -392,-223, 196,-360, 147,-296, 163,45, -437,-181, 163,-222, 110,-223, and 60 at -590,-48. Fixing one moves one or two house gates.
- Not surveyed: every plot base, wall end and road mouth; lawn on the east crown, bald patch, park slope, stray walls, harbour edge, grass by the square. Rings at other hours were checked at 7 and 17 hours only.

The veil on high views stands: with fog off, the far sea's red falls by only 9 to 13 levels. It is the scene's thin haze and the sky's horizon band.

## M4-S8: engine

- **`bench:allocation` fails on the milestone and this branch:** `generateMipmaps` in the WebGPU backend takes 160 to 171 bytes a frame on S1's render worker, against a budget of 4. Hard rule 1.
- **`hasReflection` allocates a closure per frame on 8-bit pages,** through `passes.some(...)`. Hard rule 1.
- **A view switched off for good keeps its targets.** A cadence's rest and a page's switch share one flag, so a view that has drawn keeps its passes and targets in the plan until it is removed, and it draws once at each size change. A canvas view would show for a frame. `view_drew` also goes by the view's place in the list, so it can carry over after a removal. Give the cadence a flag of its own.
- **A spent heap reserve stops the engine for good.** `RESERVE_SPENT` clears only at engine start, so after a small request takes the reserve, every frame reports E1109, even if the page frees memory. Let it recover where it can, or write the limit down.
- `fillHeapForTest` ships in the production core, for the test that needs it. The upload bound now serves only a forecast, and could be simplified.
- **WebGL2's reflection arrives a frame late on its first draw (E17).** Its path builds its layout in the cull step, before the frame graph gives the pass its target, so the material keeps its old texture group for a frame. An extra held frame works around it. The fix needs a change of frame order.
- **The bounce light's cost, for its owner:** S1 on WebGPU 3.18 to 4.36 ms of GPU time, +37.4%. S4 High on WebGPU +8 to +11%, and S4's WebGL2 GPU time +84%, about 4 ms, on that path's Medium row. With it off, S1 reads +4.4% and S4 +1.8%. D-284 gives its figures. WebGL2's noise at a character's feet differs from WebGPU's by 0.12% of pixels, so `skinning-sketch.ts` turns it off to hold the skin alone.
- **The bounce light and glossy surfaces.** The gather leaves out the plane of a mirror view, for the first two mirrors, but a glossy floor with no mirror view still sends its colour. No buffer holds roughness. The owner ruled out a roughness mask for now, and the guide names the limit.
- **S4 WebGL2's busiest thread,** 0.11 to 0.21 ms, on the milestone too. A profile puts about 0.085 ms in `LevelChoice::pick`, on 5,000 objects of CPU culling, which gained nearest-point distance, hiding and fades. Not bisected to one commit.
- S4 Medium's noise, 30 to 60%, leaves its small shifts unmeasurable.
- Compatibility mode loses MSAA for FXAA in a scene with a reflection, which is the named cost of fixing its double tone map.
- Ultra's slowest second on the Island was 21 fps at the worst view, not remeasured since.

## Tried and rejected

| Tried | Why not |
|---|---|
| Conifers from the add-on for the cypresses | A cypress map on the existing mesh looks closer to the concept |
| Temporal smoothing for the dots | It halves the dots on a still frame, but D-206 keeps it from shipping for 0.1.0 |
| A noise pattern in the level fade | It looks no better, and it redraws every fading picture |
| A wider fade band, 0.16 | More dots over more of the view |
| Alpha to coverage on cards | No visible change in the fade |
| A 200 m switch at High | Moves the dots to mid-view, and costs speed |
| Matching a texture across two render plans | It needs every id found after the slots are set, and it still makes framebuffers on each switch. Keeping a resting view's passes in the plan replaced it |
| A shaped bed for water wedges | A hard blue patch, and a wedge at the harbour. Fading the view path's share with the view's height replaced it |
| A skirt on the rocks | A dark curtain, then a blue one, then teal zigzags when tapered. The material's cut at the waterline replaced it |
| Plain blended foam, then dithered foam | It vanishes under the water, then it speckles. The moment layer replaced them |
| Following the view path to steeper angles | Turns the harbour navy |
| A full-size reflection | No gain in flicker |
| Turning bounce off on test pages to pass them | It hides the fault. Only the skinning page keeps this, by ruling, as bounce is not what it tests |
| A factor on the blue of near leaves | Turns olives lilac |

## Rulings that stand

Terrain level stays 5. Ground under roads stays at 0.34 m. Deep-cut walls are not needed: each of the 9 stations without one has at most 1.3 m of ground above the road. Rocks and climbing flowers wait for models.

## Landing `m3-start-2`

The commits on this branch are unsigned where 1Password refused, and they carry their trailers. Never touch the milestone branch from this work without a session that lands it.

### Faults on the milestone that this branch fixes

| Fault | Commit | Confirmed by |
|---|---|---|
| `demo-multiple-views` on WebGPU: the GPU rejects the frame | 1c4649af | Clean copy of the milestone fails |
| `reflection-water` on WebGPU and WebGL2, 1.6%: a sun glint through the bounce light | 5cb07f59 | Clean copy fails |
| Mirror pictures move by 3.7% from the bounce light on a mirror | b7e34e7c | Clean copy fails |
| Moment layer reads and writes one texture with depth of field | ce94f20c | Reading, and a test |
| Moment layer's passes form a cycle when declared again: WebGL2 draws nothing at Low | 0bf2a544 | Reading, and a test |
| Row colours lost on coarser levels | 246ae5f5 | Reading, and a test |
| Double tone map of a reflection on compatibility | 246ae5f5 | Reading |
| WebGL2 walks the texture table on each release, stalling to 2 to 4 fps | 3c9b2578 | Reading, and a test in 7b634895 |
| A reflection at a count over 1 rebuilds the plan on each switch | 4218ed56 | Reading, measures, and a test |
| Small requests can trap on a full heap | 772ef63b | Reading, and a forced test |
| Fine ripples flicker in reflections | e0a69a9f | Reading, and a test |
| Far trees shrink from above and vanish at hand-over | a2acc62b | Reading, and a test |
| A resting reflection stays empty after a scale change | b9802d49 | A test. Its cause came in with 4218ed56 here |
| A raised reflection count lags on a moving camera | 1d016784 | A live test on three paths. The option is new, and the Island alone takes it |

### What stays failing on the milestone and here

- `bench:allocation`, from `generateMipmaps`.
- S1's GPU time against main, from the bounce light. `bench:run --compare` exits failing without a `Bench-Expected:` line.
- `skinning-shadows` on WebGL2 and its no-prepass form fail on the clean milestone. Here the page turns bounce off.

### Checks owed before it lands

Run them on one final commit on a quiet Mac, in this order:

1. `bun run check`, `bun run limits`, `bun run typecheck`, `bun run test`, `bun tests/unit.ts`.
2. `cargo test --workspace`.
3. `bun run test:images` on the real GPU, the whole manifest, with `memory-limit`, `island-water`, `level-colors`, `culled-drop` and `reflection-lag`.
4. `CI=1 bun run test:images`, the whole software set. Push, and take the owed software references from CI: at least the island, impostor, Creek and water pictures, and `ssr-quarter`.
5. `bun run bench:gpu-check`. Put its `GPU-Checked:` line on a commit: it must cover the shader changes since 4218ed56, which are b7e34e7c's bounce shader. e0a69a9f's water shader and 3c9b2578 need it too.
6. A `Bench-Expected:` line naming the bounce light as the cause: S1 +37.4% and the S4 pages on WebGPU, and S4's WebGL2 GPU time. The maintainer notes say the same.
7. `bun bench/run.ts --compare <milestone tip>,. --scenes s1,s4,s6`, for this branch's own cost.
8. `bun run bench:allocation`. Expect only the milestone's `generateMipmaps` failure.
9. The Island's whole route at High on WebGPU and at Medium on WebGL2, twice each.
10. `tools/hooks/check-trailers.ts`, `check-merges.ts` and `check-copies.ts` over the final range.
11. Firefox and Safari: load and look. Phones: the cloud stand-in if none is attached.

## Consequences

- `tools/hooks/task-ids.txt` lists M4-S1 to M4-S9, so commits can name them.
- A task's fix removes its row from this record, so that what stays is what is open.
