# Examples

The demos in `examples/` serve two readers. A developer who clones this repository runs them against the packages of the clone. The null3D website shows them on its demo pages, built against the packages from npm. This guide says how one folder serves both, and which files a demo may load. It also records what the owner decided about the examples on 8 October 2026.

## Layout

| Path | Contents |
| --- | --- |
| `examples/demos.ts` | The list of demos and their groups, in `DEMO_GROUPS` order. Each entry names its group and its sketch, with a literal `new URL('./<name>/sketch.ts', import.meta.url)`, and says why the demo loads files, when it does |
| `examples/lib/run.ts` | `startDemo`, which starts a demo on a canvas that the page gives it, shows its labels in a layer that the page gives it, and shows the stats overlay |
| `examples/lib/source.ts` | `sourceUrl`, the GitHub address of a demo's code, for a "View code" link ([below](#the-link-to-a-demos-code)) |
| `examples/index.html`, `examples/index.ts` | The examples page of a clone: a sidebar of the demos by group, and a panel that runs the demo that `?demo=<name>` names ([below](#the-examples-page-of-a-clone)) |
| `examples/<name>/sketch.ts` | One demo, under 150 lines. The sketch shows the feature |
| `examples/<name>/<scenery>.ts` | A demo's scenery, when the look bar needs more code than the sketch's 150 lines leave. The sketch imports it from the same folder, such as the particles demo's `glade.ts` ([D-142](decisions/D-142-more-techniques-before-1-0.md#the-days-other-rulings)). The sketch keeps the feature's own calls, and the sibling holds the scenery they are placed on. The decals demo's sketch places its road paint and puddles, and `marks.ts` wears its house fronts |
| `examples/lib/decal-textures.ts` | The decal images made in code that the decals demo and the image test's decals sketch both draw. Both read the one copy, so a change of a pattern shows in each. A change of the demo's look then does not read as an engine fault |
| `examples/showcase/<name>/` | One showcase scene: its `sketch.ts` and the modules that it imports, with no line limit ([Showcase scenes](#showcase-scenes)) |
| `examples/lib/stage.ts`, `examples/lib/procedural.ts` | The showcase scenes' moods, and their generators of detail: seeded noise, texture sets from numbers, terrain and rocks |
| `examples/lib/interact.ts` | `interact`, which gives a demo's camera orbit controls and lets the pointer steer the demo ([Always-on interaction](#always-on-interaction)) |
| `examples/lib/pines.ts` | Pines made in code at four levels of detail, and the hills they stand on, which the page that measures the levels' saving uses |
| `examples/forest/woods.ts` | The forest demo's scenery: three firs and a broadleaf tree made in code at four levels of detail, the bushes of its understory, the land and its ridges, the bark, needle and leaf textures, and the cut-out cards that draw the far trees on phones |
| `examples/impostors/forest.ts` | The impostors demo's scenery: the shared pines split into three bands by distance, the octahedral atlas drawn in code from the pine's own tiers, and the transform that places each copy in a merged far mesh |
| `examples/lib/` | Code that several demos share, such as `sampleUrl` |
| `examples/vite.build.config.ts` | The production build of the page against this checkout's packages |
| `examples/compare/comparisons.ts` | The list of comparisons with three.js ([below](#comparisons-with-threejs)) |
| `examples/compare/<name>/` | One comparison: `scene.ts`, the description that both engines draw, `sketch.ts`, the null3D half, and `three.ts`, the three.js half |
| `examples/lib/compare.ts`, `ramp.ts` | `startComparison`, `rampComparison` and the ramp's logic, which any page lays out its own way |
| `examples/lib/walkthrough.ts` | The guided walkthrough's state machine and its summary, with no engine imports, and the session's copy of each ramp ([The guided walkthrough](#the-guided-walkthrough)) |
| `examples/lib/compare-scene.ts` | What the comparison scenes share, with no engine imports: the fixed-step clock, meshes, textures made in code and the grading table |
| `examples/lib/three-worker.ts`, `stats-three.ts` | The three.js half's worker, and its stats meter in the engine's panel |
| `examples/compare-page.ts` | The comparison panel of the clone's examples page |

The image tests, the device plans and the page tests read `examples/demos.ts`, and find each demo's sketch with `sketchPath` from it ([Image tests](image-tests.md)). A folder under `examples/` or `examples/showcase/` that holds a `sketch.ts` must be a demo in the list.

## Two builds from one folder

The examples page links only by relative addresses, and each demo's entry names its sketch with a literal address. The null3D Vite plugin ships a sketch when it finds `new URL('./x.ts', import.meta.url)` in a module, so a production build of the page holds every sketch, under any address prefix. A sketch address that code builds at run time, such as one from `location.origin`, does not ship.

### From a clone

- `bun run dev` serves the page at `/examples/` with the other test and benchmark pages.
- `bun run examples:build` builds the page and every demo into `target/examples/`, against this checkout's packages, with the engine's address switches on. `bun run examples:preview` serves that build with the isolation headers and the sample files. Run `bun run build` first, for the WebAssembly files.
- The demos that load files need `bun run samples:fetch` once on a new machine ([Sample content](sample-content.md)).

### On the website

The website's repository holds this repository as a git submodule, pinned to the release tag that matches the `@null3d/engine` version it installs. Its build:

1. Installs `@null3d/engine`, `@null3d/controls` and `@null3d/vite-plugin` from npm, and `three` at the version that `examples/package.json` pins, for the comparisons. It never lists the submodule as a workspace, whose `workspace:*` versions would break.
2. Shows the demos in its own layout. Its pages import `examples/demos.ts`, the list of demos with their groups, titles, scenes, summaries, controls and sketches, and `startDemo` from `examples/lib/run.ts`. A page shows each demo's `scene` after its title, as in "Instancing · 100,000 columns". It marks a demo with an `assets` field as one that loads files. It links each demo to its code with `sourceUrl` from `examples/lib/source.ts`, at the release tag that it builds from. It shows the comparisons from `examples/compare/comparisons.ts` with `startComparison` from `examples/lib/compare.ts`. The website owns the canvas, the text and the styles; the examples page of this repository is not part of it. Code that every layout needs, such as how a demo starts, its labels and its stats overlay, belongs in `examples/lib/`, not in `examples/index.ts`.
3. Builds its pages with `null3d()` from the plugin, `base: './'`, and `resolve.dedupe` for `@null3d/engine` and `@null3d/controls`. The dedupe matters when the submodule has its own `node_modules`: its workspace links point at packages whose built files are missing. Each entry of the list names its sketch with a literal address, so the build ships every sketch that the website imports.
4. Sets the environment variable `VITE_NULL3D_SAMPLES_BASE` to the folder of the sample files, such as `./samples/`, and copies them there with `copyNamedSamples` from `tools/lib/samples.ts`, which copies every file that the demos name.
5. Sends the isolation headers, for example with a Cloudflare Pages `_headers` file, as [hosting](../docs/getting-started/hosting.md) says.

Until the first npm release, the website builds the engine from the submodule instead: `bun install` and `bun run build` in the submodule, then the same config with the repository's `sourceResolve`.

`bun run test:packages` checks this path in CI. After its fresh project passes, it copies `examples/` into the project, where a submodule would sit. Beside it, it writes a page of its own layout that imports only the list and `startDemo`, and builds that page against the packed tarballs, with `VITE_NULL3D_SAMPLES_BASE` set. Then the instances and security camera demos must start from the build, and so must Factory in each engine. Those make their content in code, so the check needs no sample files.

## The examples page of a clone

The examples page is the clone's own layout of the demos. The website has a layout of its own and does not use this page.

- In a wide window, a sidebar at the left lists the demos by group. The groups come in the order of `DEMO_GROUPS` in `examples/demos.ts`, and a group with no demos does not show. Each link gives the demo's title and its scene, and a small "loads files" tag marks a demo with an `assets` field. The panel at the right runs the demo that `?demo=<name>` names. Its canvas fills the panel. A caption at the top left gives the demo's title and scene, its summary and how to steer it.
- In a window narrower than 768 CSS pixels, the sidebar is a drawer. A menu button in a bar at the top opens it. The drawer slides in below the bar, so the same button closes it. Escape, a tap beside the drawer and a pick close it too. The caption starts folded to its title there, to leave the canvas clear.
- Without `?demo=`, the panel shows a short welcome and starts no engine. A page that ran a demo at once would start an engine on every visit, before the reader picks one.
- A small link in the caption opens the demo's held frame (`?hold=<time>`). The held page links back to the live demo. Beside it, "View code" opens the demo's code on the main branch in a new tab.
- The sidebar is a `nav` landmark, and the running demo's link has `aria-current="page"`. The menu button reports the drawer's state with `aria-expanded`. Opening the drawer moves the focus to the running demo's link and makes the panel inert. Closing it with Escape or a tap beside it returns the focus to the button.

### The link to a demo's code

`sourceUrl(demo, ref)` gives the GitHub address of a demo's code at a branch or a tag, and `ref` is `main` when a page names none. The clone's page names none. The website names the release tag that it builds from, so its link shows the code that it runs.

- A demo of one file links to that file: `blob/<ref>/examples/<name>/sketch.ts`. Most feature demos are one sketch, so the reader lands on the code at once.
- A demo of several files links to its folder: `tree/<ref>/examples/<path>/`. One file would show only part of the demo, and the folder lists every part. Such a demo sets its `code` field to its folder, with a slash at the end, such as `showcase/city/`. A feature demo with its scenery in a file of its own does the same, such as `shader-inputs/`. A demo of one file outside `<name>/sketch.ts` sets `code` to that file.

The address comes from the demo's entry, not from its `sketch` field. A build gives each sketch a hashed address of its own. `REPOSITORY_URL` in the same module holds the repository's address. A unit test checks it against the `repository` field of the root `package.json`.

### Each pick is a new page

Each link loads `?demo=<name>` as a new page. The page does not swap engines in place. A new page drops the last engine with its workers and its shared memory. Safari reserves address space for the whole maximum of each engine's shared memory, and an iPad page holds about 6 engines ([D-04](decisions/D-04-memory-maximum.md)). Safari also frees a dropped memory late ([D-98](decisions/D-98-memory-pool.md)). So a page that started a new engine for each pick could fail after a few picks on an iPad. A new page also clears whatever a demo left on the page, such as its labels and its listeners.

### Engine settings of the demos

`startDemo` names no quality preset, and leaves the frame-budget governor on, as every preset has it. The engine then picks the preset for each device. It starts from the device's kind: High on a desktop, Medium on a tablet and Low on a phone. It caps that at Medium on WebGL2 and in WebGPU's compatibility mode. Then its start-up check lowers the preset until one holds the frame rate, and keeps the result for the next visit.

A page that names a preset skips that check. A phone would then start at High, and stutter and heat until the governor stepped down. The check already gives High on desktops with a strong GPU, where the richer look matters. The `?preset=` switch still fixes a preset, to try another one.

`startDemo` shows the engine's stats overlay through the engine's `stats` option, so the examples page and the website both show it. It sits over the canvas's top-right corner, as it always does, collapsed to its frame rate. The caption sits at the top left, so the two stay apart. The caption folds from its summary: a chevron floats at the summary's top right, in place of the native marker, points down while folded and up while open, and the right padding keeps the two-line title clear of it. The examples page keeps the caption's width clear of the collapsed overlay, and hides the overlay while the phone's drawer is open. A page passes `stats: false` to leave it off. A visitor adds `?stats=off` to the address to hide it, or `?stats=open` to open the card. A click on the frame rate opens the card: each thread's CPU time and the GPU time against the target, memory, and the counts. Collapsed, the overlay costs nothing more than a page without it. While the card is open, the engine times one frame in eleven on the GPU. It also reads back the counts of the objects that the GPU culls. That costs a little GPU time and a few small objects on those frames ([D-116](decisions/D-116-stats-overlay-figures.md)). A held frame never shows the overlay, so the held frames match the image tests.

In hold mode the engine runs no check, and the preset follows the device's kind. The image tests do not use `startDemo`. The manifest draws each demo's sketch through the test pages, so the examples page does not change their images.

## Procedural first

A demo makes its meshes, textures, environments and grading tables in code. It loads files only when loading them is what it shows, or when a comparison shows both engines handling the same files. The demo's entry gives the reason in its `assets` field. `tests/lib/images.test.ts` fails when a sketch loads a file and its entry gives no reason. It also fails when an entry gives a reason and the sketch loads nothing. A sketch loads a file when it calls `sampleUrl`, an `assets.load` function or `assets.preload`.

The reasons are:

- Content made in code shows what the engine draws, at any scale, with no download. It keeps each demo self-contained, and the website ships no large files for it.
- Loading still needs demos of its own: developers load glTF models, HDR environments, KTX2 textures and grading tables, and a comparison with three.js must show both engines loading the same files.

The post effects demo makes its warm and cool grading tables from lift, gamma and gain in code, with `assets.lutFromData`. It loaded two `.cube` files before 9 October 2026. The example of tables loaded from files belongs in the planned demo of asset loading.

Demos load sample files through `sampleUrl('<path>')` from `examples/lib/samples.ts`, with a string literal, so the sample check and `copyNamedSamples` find each file.

## Always-on interaction

Every demo runs by itself, and takes the user's input at any moment. There is no switch between a tour and free control. `interact(ctx, camera, options)` from `examples/lib/interact.ts` holds the shared code. It gives the demo's camera orbit controls, and it gives a demo with something to lead a point that the pointer steers. Each demo's `controls` text in `examples/demos.ts` says how to interact with it.

The rules:

- Every demo's camera has the orbit controls of `@null3d/controls`. The demo's own camera motion runs until the user's first camera gesture. That is a drag with any button or with one finger, the wheel, a trackpad pinch, or two fingers. A drag counts once it moves past the engine's click limit: 2 CSS pixels for a mouse, 10 for a finger. From then on, the user owns the camera for the rest of the visit, and the scene goes on moving.
- The hand-over does not jump. Until the hand-over, the controls' target follows the point that the scripted camera looks at. At the hand-over frame, the controls read the camera where the script left it, and orbit that point. The scripted camera must stay inside the controls' polar and distance limits, or the first update moves it onto them. The security camera demo's camera once stood 10 cm below its target, under a limit that keeps it above. The old controls lifted it as they started, so its held frame showed the lifted pose. The demo now places the camera there itself.
- A demo with something to lead names a plane: `groundY` for a level plane, or `planeZ` for an upright plane that faces the camera. The `bounds` option keeps the point in a box. The `surfaces` option points at the scene's surfaces through a raycast first. A mouse steers by hovering with no button held, since a drag turns the camera. A finger steers by a tap, since a one-finger drag turns the camera. A click steers too.
- `steer(value)` moves the demo's scripted value toward the point, by a weight that eases from 0 to 1. The engine has no signal for a pointer that leaves the canvas. So after 3 seconds with no pointer movement, the weight eases back to 0, and the object goes back to its scripted path.
- Hold mode draws the same frame. No input reaches a held frame, and the helper then moves nothing. The controls turn the camera toward their target as they start, so the helper puts the camera back where the sketch had it. The controls' update runs only after the hand-over, or while they turn the camera by themselves. A weight of 0 gives the scripted value bit for bit. `examples/lib/interact.test.ts` checks these points, and the demos' image tests check the held frames.
- The user can look at a demo from any side. So a flat or open surface that the camera can get behind or below draws both faces, with `doubleSided: true`. These are the flat generator shapes and the island of the mesh arrays demo. They are also the grounds of the character, security camera, objects, render layers, hold mode, input and far-from-origin demos. A pan can take the camera under a ground even when the orbit limits keep it above the target.
- No two faces that point the same way share a plane, or they flicker as the view moves. A wall stands on its floor, not beside its edge, and a back wall fits between its side walls. The render layers demo's walls and the post effects demo's side wall had such faces, and the owner saw them shimmer on 8 October 2026.
- A demo imports the engine, `@null3d/controls`, the add-on that it shows (`@null3d/particles`, `@null3d/terrain` and the like), the shared helpers in `../lib` (`interact`, `samples`, `procedural`, `pines`, `progress`) and files in its own folder, and nothing else. A helper belongs in `../lib` when more than one demo uses it. Scripted motion reads `time.now`, as [Image tests](image-tests.md#the-feature-demos) asks. A camera that follows a moving object moves in `onLateUpdate`.

What the pointer steers in each demo:

| Demo | The pointer steers |
| --- | --- |
| math | The lamp that the flock circles, on the plane at the lamp's mean height, over the pad |
| character | The Knight, which walks to the pointed point. Its speed, and so its blend of clips, comes from the distance left |
| sprites-lines | The fountain. Each spark keeps the place it was born at, so the fountain does not slide |
| instances | The center of the wave |
| mesh-arrays | The crystal, which hovers over the point of the hills that a raycast finds |
| post-effects | The pink lamp, so the bloom and the shading move |
| hold-mode | A paddle that shows only while the pointer steers it, and kicks the balls on it up |
| security-camera | The security camera, which aims at the pointed point of the yard |
| generators | The shapes, which turn toward the point on a plane in front of them |
| extra-shapes | The shapes, as in the generators demo |
| vertex-updates | The glowing float, which leaves its rings where it goes |
| time-of-day | The hour: the pointer's place across an upright plane through the lighthouse, from 4:00 at the left to 20:00 at the right |
| camera-lens | The focus, on the point of a piece or the board that a raycast finds |
| morph-flowers | The tulips near the pointed point, which open |
| input | Nothing: the keys, a gamepad and the camera gestures drive it. The right stick turns the camera before and after the hand-over |
| walk-and-fly | Nothing: the keys, the drag and the locked mouse drive first-person and fly controls |
| shader-inputs | Nothing: the camera only. A hover or a tap on a stone lights it, through the stone's `shaderId` in a uniform |
| The others | Nothing: the camera only. Picking keeps its hover and its click, and the engine gives no click after a drag of more than 2 CSS pixels |

Three demos need more than the shared rules:

- In far-from-origin, orbit controls work in the camera's parent space, and assume a parent that does not turn, as `lookAt` does. The camera used to ride a turning rig. Now the script turns the camera itself, with the same position and the same turn that the rig gave it. The controls' target is the point on the tray where the camera's view meets it.
- In walk-and-fly, first-person and fly controls take the place of orbit controls, since the demo shows them. Until the first key, button, drag or touch, a scripted walk moves the camera. At the hand-over, the first-person controls take the direction that the walk looked in, so the view does not jump. Its entry sets `pointerLock`, so `startDemo` asks the browser for the pointer lock on a click. A page can ask for it only right after the user acts, and a sketch cannot ask at all. Fly controls steer by the pointer's place, which the lock holds still. So while the pointer is locked in fly mode, the sketch turns the camera by the mouse's movement.
- In large-world, the user's camera orbits a point 12 m ahead of the car. The point is on the car's line of sight, so the hand-over keeps the view. That point drives on, and the helper's `shift` moves the camera with it. The target is a plain array, which keeps 64-bit precision 6,378 km from the origin.

Why it works this way:

- The owner asked on 8 October 2026 for demos that run by themselves and answer the user at once, with no switch. A switch hides the controls from a visitor who never finds it. A tour that the user cannot stop feels broken.
- The hand-over at the first gesture serves both visitors. A visitor who only watches sees the tour. A visitor who reaches for the camera gets it at once. The tour does not come back, since a camera that moves while the user looks at something is worse than one that stays.
- The controls start with the demo, not at the first gesture. Controls ignore a button that is already down when they start, so controls made at the first press would ignore the whole first drag.
- Hover steers, not a drag, because a drag already turns the camera. On a touch screen, a tap is the only gesture that a drag does not take.
- The weight eases back after an idle time because the sketch cannot see a pointer leave the canvas. Without it, the last pointed point would hold the object for the rest of the visit.

## The look of the feature demos

On 8 October 2026 the owner asked for feature demos that look much better, while each stays one short sketch that is easy to copy. The engine makes each part of the look cost a line or so. The parts are the generated sky with clouds and a low sun, cascade shadows and the built-in room environment. Height fog with sun glow, ambient occlusion, bloom from bright emissive surfaces, the tone curve and a vignette complete it. A small texture from `textures.fromData` adds detail where it helps. The math, instances and generators demos changed first, so the owner could review the look before the other demos follow (M2-EX9).

| Demo | What it shows now |
| --- | --- |
| math | A flock of 300 drones circles a lamp over a landing pad at dusk. Each drone has a body, two arms, four spinning rotors, a cyan tail light that blooms and a small point light of its own. The lamp is a point light that casts the crates' shadows. The floor's texture is concrete grain with painted lines |
| instances | 100,489 columns (317 on each side) in one batch at golden hour, and 10,201 on the Low preset of phones, with 30,000 to 100,000 hover cars streaming along the sky lanes above them, from the traffic-lanes add-on. The sky lights the columns through `assets.skyEnvironment()`. A lamp, which blooms, hovers over the center of the wave and lights the columns around it |
| generators | The nine shapes in polished, gold and brushed metal, plastic, a tile texture that shows each shape's texture coordinates, and a ring that blooms, over a tiled terrace at golden hour |

The rules that the reworked demos follow, and why:

- They use only what the engine draws today. Instance batches cast and receive no shadows yet, and their row colors do not draw yet. So the instances demo gets its depth from the low sun, the sky's light, the lamp, ambient occlusion and fog.
- They leave the count of shadow cascades to the preset: 2 on Low, 3 on Medium and High, and 4 on Ultra. They set only the shadow distance. A light that names 4 cascades draws 4 on a phone too.
- Point lights cast shadows only on the presets with `pointLightShadows`, High and Ultra. WebGL2 and WebGPU's compatibility mode run at most Medium. There the math demo's lamp lights the pad, but casts no shadows.
- The math demo's lamp shadows did not show at first, because the ambient and environment light filled them in. A test frame lit by the lamp alone showed the crates' shadows. So the demo lowered the fill light, and made the lamp and the floor brighter.
- The owner reviewed the first math demo on 9 October 2026. Its flat drones piled up round the lamp each time the lamp's path turned. The demo then had each drone fly the lamp's path a moment late, and those late places crowd together on a turn. The second version gave each drone a fixed slot in a wide ring below the lamp, and turned the whole ring. The flock kept its spacing, but moved as one block. The owner then asked for drones that fly at varying speeds, so that the chase has a livelier motion as a whole. Now each drone follows the lamp's path at a lag of its own, up to 1.6 s. It circles that point on a ring of its own, 1.8 to 4.2 m out. Its orbit speed differs from its neighbors' and wobbles a little. So the flock stretches into a stream after each turn of the lamp: the drones with short lags cut in, and the long ones trail. The rings keep the drones apart, and the slots spread over them by the golden angle. Each drone is four instance batches' rows: a body, two crossed arms, four rotors and a tail light.
- The lamp stays in view. No drone comes within 1.6 m of the lamp: one that would is pushed out to that distance. The rings fly lower than the lamp, so the default camera looks over the flock at it. On the lamp's near side, a drone comes no closer than 1.3 m to the line from the lamp to the camera. One whose slot falls there steps sideways out of it. The camera's place is an input, so this holds while the user orbits, and a held frame stays exact.
- Each drone carries a point light of 2 m range. The engine lists at most 128 lights in a cluster. With a range of 3.5 m, the clusters under the flock held more than that. They dropped lights, and the pad showed square patches of light. A flock that flies low and lights of 2 m keep each cluster to an estimated 30 to 70 lights. The held frames show no patches. With the 300 lights, the Mac still drew at 120 fps on both GPU paths.
- The fog does not cover the sky. A ground 40 m across ended well below the horizon, and a band of the sky's dark lower part showed between them. Each ground now reaches 5 km from the camera, as does the camera's far plane. So the ground ends a pixel or two under the horizon. Each fog color matches the sky just above the horizon in the held frame, so the far ground fades into the sky. The colors came from samples of the held frames: the generators' sky there was pinkish gray, and the math demo's sky almost black.
- Motion comes from `time.now` ([Image tests](image-tests.md#the-feature-demos)). The first math demo moved each drone a share of the way to its goal in each frame, which adds up the frame steps. Now each drone's scripted place is a function of the time. It is the lamp's path at the drone's lag, plus its slot on its ring. Its places 100 ms before and after give its heading, its forward lean with its own speed and its bank into the turn.
- While the pointer steers, each drone eases toward the pointed point at a rate of its own. The rate falls from 6 to 1.2 a second as its lag grows. So a sudden move of the lamp sends a ripple through the flock. Each drone keeps its steering weight and its point in arrays, the only state of the demo. With no input both stay exactly 0, so the scripted path and the held frames do not change.
- The instances demo writes each row's place across the field once, in the setup, since only the heights change. In each frame it works out the part of the height that depends only on the column once per column, not once per row.
- The owner found the first instances demo too dark. It now takes golden hour from `timeOfDay`, and the sky's own light from `assets.skyEnvironment()`, with the helper's ambient light and a third more exposure. Its columns are less metallic, so the sky and the sun light them. The helper's fog color is the horizon toward the sun. Across the view, the sky's rim is a dim rose, so the demo's fog takes an amber between the two. The clouds stay still. The engine makes the sky's light again after each change of the sky, one step a frame. So drifting clouds would cost a step in every frame.
- The instances demo takes its count of columns from a table by preset. `quality.onChange` sets the batch's active count again when the preset changes. The setup places the rows ring by ring from the middle out. So the first rows of any count fill a square in the middle of the field. Low draws 10,201 rows, the old demo's count, and the other presets draw all 100,489. The Mac held the full field at 120 fps on both GPU paths. The cloud iPad Pro 13 in Safari and the Galaxy S25 in Chrome drew its held frame on all three paths. Neither run timed the frame rate.
- The demos' interaction test (`tests/image/demo-interaction.spec.ts`) opens the math and instances demos on the Low preset. It checks the camera and the steering, not the look. On SwiftShader on the Mac, the full look took the instances test from 11.4 s to 25 to 30 s. The math test took 17 s. In CI, main's instances test already took 44.6 s of its 60 s, about four times its time on the Mac. On Low, the two tests took 7 to 10 s and 12 s on the Mac. With a quarter of the field on Low, the instances test took 14 s. That is too close to the limit in CI.
- The three demos make the room environment, which takes time on a software GPU. On SwiftShader on the Mac their held frames took 6 to 15 s, four tests at once. So their image tests take 60 s, as the other demos with the room environment do, since CI's machines are slower.
- The instances demo's lanes moved to the traffic-lanes add-on on 22 October 2026 (M3-B6). The demo draws 30,000 cars at Low and 100,000 at Ultra, where it drew 720 on the CPU. The add-on moves them in the vertex shader. It gives each heading's batch a lane-length bound,
  so a frame's work does not follow the count. The lanes surround the field at 16 to 34 m over
  2,600 m, so the cars stay a layer above the horizon. The fog hides most of them. Against the
  old pictures the drawn ones differ in 2.6% of their pixels, and the references moved in both
  sets. On 22 October 2026, at a Mac load of 28, the demo held these rates, from Low to Ultra:

  | Path | Frame rate | GPU time |
  | --- | --- | --- |
  | WebGPU | 120, 119, 119, 119 fps | 3.7, 4.5, 4.6, 5.1 ms |
  | WebGL2 | 120, 119, 119, 120 fps | 4.5, 5.2, 5.0, 5.0 ms |

  The traffic added at most 0.6 ms to the GPU time and no error to the scene's updates.
- The real lights went to a fixed share of the rows, one row in 7 at 30,000 cars and one in 24 at
  100,000, so the nearest car often had no light (25 October 2026, M3-B6). The search now reads every
  row of the lanes near the camera. It skips a lane whose line across the way runs farther from the
  eye than the light's range, before it reads a row, so its cost follows those lanes and not the
  count. `examples/addons/traffic-lanes/lights.test.ts` compares it with a full search at 30,000 and
  100,000 rows and checks that the nearest car has a light.
- The instances demo gained lanes of hover cars on 18 October 2026 (M2-EX43, [D-172](decisions/D-172-neon-harbour-follow-ups.md)). Four lanes cross the sky at 17 to 22 m, on lines 45 to 75 m from the field's center, so the traffic stays a distant layer above the horizon and no car passes near the lens. Each car is a row of a body batch and a tail light batch, which blooms. The sketch writes every row from the time alone, so a held frame draws the same cars. The lanes moved to `traffic.ts` beside the sketch, which stays under 150 lines. Against the old pictures the drawn ones differ in 1.44% to 1.49% of their pixels, against the limit of 0.1%. The references moved in both sets.

### Frame rates on the Mac

The figures come from Chrome 155 on a Mac with an Apple M5 Max, on 9 October 2026. Each demo ran at the preset that the engine chose, with the governor on. The math figures are from its third version, and the instances figures from its second, each measured after the owner's review. The display runs at 120 Hz. Each figure is the stats overlay's reading, 15 seconds after the start, over 5 seconds.

| Demo | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| math | 120 fps, GPU 5.1 to 5.6 ms, sketch 0.4 to 0.5 ms, 300 drone lights | 120 fps, GPU 5.6 to 6.6 ms, sketch 0.5 to 0.6 ms |
| instances | 119 to 120 fps, GPU 3.7 to 5.1 ms | 119 to 120 fps, GPU 4.5 to 5.2 ms |
| generators | 120 fps, GPU 3.9 to 4.7 ms | 120 fps, GPU 4.1 to 5.2 ms |

Before the change, all three held 120 fps on both paths too. The instances demo had 10,000 rows then. On a phone, a loop over all 100,489 rows should take about four times as long as on the Mac. The phone and tablet checks of the three demos are still to run.

## The look of six more feature demos

On 9 October 2026 six more feature demos got the richer look, after the math, instances and generators demos (M2-EX9). The owner wants every demo to look as good as the reworked generators demo. Each demo is still one sketch of under 150 lines. It shows the same feature, and takes the same input. Each `scene` field names the new scene, as [Groups and titles](#groups-and-titles-owner-9-october-2026) says.

| Demo and scene | What it shows now |
| --- | --- |
| mesh-arrays: Crystal island | An island under an afternoon sky. Each vertex has a color from its height and its slope: sand at the shore, then grass, and rock. A reflection pass mirrors the island and the sky in rippled water. The crystal glows violet and casts a shadow |
| objects: Turntable stage | A studio stage: a dark turntable with a ring of light that blooms. Six crates share one panel texture in six materials: wood, brushed steel, copper, gold, red paint and blue lacquer. A warm spot light casts their shadows, and a cool light shines from behind |
| layers: Cottage street | Five brick cottages with pitched tile roofs in the low sun of late afternoon, with trees, a cobbled street and lamps that bloom. The roofs and the pins are still on layers of their own |
| hold-mode: Bouncing balls | 400 balls in five finishes: chrome, gold, and glossy red, blue and pearl. Each ball casts a shadow. The pen has stone walls and corner posts, on a paved yard |
| input: Walking robot | A small robot of generator shapes replaces the box. Its legs and arms hang from joints that swing as it walks. It turns toward where it walks, and raises its arms in a jump |
| far-from-origin: Keys and brass wheel | A walnut desk, a dark metal tray, pale and dark keys, a brass wheel on a steel axle, and a green light that blooms. A label over the wheel gives the camera's distance from the origin to the millimeter |

The rules that these demos follow, and why:

- The outdoor demos light their scenes with `timeOfDay` and `assets.skyEnvironment()`. The sky, the sun, the fog and the reflections then come from one sky model, so they match. The objects and far-from-origin demos are indoor scenes. They take their reflections from the built-in room, and a dark background with fog hides the edge of the floor.
- A demo that uses `timeOfDay` sets an exposure: the time of day's, or its own. At the default exposure a night scene is 3.5 times too dark. The area lights demo's first street shots were mostly black for that reason. A unit test in `tests/lib/images.test.ts` checks every demo. Creek is exempt. The owner approved its look, which is tuned at the default exposure, and a new exposure would change it.
- A rectangle light that shows a picture gives out its intensity times the picture's average color. The area lights demo's neon sign is one such light, with thin tubes on black. By itself it lit almost nothing around it. So its picture and its board have a faint pink glow, a tenth of the tubes' brightness.
- The objects demo's fog uses the `exp2` curve. Exponential fog that hid the edge of the stage 100 m away also dimmed the crates 9 m away by a third. With `exp2`, the crates take 7% of the fog's color and the edge almost all of it.
- The mesh arrays demo has a reflection pass, so its light comes from the sun and the sky only. Until 11 October 2026 passes drew no point or spot lights ([D-104](decisions/D-104-scene-passes.md#point-and-spot-lights-in-scene-passes-8-october-2026)). So the crystal's glow comes from bloom, not from a lamp.
- The island's colors are its texture made in code: each vertex takes its color from the height and the slope there, with some noise. A tiled noise texture as well took the sketch over 150 lines, and showed little from the demo's camera.
- The hold mode demo draws 400 meshes, not one instance batch, because batches cast no shadows yet. Its physics moved into `onFixedUpdate`, at 120 steps a second. At the default 60, a 120 Hz display would show the balls stand still in every other frame. Hold mode runs the same steps on every run, so the held frame stays the same.
- The objects demo turned the table and the crates by adding up the frame steps. Now each turn comes from the sketch time. A crate on the stage spins at its own speed plus the table's, so its spin goes on with no jump when it steps off.
- The input robot's walk comes from the distance it walks, which the input sets. Its sway while it stands comes from the sketch time. Its camera still moves in `onLateUpdate`.
- Each ground draws both faces and sits 1 cm under the objects that stand on it. So no face that points down shares a plane with the ground's lower face.
- The far-from-origin label changes 4 times a second, so the sketch makes a few strings a second, not one in every frame. The sketch adds the camera's place under the site to the site's place in JavaScript's 64-bit numbers.
- All six demos make an environment, which takes time on a software GPU. On SwiftShader on the Mac their held frames took 8 to 17 s each, four tests at once. They took up to 38 s while other runs loaded the Mac. So their image tests take 60 s, as the demos that make the room do.

### Frame rates of the six demos on the Mac

The figures come from Chrome on a Mac with an Apple M5 Max, on 9 October 2026, with a display at 120 Hz. Each demo ran at the preset that the engine chose, with the governor on. Each figure is the stats overlay's reading, 15 seconds after the start, over 5 seconds.

| Demo | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| mesh arrays | 120 fps, GPU 4.0 to 5.5 ms | 120 fps, GPU 2.9 to 5.8 ms |
| objects | 120 fps, GPU 5.3 to 5.5 ms | 120 fps, GPU 3.8 to 4.8 ms |
| render layers | 120 fps, GPU 4.1 to 5.3 ms | 120 fps, GPU 5.3 to 5.9 ms |
| hold mode | 119 to 120 fps, GPU 4.0 to 4.9 ms, 560,000 triangles | 120 fps, GPU 4.0 to 5.6 ms |
| input | 120 fps, GPU 2.7 to 5.0 ms | 120 fps, GPU 4.8 to 6.7 ms |
| far from the origin | 120 fps, GPU 4.5 to 5.3 ms | 120 fps, GPU 4.5 to 6.3 ms |

The six demos held 120 fps on both paths before the change too. No phone or tablet has run the new look yet. The hold mode demo's 400 shadowed balls are the likeliest cost on a phone.

## Comparisons with three.js

A comparison draws one scene in null3D and in three.js, one engine at a time. It finds the largest count at which each engine's scene updates at 20 fps or more on the viewer's device. Factory was the first, and Battle the second ([D-121](decisions/D-121-comparison-tier.md)). Night town follows.

### The parts

- `scene.ts` holds everything that both engines draw: the seed, the layout, the fixed-step simulation, the meshes as arrays, the surfaces, the lights and the camera path. It also holds the ramp of each device class and the held frame. It imports no engine, so both halves run the same code.
- `sketch.ts` is the null3D half. It reads its settings from its own address: `capacity`, the most cells of the run, `count`, the cells that move, and `effects`. The page's `count` message changes the count during play.
- `three.ts` is the three.js half. It builds the scene with three.js 0.186.1 and hands it to `runThreeWorker`, which runs it in one worker with an OffscreenCanvas.
- `startComparison({ canvas, comparison, engine })` starts one engine on a canvas. It returns the run: `setCount`, `measure`, `collapseStats` and `destroy`. `rampComparison(run)` runs the ramp. The website lays out its own controls over these calls, as the clone's page does.
- The clone's page runs a comparison at `?compare=<name>&engine=null3d` or `&engine=threejs`, on the scene graph route: the usual tree of one object per part. The device tests' comparison page runs the same route. Its caption holds the comparison's title, a details button beside it, an engine switch, a count slider and "Run the ramp". The details button opens a sheet over the blurred canvas: the scene's summary, the route that the page measures, a table of how each engine draws each part of the scene, the rules that both engines share, and the comparison's longer notes. The address's `count` shows in the slider at once, before the engine loads. A loading overlay covers the canvas from the moment an engine starts until its first frame, which shows while three.js builds its scene and its programs. Each engine runs on a page of its own, so the switch and the ramp load the page again. The ramp keeps each engine's result in session storage, and shows "null3D held N, three.js held M" once both have run. A comparison's effect switches are address settings only; the panel does not show them.

### The guided walkthrough

A visitor to a comparison gets a guided walkthrough, and `?walkthrough=off` gives a developer the manual page at once. The walkthrough has four steps (`WalkthroughFlow` in `examples/lib/walkthrough.ts`):

1. **Intro.** The page draws nothing yet. A card shows the comparison's title and summary, what will happen, and a note that both engines draw the same scene. "Start the comparison" begins, and "Use the controls" leaves for the manual page.
2. **null3D's ramp.** The page starts null3D and runs the device class's ramp. The card's heading is the engine's name, over "Ramp 1 of 2", and its line gives the count alone: the rate changes as the ramp moves, and the card is not a result. It offers "Skip" and "Stop". The caption shows only the title and the details button while the walkthrough runs, since the card carries the controls.
3. **three.js's ramp.** Each engine draws on a page of its own, so the page keeps the result in session storage and loads again with three.js, on the same GPU path. Its ramp runs on the same counts, under "Ramp 2 of 2".
4. **Summary.** A table gives each count's frames a second for each engine and their ratio, and marks each figure at the display cap. It says which engine drew more frames a second where the display did not set the pace, and where each ramp stopped. The display's rate comes from the first page, before any engine draws.

A skip moves on as a finished ramp does; the summary marks the ramp as partial. A stop destroys the engine and clears the kept results, and the card then offers a new start or the manual controls. The walkthrough state machine and its summary have unit tests. The summary joins the ramps by count, so a count that only one engine measured has a figure for that engine alone.

### The scene graph route

Each comparison builds its scene one way, and both engines build it the same way ([D-121](decisions/D-121-comparison-tier.md#two-modes)): one object per part, in a tree of parents and children, as each engine's own examples build jointed models. The code writes each joint that moved, and each engine works out the world transforms of the trees and draws them its own way. This is how most apps build such a scene.

Each engine holds only the objects of the cells that show. null3D makes cells as the count rises and destroys them as it falls, 250 a frame, within its queue of scene changes. Its joints that turn in most frames are dynamic objects. The fingers and the crates are static ones, which the engine recomputes only in a frame that moves them. three.js turns off `matrixAutoUpdate` on every node and calls `updateMatrix` after a write, as its docs advise.

### The ramp

The ramp raises the count step by step. Each step sets the count, waits half a second for it to settle, and measures the scene's update rate for a second. A step holds the ramp's floor of 20 fps or more. The ramp stops after two steps in a row below the floor, at the plan's maximum, or at once when the scene's update fails. It reports the largest count held. Both engines measure their own updates: null3D with `engine.measure`, whose `updatedFps` counts frames whose scene update ran to its end, and three.js in its worker from its animation frames. The ramp runs with each engine's stats panel collapsed.

A three.js frame that draws nothing is not a frame. While WebGPURenderer cannot draw a scene, its render calls return at once with no draw, and its frames then come at the display's rate. On 12 October 2026, Night town's three.js WebGPU ramp "held" 1,020 lights at 120 frames a second with no town on the screen. So the worker counts only frames with draw calls (`DrawnFrames` in `examples/lib/three-worker.ts`). A measurement starts at the first such frame, after waiting at most its own length for it. With none, it reports no frame and a frame rate of 0. A ramp step with no frame is a count that draws nothing. When the next count draws, the ramp steps past it as a fault of the browser, as Chrome 155 drew no frame of Night town on WebGLRenderer at 60 lights and drew at 72 ([D-121](decisions/D-121-comparison-tier.md#browser-faults-met-while-timing)). Two such counts in a row, or one at the maximum, stop the ramp. The result keeps the largest count drawn, the counts stepped past, and three.js's link error where it gave one, and the page says both in plain words (`noFrameText` in `examples/lib/ramp.ts`, with unit tests). `three-worker.test.ts` checks that every frame and every measurement goes through this rule.

A live three.js run starts at its first frame that draws, as a null3D run starts at its first frame. three.js can still build shaders after `compileAsync`: on 12 October 2026, Night town's WebGPURenderer drew its first frame more than 6 s after it started. The warm-up and a 6 s measurement fell inside that wait, so every fixed count gave no frame. So the worker posts `drawn` at its first frame with draws, and `startComparison` resolves only then. A three.js run that never draws never starts, and the page's time limit ends it as a failure. `three-worker.test.ts` guards this wiring too.

Time comparisons in the Mac's installed Chrome, the browser that people run. On 12 October 2026, Playwright's Chromium 153 failed to build one of three.js's render-to-texture pipelines for Night town on WebGPU. Its shader compiler gave: "renderPipeline_RTT_57: An error occurred while generating Tint IR. error: swizzle view instruction still has usages after lowering". three.js then drew the town without that pass. The installed Chrome 155 built the same pipeline with no error. Chromium 153 also took about 90 s to the first frame of null3D's WebGL2 Night town at 300 lights or more, and 1 s at 120. Chrome 155 took 1 to 2 s at every count, with each effect alone and with all of them. So the timing scripts open the installed Chrome (`channel: 'chrome'`), and each record names the browser's version. Check a record's errors before using its figure.

The ramp once judged the display rate, which the page measured from its own animation frames. Chrome can slow those frames while null3D draws from its workers at the full rate. The ramp then read a rate the engine did not keep, and a frozen scene could still report a high figure. The owner ruled on 13 October 2026 that a ramp judges the scene's update rate instead ([D-158](decisions/D-158-growable-animation-table.md)). null3D measures completed updates: `updatedFps` counts frames whose scene update ran to its end, and `updateErrors` counts frames whose update threw. A frame whose update threw still presents, so a presented rate hides it. The owner set the floor at 20 fps, after rulings of 30 and 10 the same session. A step whose update failed stops the ramp at once with a scene error, whatever frame rate the engine presents.

The page's measurement takes the median interval of 40 of its frames, or of those that come within a second. On 13 October 2026, three.js drew Battle on CI's SwiftShader at one frame every 5 to 11 seconds. The page's own frames came 2.5 to 6 seconds apart meanwhile. The measurement waited for 40 of them, so the page gave no result within the test's 200 seconds. Now it ends after two such frames. CI's test of Battle's three.js ramp on WebGPU would fail again if it waited that long. With the shorter measurement, CI drew that test in 101 seconds. The test keeps a limit of 160 seconds for the page on the software GPU, so a slower CI machine does not fail it.

The ramp tests also draw their software-GPU runs with every effect off: the effects cost that GPU the most and change no scene update. On 17 October 2026 the same Factory scene drew in 14.6 seconds on one shard with them off. The ramp test ran past its four minutes with them on.

Factory's ramps top out at 50,000 moving parts on desktops, 30,000 on tablets and 20,000 on phones. Each row is a first guess until a device sitting measures it.

Night town's ramp counts lights, 12 to a block. It starts at 60, 48 and 36 lights and tops out at 1,020, 720 and 480 on desktops, tablets and phones. It stays under 1,024 lights, the most that both engines' clustered lighting lists at once. three.js's WebGLRenderer stops at the most lights that the GPU builds into one shader, and the page shows that limit ([D-121](decisions/D-121-comparison-tier.md#night-town-and-busy-page)).

### Fairness rules

These rules show on the page's "about this comparison" panel, from `FAIRNESS_RULES` in `examples/lib/compare.ts`:

- The same scene description in both engines: the same seed, layout, meshes, surfaces, lights, camera path and fixed-step simulation.
- The same pixel ratio, the device class's cap, with 4x MSAA, the same effects and the high-performance GPU.
- null3D's quality governor off, a fixed preset (High, which WebGL2 caps at Medium), and every pixel drawn. Ambient occlusion draws at half the render size each way in both engines.
- three.js on the renderer of the GPU path, WebGPURenderer on WebGPU and WebGLRenderer on WebGL2, in one worker with an OffscreenCanvas. It uses its add-ons and the methods of its official examples.
- One engine at a time: each runs on a page of its own.
- One memory definition: the browser's measurement of the whole page and its workers, with null3D's shared memory counted once.
- The ramp runs with the stats panel collapsed in both engines.
- Where a three.js add-on has a fault that changes the look, the worker fixes it without changing its math or its work. three.js 0.186.1's CSM add-on drops the standard material's highlights and reflections on WebGLRenderer, so `withCsmLightFix` puts three.js's own setup lines back ([D-121](decisions/D-121-comparison-tier.md#a-threejs-fault-csm-on-webglrenderer)). Every comparison makes CSM through it, and a unit test fails when an update of three.js fixes the add-on.

### The look

A comparison must look very beautiful, as every demo and showcase scene must ([D-132](decisions/D-132-showcase-look-and-features-2026-10-11.md), owner, 11 October 2026). It uses shaders, effects, particles and complex geometry. A good figure does not excuse a plain scene. The bar is the generators demo and Creek.

Each engine draws each effect with its own best technique for the same intent ([D-52](decisions/D-52-intent-parity.md)), and each effect is a switch. The owner reviews both engines' held frames before a comparison goes on the page. The image tests `compare-<name>-null3d` and `compare-<name>-threejs` hold both, each against references of its own.

Every comparison scene meets the same look bar as the feature demos and showcases (owner, 11 October 2026): good figures don't excuse a plain scene. The bar is the reworked Geometry Generators demo and the Creek showcase. They have varied materials, small textures made in code and reflections of an environment. They have a sky, fog, sun shadows, finished ground, a tuned grade and bloom on what glows.

### Battle

Battle is the comparison of ready-made assets ([D-121](decisions/D-121-comparison-tier.md#battle)). Two armies of animated soldiers and mechs meet on a cratered field at dusk, with tanks behind each line.

- Both engines load the same two files from the [sample content](sample-content.md): `characters/battle-soldier` and `characters/quaternius-mech`. The comparison's entry says why it loads files, and a unit test checks that each comparison that loads files says so, in both halves.
- The soldier's rifle is a mesh of its own under the right hand's joint in the file. null3D attaches a rigid mesh to a joint only from the file, since its joints are not objects. three.js's `SkeletonUtils.clone` keeps it under the bone. So the weapon follows the hand in both engines.
- The count is the soldiers and mechs of both armies. The scene description (`scene.ts`) holds the seeded battle, the terrain with its craters, the scenery, the particles and the lights.
- Battle's ramps start at 200 units on every device class and rise by a fifth a step. They top out at 10,000 units on desktops, 8,000 on tablets and 4,000 on phones. The desktop top stays under the engine's animation table, which holds about a million joints: a unit takes about eighty, so the table fills just past thirteen thousand units, and the scene stops making them (E1102, 20 October 2026).
- Smoke, fire, sparks and muzzle flashes are rows of sprites that `scene.ts` fills each frame (`examples/lib/particles.ts`). Night town's rain, steam, exhaust and glows use the same rows. null3D draws each layer as a sprite batch (`particles-null3d.ts`), and three.js as an instanced quad that faces the camera (`particles-three.ts`). The particles add-on is on main now, so a scene that moves to it changes only the null3D side.
- Grass and flags sway, and the wrecks' embers glow, through custom materials. null3D takes WGSL surface and vertex functions. three.js takes GLSL added to `MeshStandardMaterial` on WebGLRenderer, and node materials on WebGPURenderer (`three-shaders.ts`).

### Battle's low sun (19 October 2026)

The owner reported that the low sun's light hid the battle. The cause was the sky model. Its haze gathered tightly ahead of the sun, and that gathered light reached far past the field's own light. Bloom, which took every value above white, spread it over the whole frame. The fog's glow toward the sun also lifted the far hills and the smoke.

Three settings of `BATTLE_LOOK` changed, and both halves of the comparison read them:

- The haze's forward gather, `mieDirectionalG`, fell from 0.85 to 0.70. The sky beside the sun keeps its warm light but no longer outshines the field.
- The fog's sun glow, `sunGlow`, fell from 0.35 to 0.22. The far field keeps its shape against the horizon.
- Bloom's threshold rose from 1 to 4, above the sky's light and the fog's glow. The sun, the fires and the tracer glints still bloom; the sky and the haze do not.

The dusk sky, the sun's light and its long shadows stay. At the held frame the sun is out of view, so the sky does not change there. The difference is at the halos of the tracers and the fires: 5.8% to 6.2% of the pixels for null3D and 8.8% to 10.7% for three.js on the Mac, and 1.9% to 3.7% on SwiftShader. The references were drawn again in both sets: six on the Mac and six on SwiftShader. Each engine and GPU path has one.

### The Battle and Factory upgrades for both comparisons (M2-EX43, 18 October 2026)

Both comparisons took the Neon Harbour study's touches ([D-172](decisions/D-172-neon-harbour-follow-ups.md)). A comparison draws one description in both engines and holds one frame for each, so every touch draws the same content in both halves. The lens grade and the scorch marks are switches, on in both halves or off in both.

Battle:

- A lens grade splays the colors at the edges, streaks the brightest light sideways and adds film grain. It runs on the linear light before bloom and tone mapping in both engines. null3D uses its custom effect. three.js uses a shader pass on WebGLRenderer, or a TSL node on WebGPURenderer.
- Smoke takes the fire's light at its base, so the smoke at a blast or a burning wreck turns warm. Each tracer carries a small bright glint, which the lens grade streaks. Both engines draw these colors from one set of sprite rows.
- Scorch marks cover the craters and the burnt wrecks. null3D's decal material projects a box onto the terrain, and three.js's `DecalGeometry` projects a mesh onto the same terrain. Both take one map, made in code. The decal's angle fade keeps the mark off vertical surfaces such as legs and walls. three.js projects its marks when the worker builds the scene, which adds a moment to the page's start.
- The light shafts stay out. null3D's shafts are a volumetric pass through the sun's shadow map. three.js's worker draws no such pass, and cones would approximate a different effect. Flying traffic and rooms behind windows belong to Night town and the instances demo by D-172.

Factory:

- The hall powers up in a wave from its middle. The spot lights, lenses, cones of haze, floor lines, warning lamps and status screens follow one shared function of the simulation time. Both engines read the same function. The held frame at 6 seconds is fully on.
- Six status screens hang under the spot lights. One texture, drawn in code, shows a parts count, load bars, cell lamps and a warning strip behind the LCD's red, green and blue stripes. Both engines show it as an emissive map.
- Each spot light draws a cone of haze. One open cone mesh fades from the lens to the floor through its vertex colors. A surface function in null3D and a shader or node material in three.js fade it where its surface turns away from the camera. Both add its light.
- Three pooled point lights flash where the arms grip and release. Both engines place them and set their intensity from one shared function.
- The screen-space reflections stay out. Battle's ground is not planar, and the worker has no screen-space path. Factory's floor could mirror the hall. The task does not name it. A second view of thousands of parts would change the draw cost that the published ramps measure.

Against the old pictures the drawn ones differ in 3.8% to 5.8% of their pixels for the Battle tests. They differ in 7.6% to 12.8% of their pixels for the Factory tests, against the limit of 0.1%. The references moved in both sets. The image tests' time limit rose to 600 seconds for both comparisons, because the lens grade and the decals cost the software GPU more.

### The Night town upgrade for its comparison (M2-EX43, 19 October 2026)

Night town took the Neon Harbour touches that D-172 gives it. As in the other comparisons, one description draws the same content in both halves at the same simulation time.

- A lens grade splays the colors at the edges, streaks the brightest light sideways and adds film grain. Its settings are softer than Battle's, because the town is dark and its lights are small. It runs on the linear light before bloom and tone mapping in both engines, and it is a switch.
- Every lit window shows a room behind its glass. The eye's ray reaches the back wall and the side walls of a box that starts at the glass. A window thus shows more of its room from the side of the street than from in front. The window boxes and the room's depth come from the scene description. null3D draws it in the facade's WGSL surface function. three.js draws it in the GLSL it adds to `MeshStandardMaterial`, and in the node material on WebGPURenderer. The rooms multiply the window's light, so an unlit window stays dark.
- Flying cars cross the sky above the streets: four lanes, two heights and four cars a lane. The scene description gives each car's place and turn from the simulation time. Both engines draw them as batches, so they add no parts to the measured scene graph. Their nose and tail strips are emissive, with a halo in each car's layer of glows. They add no lights, so the count keeps its meaning.
- The power-on wave stays out. It would set the intensity of every lamp, sign and car light each frame for its first seconds. Those thousands of lights are what the comparison's ramp measures. Factory shows the wave with its five spot lights.
- The LCD screens stay out. Factory took the LCD technique this task. Night town's shop windows already show shelves, neon and the room's depth, where a screen would replace the window that the touch before it adds.
- The reflection probes wait for M2-EX32. The page's effect list reserves the switch after the lens grade, and no half reads it yet.
- The cars' halos, the rooms and the lens grade change every held picture. Against the old pictures the drawn ones differ in 9.6% to 11.0% of their pixels, against the limit of 0.1%. The references moved in both sets. The held frame stays at 3 seconds and 96 lights, and SwiftShader still draws 24.

### The stats panel of three.js

`examples/lib/stats-three.ts` measures three.js as the engine's overlay measures null3D, and shows the figures in the same panel, `StatsPanel` from `@null3d/engine/stats`. The worker times its frames, splits each into the scene's code and three.js's render calls, and counts draws, triangles and instances through `renderer.info`. The GPU time comes from WebGL2's timer queries or WebGPURenderer's timestamps, where the page starts with the panel open. The page adds its own heap and the whole page's memory with the overlay's calls. three.js reports no GPU bytes, so the card leaves those out and names the counts of geometries and textures in its last line.

### Before a comparison goes on the page

A device sitting runs its ramp on the Mac in Chrome and Safari, the S24+, a Pixel, the iPad and a WebGL-only iPhone. Each run goes into [tested devices](tested-devices.md). null3D must hold the higher count on every device class.

## New feature demos (M2-EX10, 10 October 2026)

Five demos show public features that no demo showed. Before them, every demo held one hour of the day, and two demos turned on a fixed depth of field. No demo used points, morph targets made in code, or fly and first-person controls. Planar reflections, grading tables from numbers and the stats overlay needed no new demo: four demos, the post effects demo and every demo show them.

| Demo and scene | What it shows |
| --- | --- |
| time-of-day: Lighthouse point | A day passes over a lighthouse on a headland in 40 seconds. `timeOfDay(hour)` gives the sky, the sun or the moon, the fog's color and glow, the sky's intensity and the exposure. The clock runs slowly through dawn and dusk. At dusk the windows and the lamp light up, and two beams sweep the sea |
| walk-and-fly: Temple ruins | A walk through ruined columns at golden hour, with braziers that flicker. First-person controls walk and look, a click locks the pointer, and Space switches to fly controls |
| camera-lens: Chess endgame | A low shot across a chess board at its real size. The focus racks from a near pawn to the far king with `focusPoint`, and a dolly zoom takes the lens from 35 to 85 mm, so string lights behind the board swell into wide discs |
| galaxy: Spiral galaxy | 120,000 stars in one points batch, 30,000 on Low, in additive light with bloom. Each ring of stars turns by its own angle, so the arms swirl |
| morph-flowers: Tulip bed | Tulips made with `geometry.fromArrays`. One morph target opens the petals, turns their normals and changes their color from a green bud to the full color. Each tulip has a weight of its own |

The rules that these demos follow, and why:

- `timeOfDay` makes a new object on each call. So the time of day demo calls it only when the hour moves on by three minutes: 4 to 20 calls a second, fewest at dawn and dusk. Its clouds hold still. The sky's light refreshes after each change of the sky, one step a frame, so drifting clouds would cost a step in every frame.
- The lighthouse's beams are open cones with a custom material: added light that fades from the lamp outward and toward the cone's edges. The material's base color is black, so the sun lights nothing on them. Its reflection is black too, and it takes no fog. Additive blending adds everything that a surface shows. So a cone that reflected the sky or took the fog's color showed as a faint disc. That happened when it pointed at the camera, even with the lamp off.
- The depth of field demo works at the real size of a chess board, in metres, because the blur follows a real lens. At f/1.8 and 85 mm, a few centimetres out of focus blur well. Low draws no depth of field, so the demo sets `dofSamples` to 16 there, again after each change of preset. Its aperture has six blades, so the string lights' discs show soft hexagon corners. Their blur reaches about 12 texels of the half-size image, so the gather's soft edge rounds the corners off. A largest blur of 0.05, not 0.03, made sharper corners, but spread the taps so far apart that the discs and the near pieces turned grainy.
- A points batch has no transform, so the galaxy turns by writing its positions. It splits the stars into 48 rings, works out one cosine and one sine per ring, and turns each star by its ring's pair. The rings sway ahead and back around a slow turn of the whole galaxy. A turn that differed by ring for ever would wind the arms up into rings within a minute. The batch is dynamic, so it uploads every star in every frame.
- The time of day demo's sun sets about 30 degrees right of the island. So the island is lit from the side, not only from behind. An ambient light in the fog's color lifts the side away from a low sun. It grows with the exposure at dusk, up to a cap, so it adds little by day. The fill is an ambient light, not a hemisphere light. It must light the side of the island in shadow and the lower cliffs as much as the tops, in one color. A hemisphere light with a darker ground color would darken those cliffs. The sky's environment alone left the island a dark shape at sunset. The sea is a little rough, so its foreground takes the warm glow near the horizon, not only the dark sky above.
- The tulip bed's camera stands low enough to show the morning sky above a low hedge. From higher up, the frame showed only the far lawn through the fog, which read as a flat green wall.
- The hedge behind the tulip bed is a dark core under 2,400 small leaves in three greens. The leaves draw as three instance batches, one per green. As 2,400 meshes, each SwiftShader image test took about 24 s on a busy Mac. As batches, each took 9 to 10 s.
- The tulips' normals come from each petal's slopes, worked out from nearby points in both poses. The morph target holds the change of each normal, as it holds the change of each position and color.
- The walk and fly demo has no orbit controls: its controls are the feature it shows ([Always-on interaction](#always-on-interaction)).
- The demos' sketches stay under 150 lines with plain number arrays for their tables, such as each chess piece's parts. The formatter puts each array of arrays on many lines.

### Frame rates of the five demos on the Mac

The figures come from Chrome on a Mac with an Apple M5 Max, on 10 October 2026. Each demo ran at the preset that the engine chose, with the governor on. The display runs at 120 Hz. Each figure is the stats overlay's reading, 15 seconds after the start, five readings a second apart.

| Demo | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| time-of-day | 120 fps, GPU 3.7 to 5.4 ms | 120 fps, GPU 3.0 to 4.0 ms |
| walk-and-fly | 120 fps, GPU 2.3 to 4.2 ms | 120 fps, GPU 2.7 to 5.5 ms |
| camera-lens | 120 fps, GPU 4.9 to 5.2 ms | 120 fps, GPU 5.2 to 8.3 ms |
| galaxy | 120 fps, GPU 3.7 to 4.6 ms, sketch 1.6 to 1.8 ms, 120,000 stars | 120 fps, GPU 3.3 to 4.7 ms, sketch 1.1 to 1.2 ms |
| morph-flowers | 116 to 120 fps, GPU 4.4 to 5.1 ms | 118 to 120 fps, GPU 5.2 to 5.8 ms |

The galaxy's sketch time is the loop that turns every star and writes its row. It grows with the count, so Low draws 30,000 stars. No phone or tablet has run the five demos yet.

## The aurora demo (M3-E10, 24 October 2026)

`aurora: A frozen lake at night` shows the sky-layer hook: the aurora example add-on draws one WGSL function over the core sky, under the moon and the stars, in the camera's view, in scene passes and in reflections.

- The layer lights nothing: the sky's environment map and its diffuse light come from the core sky alone, and the demo adds one dim ambient light in the aurora's color so the ice and the snow read under it. A sketch that a layer must light gives it a light of its own, as this one does.
- The layer reads the core sky's cloud coverage and density, so the demo keeps the physical sky's thin clouds: they hide the aurora where they thicken, as they hide the stars.
- The curtains are flat in the sky and have no parallax. The camera stays at eye height over the ice, so the layer reads as a sky and not as a wall.
- The image test holds the demo at 1.5 seconds, where the aurora's swell has moved the layer by less than a step.

## The automatic exposure demo (M2-EX31, 11 October 2026)

`auto-exposure: Courtyard and hall` shows automatic exposure ([D-148](decisions/D-148-automatic-exposure.md)). The camera walks from a sunny courtyard into a dark stone hall, turns round, and walks out again, in a loop of 20 seconds. The eye opens in the hall, and closes again when the camera faces the bright door. E turns automatic exposure off and on, so a visitor can see the fixed exposure that the camera would have.

- The demo's sketch stays under 150 lines, and its scenery lives in `hall.ts` beside it, as the coordinator's ruling of 11 October 2026 allows. Its entry's `code` field names the folder.
- The camera's exposure suits the courtyard. The hall keeps the sun out with walls and a roof, and its own light comes from six lamps, a spotlight and a dim room environment, about five stops below the courtyard. The eye's range, -7 to +1 stops, covers both.
- The eye adapts to the dark at 0.8 stops a second and to the light at 2.5, so the hall brightens slowly and the courtyard settles fast, as eyes do.
- The held frame, 6 seconds in, stands inside the hall. Hold mode meters its one frame and takes the result at once, so the image test shows the adapted hall.
- The walk stops at each end and turns there, with each leg eased, so the eye's change shows while the view holds still.
## The crystal spiral's scenery (11 October 2026)

The owner wants the demos "as amazing as possible". The custom shader inputs demo (`shader-inputs`) had a plain dark floor. Its scenery now lives in `examples/shader-inputs/pool.ts`, beside the sketch, so the sketch keeps to the crystals and the stones that show the feature.

- A dusk sky with the sun low behind the stones. The sky's own environment gives the light, so the reflections on the crystals match the sky.
- A floor of polished dark slate, made in code: soft clouding, thin pale veins, and thin water in its hollows. A reflection pass draws the scene mirrored across the floor. The water shows that picture sharp; the dry stone draws it out into short streaks down the screen, as on a wet street. Rings run out across the water in step with the crystals' wave.
- A low mist: fog that thins with height and glows toward the sun. Its color is the color of the sky at the horizon, so the far floor meets the sky with no line. The floor reaches 1.5 km and the camera sees 3 km, so the floor's edge lies at the horizon.
- The clouds stand still. The sky's environment follows the sky, so moving clouds would make it again over every few frames.
- The floor mirrors the crystals on WebGL2 too. Until M2-EX38, WebGL2's reflection pass drew each call after the floor's with the draw records of the call before it, as it left the floor out of its own reflection. The crystals' material comes after the floor's, so the crystals went missing from the mirror. The `reflection-batches` image test now puts a custom-material batch over a mirror.

## The campfire glade's scenery (12 October 2026)

The particles demo's scenery lives in `examples/particles/glade.ts`, beside the sketch. Two points came from the look review:

- Sphere crowns with flat shading read as faceted low-poly balls, not foliage. Each birch's crown is now five bumpy lumps, built from arrays. Each lump is a ball with bumps of two sizes and smooth normals. Its vertex colors darken the hollows and vary at random in brightness and hue, as clustered leaves do. Three such lumps, turned and tinted in four autumn colors, give every tree a different crown.
- A firelight with the physical fall-off lit only the stones. The firelight now fades more slowly than real light (`decay` 1.2), reaches 16 m and is warmer, so the ground round the fire and the nearest birch trunks take its glow. Its flicker is soft: about a fifth up or down, from three slow waves that never fall in step.

## The stone garden's scenery (12 October 2026)

The owner asked for a richer contact shadows demo (`contact-shadows`, Stone garden) on 12 October 2026. Its scenery now lives in `examples/contact-shadows/garden.ts`, beside the sketch, and all of it is made in code.

- Sand raked in rings around each rock, and in straight furrows between them. A normal map from the same rake gives the low sun a light relief. A stronger relief drew dark stripes that hid the cast shadows.
- Granite rocks: polyhedra from `@null3d/geometry` with bumps, flat underneath, each with its own shape and warmth. One granite texture made from value noise covers the rocks, the stepping stones, the curb and the lantern. Moss covers the rocks' tops through their vertex colors.
- Pebbles and moss clumps in one batch, tufts of grass, a stone lantern with a warm point light, and a plaster wall with a tiled cap.
- Beyond the wall, a bamboo grove and pines of seven ragged tiers that droop at their tips. Their greens hold little red. A green with more red turned khaki in the orange light of the low sun.
- The sun keeps the hour's own height as it turns, and the sky's sun turns with it. When the sky's sun stood higher than the hour's, the sky was too bright for the low sun's light, and the long shadows hardly showed. The sky's environment lights the scene, so the demo has no ambient light.
- The wall stands high behind the garden, away from the sun's side. On the left, the sun's side, it stands only 0.5 m high. The first left wall stood 1.2 m high and shaded half the bed under a sun this low. The bamboo behind it fills the skyline there, and casts no shadows.
- The camera stands low and close, over a rock, its drift of pebbles and a stepping stone, and the sun stands about 10 degrees high. There, the cascades miss the pebbles' long shadows, and contact shadows draw them. On a tall screen the camera stands farther back with a wider view, and looks above the stones, so they sit low in the frame.

## Showcase scenes

The showcase tier holds a few large scenes that show the engine at its best, as the best three.js scenes that people share do. The reference is "Cozy creek", a three.js scene shared on 8 October 2026. It has clear water over a stony bed, dense grass and plants with soft shadows, and rocks and a cave. It also has time-of-day presets and a depth-of-field switch.

- **No line limit:** a showcase scene is not a feature demo, so the 150-line limit does not apply. It lives in `examples/showcase/<name>/`, and its code link points to the folder.
- **Shared code:** the showcase scenes share a stage (`examples/lib/stage.ts`: moods and times of day) and generators of detail (`examples/lib/procedural.ts`: textures made in code, terrain and rocks).
- **Models:** terrain, stones, grass and water are made in code. Trees and plants come from the vegetation add-on once it exists, generated at first use ([D-241](decisions/D-241-vegetation-foundation.md)). Until then they, and other organic hero models, are built by script in Blender, and live in the sample-assets repository. A showcase scene's `assets` field says so.
- **Interaction:** a showcase scene takes the user's input while it runs. Its camera is the cinematic route above, and `c` hands the camera to the user, who then flies with the keys, the mouse or a touch drag, without a run from the scripted pose.
- **The look:** each scene must look very beautiful, with shaders, effects, particles and complex geometry ([D-132](decisions/D-132-showcase-look-and-features-2026-10-11.md)).
- **Engine features first:** each scene waits for the engine features it needs. The owner moved them before 1.0, in [D-117](decisions/D-117-showcase-features-before-1-0.md), [D-132](decisions/D-132-showcase-look-and-features-2026-10-11.md) and [D-142](decisions/D-142-more-techniques-before-1-0.md). The table below lists them.
- **Choices:** a demo's entry can list `choices`, such as a time of day. The page's `startDemo` shows a row of buttons for each, in an element that the page gives it. Each pick goes to the sketch as a message. The showcase scenes carry the same picks in their controls HUD instead, so their entries list no `choices`. A held frame has no buttons, so a sketch also reads its first choices from its own address: `?mood=Night&dslr`.
- **Image tests:** a showcase scene's image test draws its full look on the Mac's GPU. On SwiftShader it draws the Low preset, through the test's SwiftShader switch `preset=low`, which takes the place of the references' preset. The full look took the software GPU too long for CI.
- **Camera and help:** every showcase scene has an Auto and a Manual camera ([D-170](decisions/D-170-showcase-camera.md), owner, 14 October 2026). Auto is the default and plays a route tailored to that scene. The route opens on a wide establishing view that shows the whole scene, holds it only briefly (about half a second to a second), and moves off, so the camera starts moving soon after the page loads; it then moves through the scene's interesting parts as a smooth flythrough. The camera's path is a centripetal Catmull-Rom spline through the shots, each shot taking its own turn of the route's parameter, so the camera passes every shot at speed and rounds the corners between them rather than easing to rest at each one. It never passes through a building or other geometry, and it never stands still: consecutive shots differ and the loop closes without a pause. A shot that holds is the one deliberate pause, and it is used for the opening view that the image tests hold. `c` switches to Manual, which halts the route's motion at once and takes the camera at the pose the route held that moment, with no drift, and then turns, zooms and pans around the point the shot was looking at, through the engine's orbit controls. On a wide screen a left drag turns the camera, the wheel zooms, a right drag pans, and `W`, `A`, `S` and `D` pan (`R` and `F` rise and fall). On a touch screen one finger turns, a pinch zooms, and a two-finger drag pans. Auto glides back onto the nearest point of the route, easing in and out over about 1.5 seconds. `examples/lib/cinematic.ts` holds the route player, the mode and the manual camera, and is generic: each scene gives its own shots and manual pan speed, so no route is copied between scenes. The route is a function of the sketch time, so the image tests' held frame is one fixed pose and never drifts. In every scene the **Auto** route never passes through an object: `examples/lib/clearance.ts` guards it, and a shot may opt in to a deliberate pass. The **Manual** camera may pass through anything, but it stays inside the scene's bounds, below the mountains around it and above the ground (owner, 20 October 2026; see the bullets on the mountains and the bounds below).
- **The controls HUD:** each showcase scene shows a collapsible controls HUD ([D-171](decisions/D-171-showcase-controls-hud.md), owner, 14 October 2026). At rest it is one translucent chevron at the bottom of the panel; pressing it slides up a glass panel, and pressing it again closes it. `h` and `Escape` do the same from the keyboard. The panel is **tabbed**: one tab per group, and only the selected group's buttons show, so the panel stays short on any screen, a phone included. The tab bar scrolls across, the selected group scrolls inside a bounded panel, and the selected tab is remembered while the panel is open. The tablist is `role="tablist"`, each tab is `role="tab"` with `aria-selected` and `aria-controls`, each group is a `role="tabpanel"`, and the arrow keys, Home and End move between tabs. Every button carries a tooltip that describes its function alone, with no input device named; the tip shows on hover, keyboard focus and a press. A change shows a short toast at the top centre, such as `camera: manual` or `Bloom: on`. The groups are Camera, Time of day, Atmosphere, Lighting, Post and Quality, and a scene shows only the groups it can support. `C` and `H` show as small key badges, since only the camera and the controls carry a shortcut. `examples/lib/hud.ts` holds the shell, `examples/lib/controls.ts` holds the model, and the sketch posts the model with the `hud` message, so it never touches the DOM. `tests/image/showcase-hud.spec.ts` picks a button in each group and checks its toast. It also reads the canvas after the Sky, Fog and Environment switches: each part must stay off over several frames and come back when it turns on.
- **The time of day is a dial:** the Time of day tab shows a round dial instead of a straight slider, so the hour wraps round from night into the next dawn (owner, 20 October 2026). The ring holds the sky's color at each hour, with midnight at the bottom and noon at the top. Its readout shows the hour as a clock time and its name: Midnight from 23:30 to 00:30, then Night, Dawn, Morning, Midday, Afternoon, Golden and Dusk. A drag round the ring, a tap on it, the arrow keys (a quarter hour) and Page Up and Page Down (an hour) set the hour. The dial is a `role="slider"` whose value text names the hour. Auto and Studio each turn on with a press and off with the next. A second press on Auto holds the hour that Auto reached. A second press on Studio gives back the hour it took the place of. Auto starts from the hour on show, so turning it on never jumps the sky. While Studio is on the dial dims, and while Auto runs the knob glows. A slider whose model carries a `dial` draws this way (`HudDial` in `examples/lib/controls.ts`). The dial and its buttons size down on a phone.
- **The sun's layers:** a light's layer mask picks the objects that cast its shadows. The showcase suns take `SUN_LAYERS`, the default and the interior layer, so an object a visitor may enter still blocks the sun: Creek's cave rock once let the sun through onto its floor (owner, 20 October 2026). What fills the air casts no shadow.
- **The stage owns the sky, fog and environment switches:** the stage writes the sky, the fog and the environment light every frame, so a scene that turned one off with its own call to the scene had it back one frame later, while the toast said it was off (fixed on 15 October 2026). The HUD's Sky, Fog and Environment buttons now call `stage.show`, and the stage leaves each part that is off out of every later frame and mood, the studio included. A part that is off is written once, when it turns off. Sky off also turns off the environment light, since the scene takes that light from the sky. `examples/lib/stage.test.ts` checks it without a browser.
- **One key table:** `examples/lib/cinematic.ts` owns every key of a showcase scene: `C` for the camera, `W`, `A`, `S`, `D`, `R` and `F` for the Manual camera, and the `H` and `Escape` that the page's controls answer. A scene adds a key through `createCinematic`'s `keys`, and a key that the table already holds throws. The depth-of-field lens once took `D`, which also pans the Manual camera, so one press did both. D-171 gives a shortcut only to the camera and the controls, so the lens now has none: the Post tab's Depth of field button turns it on and off. `examples/lib/cinematic-keys.test.ts` fails on a clash, and on a showcase scene that reads a key itself.
- **The effects start off:** a showcase scene starts with bloom, automatic exposure and the vignette off, so the scene reads as the owner approved it; the Post buttons turn each on, and the initial `post` settings match the off state. A button that starts off starts unpressed, and pressing it shows `bloom: on`.
- **The loading overlay:** `examples/lib/run.ts` draws a glass loading overlay over the canvas before the engine starts. It names the engine's start stages (`core`, `sketch`, `first-frame`) and any progress a scene posts while it loads (`examples/lib/progress.ts` reports a scene's file count, and a scene with nothing to load posts its build phases). It fades out when the first frame draws, and shows the error text instead when the start fails.
- **No overlapping geometry:** a demo's and a showcase scene's own geometry must not overlap (owner, 14 October 2026): two pieces that cross or lie coplanar over one another z-fight and shimmer. `examples/lib/overlap.ts` holds `findOverlaps`, which tests each pair of triangles; a shared or deliberate intersection is named in `ignore`. The night town's unit test runs it over every house's walls, roof and chimney ([D-170](decisions/D-170-showcase-camera.md)). A scene that builds through the engine keeps no triangle arrays a unit test can read, so a general per-demo check waits for a scene readback; the D-170 addendum records this.
- **A ring of mountains:** every showcase scene stands inside a ring of mountains made in code (owner, 20 October 2026, [D-170](decisions/D-170-showcase-camera.md)). The view then never reaches the plain background past the land's edge. `examples/lib/mountains.ts` builds the ring around the scene's square of land. The ring starts half a meter inside the land's edge, a little under the land. It rises outside the edge into foothills, climbs to a crest line of peaks and passes, and falls a little behind it. Each scene's `land.ts` gives the crest radii, the lowest crest, the highest peak and the colors of forest, rock and snow. It also names any gorge that cuts through the mountains. Creek's stream runs on out of the valley at both ends through a gorge (owner, 20 October 2026). There the ring takes the valley's own floor, its walls climb to the mountains either side, and the land and the water run on to 720 m. `examples/lib/haze.ts` fills the far end of each gorge with ten thin unlit sheets, from 330 m to 700 m. Each sheet hides a little more than the one before, and the last hides all, up to 60 m over the walls and thinning above. Over the gorge's floor the haze lies low: solid to 6 m and gone by 26 m. It climbs with the walls either side, which it must hide where they end. The sun rises out of one gorge and sets into the other (owner, 20 October 2026), so it shows almost down to the water. The sheets take the stage's air color each frame, so the haze matches the sky at every hour. They also glow toward the main light with the light they scatter forward, so a sun behind the haze lights it, as a real haze does, and the haze does not show as a gray wall. The engine's fog never covers the background, so the haze sheets are what hides the end of the world there. The ring casts and catches no shadows, since it lies past every shadow range. Its detail follows the quality preset: about 10,000 triangles on Low and 36,000 on Ultra.
- **The Manual camera's bounds:** the Manual camera stays inside the ring, below its lowest crest and above the ground (owner, 20 October 2026). Every view ray that falls then hits land or mountain, and every one that rises hits mountain or sky. A scene passes `bounds` to `createCinematic`. They hold the farthest distance from the point the camera turns around, which is the orbit controls' own `maxDistance`. They also hold a disc and a band of heights for that point, and the ground's height. A pan stops at the disc's edge, and the camera moves with the point, so the view does not turn. A camera that would go under the ground rises along its orbit and keeps its distance and bearing. The bounds' `clearance` sets how far above the ground it keeps: 1.5 m by default, and 0.15 m in Creek, whose ground under the water is the stream's bed. So Creek's camera may dip under the water but never through the bed (owner, 20 October 2026). So pushing against the ground never draws the camera in. The clamp that the owner removed on 14 October 2026 shortened the distance each frame and walked the camera inward. The camera's highest reach is the point's highest plus the distance, and each scene's lowest crest stands at least 10 m above it. The tests:
  - `examples/lib/mountains.test.ts` checks the crests, the reach and the join under the land.
  - `examples/lib/bounds.test.ts` checks the bounded camera.
  - `examples/lib/showcase-routes.test.ts` checks that every pose of each Auto route lies inside its bounds, so a takeover never moves the camera.
- **The shadow range follows the camera:** the night town's sun once reached a fixed 70 m, and its shadows faded over the last 7 m. The Manual camera could dolly out with no limit. Past about 70 m every house lay beyond the range. A quick zoom then carried the whole town across the fade in a fifth of a second, so the shadows appeared at once (owner's recording, 20 October 2026). Even the opening view put the back houses at 75 to 82 m. Each scene now passes `shadowReach` to `createShowcaseEffects`: the range it asks for close up, and the sphere of its core. The core is the night town's houses and tower, and Creek's stream and banks. Each frame, the range is the shortest step of a ladder of 1.25 times that reaches the core's far side. It rises at once, and falls only once the need is a whole step lower. Close-up shadows stay as sharp as before, and the core never leaves the range. The engine's automatic distance ([D-168](decisions/D-168-auto-shadow-distance.md)) does not fit here. It follows the farthest visible receiver, which in these scenes is the ground out to the mountains. It would hold the range at 150 m or more and blur the near shadows.
- **The sky, the sun and the moon:** the outdoor moods drive the physical sky, `scene.setBackground({ atmosphere })`, from `timeOfDay` with the physical model ([D-171](decisions/D-171-showcase-controls-hud.md)). The real sun disc lights the scene by day and the moon disc at night, the main directional light is the sun by day and the moon at night, and the lit fog and the light shafts follow that light, so a scene shows sun rays by day and moon rays at night. `Auto` advances the hour continuously and loops, so the sun rises, arcs and sets and the moon does the same, while the fixed moods hold an hour. A whole day takes 80 seconds in Auto (owner, 21 October 2026; it took 4 minutes before). `examples/lib/stage.ts` holds the moods and the Auto driver.
- **The look follows the light, not the nearest mood:** a scene's own look, such as Creek's fireflies, mist, leaf tint and caustics, blends between the moods on either side of the hour (`moodMix` in `examples/lib/stage.ts`). Through the dark hours, while the sun is more than 18 degrees under the horizon, it holds Night. Only while the sky has light does it move from each mood to the next. The dawn's look comes in through the morning twilight and is whole at Dawn's hour. Creek once took the look of the nearest fixed mood. At 02:36, halfway between Night and Dawn, the dawn's warm caustics then came on at once, and the stream changed color in the middle of the night (owner's recording, 20 October 2026). The stage's own haze factor blends the same way. `examples/lib/stage.test.ts` checks that no mood's share steps between hours a minute apart.
- **The showcase scenes are Creek, Night town and Skyway.** A forest at dawn, a night town under the moon, and a city from the air.

### Skyway (M3-C1, 22 October 2026)

Skyway is the third showcase scene. It flies a hover car through a rainy night city. The scene
shows the engine at scale. It draws 30,000 to 100,000 hover cars on the sky lanes, on one instanced
batch of towers whose windows light one by one. It adds 180 street lamps, three searchlights, rain,
and a hero car with two screens.

- **The lanes cost nothing per frame.** Each car is a row of one of four instance batches, one for
  each heading. Its place along the lane comes from the row's start offset, its speed and the frame
  clock. The shaders guide holds that contract ([Surface functions](../docs/shaders/surface-functions.md)).
  A preset draws fewer cars by lowering the active row count. The rows were shuffled once, so a
  thinner preset thins every lane alike. The traffic-lanes example add-on owns this
  (`examples/addons/traffic-lanes/`), and Skyway uses it.
- **A hull's vertices are what a lane pays for.** Every face of the vehicle hull carries its own
  four vertices, so a car is 72 vertices for 36 triangles, and each pass that draws the lanes pays
  for them, the reflections' depth prepass among them. `createVehicleHull` therefore takes a detail
  as its third argument. The light hull shares each vertex between the faces that meet at it, which
  draws the same triangles from 24 vertices and shades the body as one smooth shell instead of
  faceted panels. Skyway draws the light hull at Low, the preset a phone runs, and the full one at
  Medium and above. At Low, at the pixel size of a cloud phone's screen, that took the frame from
  3.79 to 3.06 ms of GPU time on WebGPU and from 7.09 to 5.38 ms on WebGL2, and the traffic's own
  share from 1.33 to 0.64 ms and from 2.81 to 1.11 ms
  ([D-246](decisions/D-246-skyway-vehicle-vertices.md)).
- **A moved row needs a larger bounding sphere.** The engine culls each row by its mesh's bounding
  sphere. A vertex offset carries a car up to the lane's length from its row's origin. Each batch
  therefore gives its rows a radius that covers the lane, with `batch.setBoundingRadius(span)`
  (documented in [Instances](../docs/concepts/instances.md#culling)). Before that call existed, the
  hull carried a zero-area sliver to stretch the sphere.
- **The windows are a world-space grid.** One window is the same size on every tower and on every
  face. It never stretches with a building's scale. A lit window shows a small room in parallax:
  a lamp panel, a floor, a ceiling and a block of furniture. Where a window covers less than a
  pixel, the face fades to its average light. The grid then never shimmers.
- **The power-on wave** lights the city from the middle out over the first second, from the frame
  clock. A held frame therefore always shows the same city.
- **The lights.** The city holds 180 point lights and three spot lights. Its windows, signs and the
  cars' lights are emissive surfaces. The engine lists at most 1,024 lights in a frame. The plan's
  1,000 to 4,000 real lights through the fog therefore waits for the many-lights work (M3-F3). The
  volumetric fog is on, so the searchlights draw their shafts through the rain.
- **The effect layer.** The traffic, the rain, the signs and the hero car sit on `EFFECT_LAYER`
  (`examples/lib/layers.ts`). The Auto route's clearance guard never treats a moving car as a wall.
  Its ray tests the towers and the ground alone.
- **The camera.** The route is a circuit of four street canyons. It climbs from the south entrance
  to the tower tops, and dives back down. It follows the street center lines of the plan, so it
  never enters a block. `route.test.ts` samples the whole loop through the player's own
  interpolation. It fails on a sample inside a building.
- **No ring of mountains.** The fog's reach is about 240 m, and the ground plane reaches 2.1 km.
  The view therefore never sees the ground's edge or the plain background. A ring would stand in
  the fog and add nothing.
- **Post starts on.** Bloom, the vignette and ambient occlusion start on, where the other showcase
  scenes start them off (D-171). A night city of neon and lit windows reads flat without the glow
  of its lights. The owner has not reviewed the look yet.
- **Time of day.** The scene takes its full time of day from the shared stage, as the other
  showcases do. It offers the same hour dial, with Auto and Studio, over the whole day. The physical
  sky draws the real sun by day and the moon at night, and Auto moves them across the sky. The scene
  sets the stage's three scales for a scene lit by its own lamps. The exposure is 4.5, the
  environment light 2.2 and the sky's brightness 2.6. It lowers the cloud cover to 0.45. The scales
  hold through the whole day, because the physical model's own exposure already falls by day and
  rises at night. Scaling them again by the hour made midday darker than dawn. The stage writes the
  scene's lit fog with every hour, through its `volumetric` option.
- **The city's lights follow the hour.** The stage reports the share of a town's own lights that
  the sun allows (`stage.lamps`). The scene gives it to the facades' windows and shop fronts, the
  street lamps and their heads, the searchlights and the signs. Every lamp's light and every
  searchlight fades with the share. A sign keeps nearly half its light by day, as a lit sign does.
  At Night the share is 1 exactly, so the held frame's picture is the one the scene had.
- **Storm is weather, not an hour.** The Atmosphere group's Storm button calls the stage's
  `setWeather`. That gives full cloud and fog 2.4 times as dense. The sky and the light fall to a
  third and to a half, and the rain is 1.8 times as heavy. The weather clears when the button turns
  off. It works at any hour, so a storm at dawn is a storm under a dawn sky. A held frame has no
  buttons, so its address takes `?storm` as well as the hour.
- **The HUD** keeps Camera, Time of day, Atmosphere (Fog, Rain, Storm), Lighting (AO, Environment),
  Post, Traffic and Quality. The scene's own controls reach the shared router through its `own` and
  `extra` options. The lens kit owns the vignette and the scene's lens owns the depth of field. The
  Traffic group stands before Quality.
- **The hours were drawn and looked at.** The image test draws Night, whose reference did not move.
  At night the light share is 1 and every scale is the value it always had. Dawn, Midday, Golden,
  Dusk and Storm were drawn and reviewed. Midday reads as an overcast city that the fog still
  layers. Golden warms the towers and the sky, and Storm drives the rain through a city of visible
  lamps. The light power uniform moved SwiftShader's WebGL2 picture by 0.10 per cent, at the bright
  edges of signs and lamps. That reference was drawn again. The Mac's picture still matches its own
  reference.
- **Figures.** A run in Chrome on the Mac measured these. It used the shared stage, the
  traffic-lanes add-on and its six real lights, and the lens kit in the scene. The Mac has an Apple
  M5 Max and a 120 Hz display. The frame-budget governor was on, and the window was parked past the
  screen's edge. The machine carried a shared build load of about 18 at the time:

  | Preset | WebGPU | WebGL2 |
  | --- | --- | --- |
  | Low, 30,000 cars | 118 fps, GPU 5.0 ms | 120 fps, GPU 7.0 ms |
  | Medium, 50,000 cars | 119 fps, GPU 5.3 ms | 108 fps, GPU 11.9 ms |
  | High, 75,000 cars | 102 fps, GPU 5.6 ms | WebGL2 caps the settings at Medium |
  | Ultra, 100,000 cars | 91 fps, GPU 5.8 ms | WebGL2 caps the settings at Medium |

  The GPU time barely rises from Low to Ultra. The same pixels shade the same towers, and the count
  changes the vertices alone. The scene's updates threw no error at any preset. On WebGL2 the
  settings stop at Medium, but the demo's counts follow the preset that the page asked for. So
  `preset=high` there draws 75,000 cars at Medium settings.

  These rows draw the full hull, which the demo keeps at Medium and above. At Low it draws the light
  hull, measured on the same Mac at a canvas of 618 x 1372 device pixels, the size that a cloud
  phone's screen gives the demo: that took the WebGPU frame from 3.79 to 3.06 ms and the WebGL2
  frame from 7.09 to 5.38 ms ([D-246](decisions/D-246-skyway-vehicle-vertices.md)).
- **The lens.** The picture's grade, its sharpening, its vignette and the camera's own marks come
  from the lens-kit example add-on (`examples/addons/lens-kit/`). The grade, the sharpening and the
  vignette are the core's own settings, which the kit sets from one look: the grade is the core's
  grading controls, which a job worker bakes into its table, so the kit keeps no table of its own.
  Its one effect draws the color fringes, the anamorphic streak, the grain and the speed blur, each
  off at 0. The streak reads level 2 of bloom's chain with `effectBloom`, so it spreads the light
  that bloom already thresholded and blurred instead of blurring the picture again. D-173 ruling 5
  keeps it to the core's parts: it adds no second way to do any of them. The speed blur follows the
  camera's travel, so a held frame has none. Against the pictures without it, the lens moves 0.66%
  of the pixels on WebGPU and 0.2% on SwiftShader, drawn before the streak read bloom's chain. The
  picture tests in `tests/image/manifest.ts` draw each part alone, one look to a test:
  `lens-grade`, `lens-vignette`, `lens-sharpen`, `lens-aberration`, `lens-streak`, `lens-grain`
  and `lens-speed-blur`. The marks are custom effects, so their four tests keep the two HDR tiers;
  the core's parts draw on all three. The streak and the grain move a pixel by a few steps. Their
  two pictures use a tighter threshold, because the default would not see either mark. A later
  `set` that raises a mark builds the effect then. One that lowers every mark to 0 drops it again.
  Before 24 October 2026, a kit made with every mark at 0 never drew a mark that a later call set.
- **The lens's cost.** The add-on's README holds the look's cost per preset. The cost test times
  the whole look against the same scene without it. It draws at 1920 x 1080 with a render scale of
  1, and runs as `NULL3D_LENS_COST=1 bun run test:browser -- lens-cost.spec.ts`. Its figures are
  owed: the run needs a quiet computer, and the fleet kept the Mac above the quiet threshold. On
  the Skyway scene at a load of 36, the effect alone added about 0.7 to 0.9 ms of GPU at every
  preset on WebGPU, and 0.7 ms at Low and 3.2 ms at Medium on WebGL2. The core's vignette and
  grade add nothing to a frame, since they run in the final pass; the sharpening value adds the
  first step's pass at the whole render scale. A look that leaves all four of the effect's values
  at 0 adds no effect at all.
- **On a phone**, WebGL2 runs Medium at most. That preset draws 30,000 cars, about 900 towers, 180
  lights, the rain and reflections at a quarter of the render size. Medium doubles the cars and
  raises the reflection scale. The cloud Galaxy S24 of 24 October 2026 measured two windows in a
  row on the changed demo, at Low. The first 5 s after its first frame presented 7.2 frames a
  second, with a 95th percentile of 408 ms and a 99th of 2,227 ms; the next 5 s presented 29.4,
  with a 95th percentile of 33.4 ms and a 99th of 66.7 ms, which holds the device's 30 Hz display.
  At the High preset, which WebGL2 caps at Medium and 50,000 cars, the two windows presented 20.9
  and 28.0. So the stalls are the demo's first seconds, not its steady play: the engine built no
  pipeline, skipped no draw and rebuilt no table in either window, and both windows carry upload
  spikes of about 1.2 MB, so neither explains the first window. Night town's first window had no
  such stall. A cold phone's first seconds therefore need their own measurement before the 60 frames
  a second target has a device figure.

### Engine features for the showcase

Each feature gets a decision record of its own when it is built.

| Feature | What the scenes use it for | Task | Ruling |
| --- | --- | --- | --- |
| Per-row values in instance batches | Grass that sways out of step, with a tint per blade | M2-EX13 ([D-127](decisions/D-127-row-values.md)) | D-117 |
| Environment light from the sky, with time of day | Light and reflections that follow the hour | M2-EX14 ([D-118](decisions/D-118-sky-environment.md)) | D-117 |
| Planar reflections | Water that reflects its banks | M2-EX15 ([D-120](decisions/D-120-planar-reflections.md)) | D-117 |
| Transmission | Water that shows its bed | M2-EX16 ([D-122](decisions/D-122-transmission.md)) | D-117 |
| Depth of field | A focus on the subject | M2-EX17 ([D-119](decisions/D-119-depth-of-field.md)) | D-117 |
| Temporal anti-aliasing, a prototype first | Dense grass without shimmer in motion | M2-EX18, not for 1.0 ([D-129](decisions/D-129-temporal-anti-aliasing.md)) | D-117 |
| Batch shadows | Grass and plants that cast and receive shadows | M2-R6 ([D-115](decisions/D-115-batch-shadows.md)) | D-117 |
| The particles add-on | Spray, leaves and fireflies; sparks, smoke and debris; rain and steam | M2-EX20 | D-132 |
| Light shafts and lit fog | Sun through trees, and a glow around lamps and headlights | M2-EX21 | D-132 |
| Screen-space reflections | Wet streets, puddles and polished floors | M2-EX22 | D-132 |
| Contact shadows | No light gap where an object meets the ground | M2-F12 | D-132 |
| Bump and displacement maps | Detail on stones, bark and ground | M2-J4 | D-132 |
| LOD groups | Dense, complex geometry far from the camera | M2-I4 | D-132 |
| Joint overrides, with a look-at helper | Soldiers that aim and heads that turn, on top of their animation | M2-EX24 | D-142 |
| Per-object motion vectors | The base for a later temporal anti-aliasing, motion blur and better screen-space reflections | M2-EX25 | D-142 |
| Physical sky and atmosphere | Skies of every scene, with distant objects tinted by the sun's angle | M2-EX26 | D-142 |
| Projected decals | Craters and scorch marks, street paint and puddles, moss on rocks | M2-EX27 | D-142 |
| Area lights | Shop windows and neon, studio light | M2-EX28 | D-142, D-145 |
| Light probe grid | Colored bounce light in streets, light under trees | M2-EX29 | D-142 |
| Clearcoat and sheen | Car paint, wet stone, cloth and velvet leaves | M2-EX30 | D-142 |
| Automatic exposure | Changes of mood, and the step from a lit street into shadow | M2-EX31 | D-142 |
| Box-projected reflection probes | Reflections of streets and rooms | M2-EX32 ([D-149](decisions/D-149-reflection-probes.md)) | D-142 |
| Weighted blended transparency | Smoke and fire, and glass: `blending: 'weighted'` | M2-EX33 | D-142, [D-150](decisions/D-150-weighted-blended-transparency.md) |
| Impostors and merged far geometry | Forests, skylines and hills far from the camera | M2-EX34 | D-142 |
| Terrain, an add-on | Battle's hills and Creek's valley | M2-EX35 | D-142 |
| Subsurface and foliage translucency | Sunlit leaves and petals, and characters' ears and hands against the light: `diffuseTransmission` on standard and custom materials. Skin, wax and marble: `subsurfaceRadius` and `subsurfaceColor` on standard materials, a screen-space blur on High and Ultra | M2-EX36 ([D-153](decisions/D-153-subsurface-and-translucency.md)) | D-142 |

The particles demo uses the particles add-on. The showcase and comparison scenes still draw their particles with sprites behind a small interface of their own. Their look pass moves them to the add-on. Motion blur and global illumination come in M3 ([D-132](decisions/D-132-showcase-look-and-features-2026-10-11.md)).

### The order the demos take the features

A demo takes each engine feature as it lands, not all at once. A scene is ready for its look pass when every feature it needs is on main.

- **Creek** takes lit fog, the physical sky, foliage translucency and impostors.
- **Night town** takes screen-space reflections, area lights, reflection probes, decals and automatic exposure.
- **Battle** takes the particles add-on, joint overrides, weighted blended transparency, decals, terrain and the physical sky.
- **Factory**, **forest**, the **campfire glade** and the feature demos take the sky, the exposure and contact shadows where they fit. A surface that suits clearcoat takes it.

The owner reviews each scene's look before its references are remade. Every scene holds the display rate at its preset, as the other demos do.

### Creek

Creek is a small stream in a grassy valley (M2-EX8). The first phase, on 10 October 2026, built everything that code makes, with stand-ins for the organic models. The second phase, on 11 October 2026, put in the trees, the plants and the cave mouth, built by script in Blender. The third phase, the same day, is a beauty pass, after the owner asked for a very beautiful scene. It adds more and denser trees, wildflowers, a deeper cave, wet stones, foam, caustics, things that drift in the air, mist and shafts of light. The owner reviews its look before its pull request opens. The owner approved the look of 21 October 2026: the mountain ring and its gorges with the sun rising and setting down them, the view under the water, the look that blends with the light, the midnight moon, and the grass, leaves and petals without grain.

| Part | How it is made |
| --- | --- |
| Land (`land.ts`) | A grid of 160 m whose quads pack toward the middle, where the camera looks. A height function cuts the stream's bed, the low banks and the valley's sides. Each vertex takes a color from its height and slope: wet bed, mud, soil, dry patches, meadow and bare rock. A tiled texture set from `textures.fromData` adds clods and grit |
| Water (`water.ts`) | A grid at the water's height. Its vertex offset moves it with long waves that the current carries downstream. Its surface function adds finer ripples, which catch the sun as glints. A reflection pass mirrors the banks and the sky, and transmission shows the bed through the water. Caustics play over the bed. The water is clear where it is shallow, and foams at the banks and around the stones, with a trail downstream of each stone |
| Grass (`grass.ts`) | Tufts of 13 curved blades, in three shapes, as instance batches. A vertex offset bends each blade in gusts that roll across the banks. Each row's values give its tuft a phase in the wind, a tint and a turn. The tufts near the water cast shadows and show in the reflection; the others only receive shadows |
| Stones (`stones.ts`) | Rocks of noise-shaped spheres with moss where they face up, and pebbles on the bed, as instance batches with shadows. Rocks in and at the edge of the stream are wet: darker and glossy. The cave mouth is a model |
| Trees, plants and leaves (`flora.ts`) | Seventeen trees of three kinds and sizes, hostas at the water's edge, ferns over the banks and among the cave's boulders, wildflowers in patches, and shrubs at the trees' feet. Each plant kind is one instance batch. Fallen leaves float down the current, and fireflies glow at blue hour and at night |
| Models (`models.ts`) | Loads the three model files of the trees, the plants and the cave mouth, and places their parts. [Sample content](sample-content.md#models-built-in-blender) says how a script builds them |
| Air (`air.ts`) | Leaves that fall from the crowns and spin on the breeze, motes of dust that glow in the low sun, and mist over the water. Each is a sprite batch that the sketch moves from the time alone |
| Shafts (`shafts.ts`) | Rays of light through the trees at golden hour: a custom effect that marches from each pixel toward the sun on the screen |
| Under the water (`underwater.ts`) | While the camera is under the surface, a custom effect makes the view read as seen through flowing water. The current's wobble runs downstream across the picture, caustics play over the bed, and the water swallows the light with distance into its own green. The water's surface draws both faces: from below, the world above shows through a window overhead, and past the window's edge the surface turns some light back down as a faint mirror. Each pixel decides for itself, from where its line of sight leaves the near plane, so a camera half under the water splits the picture at the waterline. The effect is added while the camera is within 0.6 m above the water, since a new effect takes a few frames to start drawing. The Auto route dips under the water for about six seconds as it glides down the stream, through shots that pass the surface on purpose (`through`). `route.test.ts` keeps the dip clear of the bed and the stones (owner, 20 October 2026). |
| Moods (`examples/lib/stage.ts`) | Afternoon, golden hour, blue hour and night from `timeOfDay`, lit by the sky's environment, and a studio lit by the built-in room. A mood can thicken the fog into a haze: golden hour and blue hour do |

**The water code is temporary.** M3-F5's water add-on, `@null3d/water`, takes the Creek's river with its view from under the water. Once it exists, the Creek draws its water through the add-on, and `water.ts` and `underwater.ts` are deleted, so the scene keeps no water code of its own (owner, 20 October 2026, [D-173](decisions/D-173-addon-hooks.md)).

**The plant code and models are temporary.** The vegetation add-on of M3-V4 to M3-V9 grows Creek's trees, ferns, hostas, shrubs, flowers and grass at first use. It places them over the whole valley by ecological rules and moves them all in one wind field. Once it exists, Creek draws its plants through it (M3-V11). Its Blender plant models, their script and their files of about 3.1 MB are deleted. So is the scene's own plant code: `grass.ts`, `models.ts` and the plant parts of `flora.ts`. The floating leaves and the fireflies stay (owner, 24 October 2026, [D-241](decisions/D-241-vegetation-foundation.md)).

The choices, and why:

- **Each tuft's traits are its row's values.** The sketch writes four numbers into each row. They are the tuft's phase in the wind, its tint, and the cosine and sine of its turn about y. The material reads them as `object.values` ([D-127](decisions/D-127-row-values.md)). A vertex offset moves a vertex in the mesh's own space, so a turned tuft would bend another way. So the vertex offset turns the wind back by the tuft's turn, and the wind blows one way over every tuft. Before the row values, the phase and the tint came from the row's place, and the tufts did not turn.
- **The shadows sway with the grass.** A custom material with a vertex offset now casts with its offset ([D-127](decisions/D-127-row-values.md)). The shadow passes read the same values and clock, so the grass's shadows move with it.
- **The organic models load from files.** A script builds them in Blender, and the asset tool optimizes them. They load with `sampleUrl`, as the other demos' files do, so a website's build copies them. The website's build has no server for the sample files, so an import with `?optimized` would not resolve there. So the models go into the sample-assets repository already optimized, each with its KTX2 textures in its own file.
- **The models are light.** The scene draws the cave, 17 trees and about 200 plants: about 290,000 triangles in all, beside 3.4 million of grass. Each tree is a wood part and a part of leaf cards. Each card holds a cluster of leaves, and its alpha cuts their outline.
- **Far trees draw lower levels of detail.** Each tree part in the model file has two lower levels, which the glTF loader reads ([D-137](decisions/D-137-lod-groups.md)). The engine picks a level by its error on the screen, and the shadow passes take coarser levels. So the scene needs no code for them.
- **The cave mouth turns toward the camera's usual view.** The model opens toward +z. Turned 0.9 radians to the left, its opening faces down the valley, so the drifting camera sees into it. Ferns flank the opening.
- **Each tree has its own size, from half to full.** At full size, the crowns of the trees near the camera rose out of the frame, and the view showed bare trunks. Groves of full-size trees stand on the far bank behind the cave, with young trees among them.
- **The things in the air are sprite batches for now.** The particles add-on (M2-EX20) will take them over. Until then, the sketch places each row from the time alone, so a held frame shows what the live scene shows at that time. Sprites are not lit, so each mood tints them. The motes' glow goes into each row's color, because a material's color stops at white and bloom needs it above white.
- **The foam around the stones comes from a map.** Each stone that the water's plane cuts marks a texture of the water. The texture holds how near each point lies to a stone, stretched downstream into a trail. Moving noise in the surface function breaks it into flecks that the current carries.
- **The caustics are light on the bed, in the water's emissive.** The surface function draws a net of bright ridges that drift with the current, bent by the ripples. They are fainter where the water is deep or foams. Each mood sets their color, and blue hour and night have none. The color blends between the moods with the light, so the sun's warm caustics come in through the dawn's twilight.
- **The shafts of light are a custom effect at golden hour alone.** The effect counts the sky that it passes on the way to the sun on the screen, so leaves and trunks break the light into rays. Nothing draws depth in the sky, so the depth tells sky from the rest. The sun sits low down the stream's gorge then, so the rays show. They fade with golden hour's share of the look. They draw at High and above only. Each pixel takes 3 to 12 steps, fewer near the sun, and pixels where the rays are too faint to see take none. The first version took 28 steps in every pixel and doubled the GPU time at golden hour. The engine's own shafts, with the lit fog of M2-EX21, will replace it.
- **Later engine work will change the scene.** Lit fog (M2-EX21) gives the haze and the mist light from the sun, and contact shadows (M2-F12) ground the stones and plants. The scene keeps each part separate, so each can take its change alone.
- **Only the grass near the water is in the reflection and casts shadows.** At first every tuft drew in the camera's view, the reflection and each shadow cascade. The Mac's GPU then drew about 5.1 million triangles a frame on WebGPU, and 7.5 million on WebGL2. Grass far from the water shows in no reflection, and its shadows fall in grass. So those tufts sit on a layer that the reflection pass leaves out, and cast no shadows.
- **The reflection leaves out what lies on or under the water.** The pebbles and the floating leaves sit on the same layer as the far grass. The water's plane would cut them away in the reflection, so drawing them there only cost triangles.
- **Low and Medium draw the reflection every other frame.** The reflection was the costliest pass on WebGL2: without it, the frame drew 6.5 million triangles in place of 9 million. A pass that is switched off keeps its last image, and the camera drifts slowly, so a reflection one frame old looks the same. High and Ultra draw it in every frame.
- **Each preset draws an even spread of the tufts, grouped by place.** The rows come in a random order, so any count spreads over the banks. Then each preset's added rows sort by 4 m squares. WebGL2 culls a static batch in groups of 64 nearby rows, and a random order puts the whole field in every group.
- **The water's depth is a WGSL copy of the land's shape.** The water needs its depth for its thickness, its tint and its foam. No depth texture reaches a surface function, so the shader repeats the bends and widths of the stream from `land.ts`. A change to the stream's shape changes both.
- **The DSLR switch sets a 50 mm lens at f/1.8.** At the scene's view of 45 degrees, a 29 mm lens, the blur of the near grass was a few pixels. The lens focuses on the point that the camera orbits, so the focus follows the user's camera.
- **The night is darker than the preset's exposure.** At the `night` preset's exposure, the grass showed as green as by day under the moon. The night takes 0.55 of it.
- **Blue hour and night have fireflies,** a sprite batch whose colors are above white, so bloom gives them halos.

#### The haze at dusk and golden hour (19 October 2026)

The haze hid the scene at the two low-sun moods. A Dusk picture showed a bright brown veil over the trees, rocks and stream, and the fireflies were the clearest thing in it. Golden hour washed in the same way. Two changes fixed it.

- **The fog follows the sky's mean light as the sun drops.** The physical model took the fog's color from the sky 3 degrees up, averaged all around. At dusk that band holds the sunset's glow, while the rest of the sky has gone dark. The exposure rises to make up for the dark sky. The fog then showed about four times brighter than the sky around it, and hid every shaded surface. The fog now turns from the horizon's color to the sky's mean color over the sun's last ten degrees of height. The analytic model already did this ([D-143](decisions/D-143-physical-sky.md#third-addendum-fog-at-dusk-follows-the-mean-sky-light)). Golden hour, the day and the night keep their fog.
- **The golden hour haze is thinner.** Creek's factor falls from 2.2 to 1.2 of its fog's density, and the showcase Night town gains a factor of 0.7. It is the first haze its stage sets. The near and middle ground keep their texture. On the held frame, the near band's local detail stays the same at dusk and rises at golden hour. The far bank keeps its aerial depth.

On Creek's held frame, the mean luminance of the whole picture fell from 75 to 24 of 255 at Dusk. At golden hour it fell from 61 to 46. The mean of the near band fell from 63 to 15 at dusk. The spread that a one-pixel blur leaves out stayed at 1.3 of 255. At golden hour that spread rose from 1.6 to 2.0. Night town's Dusk lost the cream veil. Its mean fell from 84 to 46. The standard deviation of every band rose, from 24 to 38 in the far pines and from 23 to 39 in the middle. No image test's reference changes. The held demo frames draw the afternoon and the night, whose fog does not change. The physical sky's test sketch sets no fog.

#### Frame rates of the Creek on the Mac

The figures come from Chrome on a Mac with an Apple M5 Max, with the display at 120 Hz. Each figure is five readings of the stats overlay, a second apart, after each mood ran for 8 seconds. The engine chose the preset, with the governor on.

With the trees' levels of detail (M2-I4), WebGL2 at Medium alone, later on 12 October 2026, at a load of 6.3 to 7.7, except where the table gives another. The page ran in a Chrome window of 1,280 by 800 pixels at two device pixels to each, parked past the edge of the display. The window of the earlier runs is not recorded, so compare their triangles, not their frame rates:

| Mood | Default target | `?target-fps=display` |
| --- | --- | --- |
| Afternoon | 105 to 118 fps, GPU 13 to 14.9 ms, scale 1, at a load of 8.5 to 9.7 | 79 to 107 fps, GPU 10.4 to 11.5 ms, scale 0.7 to 0.85 |
| Golden hour | 80 to 100 fps, GPU 13.2 to 13.8 ms, scale 1 | 80 to 109 fps, GPU 11.1 to 13.7 ms, scale 0.7 to 0.85 |
| Blue hour | 80 to 87 fps, GPU 13.1 to 14.4 ms, scale 1 | 80 to 81 fps, GPU 11 to 13.7 ms, scale 0.75 to 0.85, at a load of 9.1 |
| Night | 82 to 100 fps, GPU 14.2 to 16.6 ms, scale 1 | 89 to 119 fps, GPU 11 to 12 ms, scale 0.8 to 0.9 |
| Studio | 80 to 85 fps, GPU 14 to 17.4 ms, scale 1 | 81 to 116 fps, GPU 11 to 11.5 ms, scale 0.7 to 0.85 |

WebGL2 drew 7.1 to 7.35 million triangles a frame, against 7.3 to 7.6 million before the levels. That saving of about 0.25 million, 3%, is what the levels can give here: of the 17 trees, the 10 near the camera keep their full level, and the reflection and the shadow cascades draw the trees too. At the display's rate, the governor was still lowering the render scale when the readings ended. A second run of the two pages at a load of 8 or more, at a load of 5, read slower: 68 to 72 fps with a GPU time of 19 to 25 ms at Afternoon, and 61 to 64 fps at blue hour, where the overlay read the display's rate as 60 Hz in four of five readings. So these figures drift as much as the earlier ones.

With the beauty pass and the reflection trims, on 12 October 2026, at a load of 6.6 to 8.3. The first table keeps the engine's default target of 60 fps. The second sets `?target-fps=display`, so the governor defends 120 fps and lowers the render scale to reach it:

| Mood | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| Afternoon | 120 fps, GPU 5.7 to 5.8 ms | 61 to 64 fps, GPU 15.2 to 17.1 ms, scale 0.7 |
| Golden hour | 78 to 80 fps, GPU 15.2 to 19.4 ms | 60 to 61 fps, GPU 15.1 to 16 ms, scale 0.7 |
| Blue hour | 91 to 92 fps, GPU 14 to 15.7 ms | 48 to 60 fps, GPU 17.4 to 21.6 ms, scale 0.6 to 0.7 |
| Night | 92 to 96 fps, GPU 12.2 to 14.8 ms | 61 to 64 fps, GPU 14.9 to 16.1 ms, scale 0.6 |
| Studio | 111 to 114 fps, GPU 10.3 to 11.7 ms | 60 to 64 fps, GPU 14.3 to 16 ms, scale 0.6 |

| Mood, at the display's rate | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| Afternoon | 118 to 120 fps, scale 0.8 to 0.85 | 59 to 79 fps, scale 0.6 |
| Golden hour | 118 to 120 fps, scale 0.75 | 62 to 70 fps, scale 0.6 |
| Blue hour | 120 fps, scale 0.8 | 61 to 78 fps, scale 0.6 |
| Night | 120 fps, scale 0.85 | 59 to 62 fps, scale 0.6 |
| Studio | 114 to 120 fps, scale 0.85 to 0.9 | 62 to 76 fps, scale 0.6 |

WebGPU drew 4.4 to 4.9 million triangles a frame, and WebGL2 7.3 to 7.6 million. These readings drift: in one run, the same untouched build fell from 120 fps to 80 fps on WebGPU at golden hour, as the Mac warmed and other work ran beside it. So compare readings only within one run. WebGPU at High holds 120 fps in every mood with the render scale at 0.75 or more. WebGL2 at Medium does not reach 120 fps. At a scale of 0.6 its GPU time is still 13.5 to 17 ms, so the pixels are not what costs: the triangles and the passes are. Before the trims, without the reflection, WebGL2 drew 6.5 million triangles in place of 9 million.

With the models and the grass's row values, on 11 October 2026:

| Mood | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| Afternoon | 120 fps, GPU 6.3 to 7.4 ms | 102 to 106 fps, GPU 10.4 to 12.3 ms |
| Golden hour | 120 fps, GPU 6.4 to 6.6 ms | 100 to 102 fps, GPU 11.1 to 12.6 ms |
| Blue hour | 120 fps, GPU 6.4 to 6.6 ms | 94 to 96 fps, GPU 11.3 to 13.7 ms |
| Night | 120 fps, GPU 6.4 to 7.2 ms | 92 to 96 fps, GPU 13.3 to 14.6 ms |
| Studio | 119 to 120 fps, GPU 5.9 to 7.2 ms | 95 to 96 fps, GPU 12.5 to 13.6 ms |

WebGPU drew 3.7 to 4.1 million triangles a frame, and WebGL2 6.4 million. The load was 6 when the WebGPU readings began. Another run then started, and the load reached 18 during the WebGL2 readings, so those are rough.

With the stand-ins, on 10 October 2026, at a load of 3 to 7:

| Mood | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| Afternoon | 120 fps, GPU 5.5 to 5.8 ms | 111 to 120 fps, GPU 7.1 to 13.4 ms |
| Golden hour | 120 fps, GPU 4.8 to 5.4 ms | 120 fps, GPU 6.7 to 7.1 ms |
| Blue hour | 120 fps, GPU 4.8 to 5.9 ms | 96 to 120 fps, GPU 7.7 to 15.2 ms |
| Night | 119 to 120 fps, GPU 6.9 to 7.1 ms | 102 to 116 fps, GPU 9.4 to 13.4 ms |
| Studio | 120 fps, GPU 5.7 to 6.9 ms | 120 fps, GPU 7.0 to 7.8 ms |

Then WebGPU drew 3.4 to 3.8 million triangles a frame, and WebGL2 5.7 million. At first, every tuft drew in the reflection and the shadows. WebGPU at High then drew 5.1 million triangles, and fell to 103 to 108 fps in several readings. Its GPU time reached 13 ms. Those readings ran at a load near 15, so they are rough. WebGL2 at Medium still draws more triangles than WebGPU at High, with fewer tufts. No phone or tablet has run the scene yet. The governor lowers the render scale where a frame takes too long, and phones start on Low, with a fifth of the tufts.

## The demos of the geometry package (M2-P2)

The geometry package and `mesh.updateVertices` brought two demos, and each takes the look of the generators demo.

| Demo and scene | What it shows |
| --- | --- |
| extra-shapes: Mirror floor at dusk | A shape from each function of `@null3d/geometry`, in three rows over a polished stone floor at dusk. A reflection pass mirrors them in the floor. The shapes run from gold, chrome and copper to blue-tinted glass and glazed clay. The flat heart glows enough to bloom |
| vertex-updates: Pool at golden hour | A raised stone pool on a deck. A glowing float with a light of its own drifts over the water, and leaves a ring every 0.35 s on a slow swell. Each frame rewrites the water's heights and normals, and `updateVertices` uploads them |

- The water's normals come from the heights of each vertex's neighbors, not from closed-form slopes. Twelve rings and a swell, each with its own slopes, took more lines than the 150-line limit left.
- The rings start at fixed ticks of sketch time, from the float's path at each tick. So the hold-mode image is the same however many frames lead to it. While the pointer leads the float, each ring starts at the float's place instead.
- The water's update writes into arrays that the sketch keeps, so it allocates nothing in a frame, as the demo's summary says.

## Groups and titles (owner, 9 October 2026)

The owner approved new groups for the demos. In the sidebar's order, they are Showcase, Compare with three.js, Building scenes, Light, materials and effects, Motion and interaction, Scale, and Testing and tools. A group shows only when it has demos. Compare with three.js lists the comparisons of `examples/compare/comparisons.ts`, Factory first, and Showcase waits for its scenes.

| Group | Demos |
| --- | --- |
| Showcase | creek |
| Building scenes | generators, mesh-arrays, extra-shapes, vertex-updates, objects, layers |
| Light, materials and effects | environment, shader-inputs, time-of-day, camera-lens, gltf-model, post-effects, sprites-lines, security-camera |
| Motion and interaction | character, input, walk-and-fly, morph-flowers, picking, math |
| Scale | terrain, galaxy, instances, far-from-origin, large-world |
| Testing and tools | hold-mode |

- Each title names the feature, such as "Instancing" or "Render to texture", and the `scene` field names the scene that shows it, such as "100,000 columns". A reader looks for a feature, and the scene tells the demos apart at a glance.
- The folder names stay as they were. The image tests, the code links and the device plans use them.
- The demos that load files (gltf-model, character and environment) carry a "loads files" tag, from their `assets` field. The gltf-model demo sits with light and materials, since its look is what it shows.

## Decisions of 8 October 2026

The owner decided these points about the examples:

- The separate `null3d-engine/demos-vs-threejs` repository moves into `examples/`, as a tier of comparison demos. It does not stay a self-contained app. Its scenes, its three.js code and its rules move here, and its two character models go to the sample-assets repository. Then the repository is deleted, with the owner's go-ahead at that time. Its measuring tools do not move: `bench/run.ts`, `bench/parity.ts`, `tests/real-browsers.ts` and `bench/readme-media.ts` do that work here.
- One `examples/` folder serves the clone and the website, as above. The website lays the demos out in its own design, so the examples give it data and a way to start each demo, not a page.
- Demos are procedural first, as above.
- The examples page of a clone lists the demos by group in a sidebar, and runs one in a panel beside it, as above. Each pick loads a new page. `startDemo` names no preset, so the engine's start-up check picks one for each device. The sidebar shows no thumbnails: they would need image files, and the website's copy of the folder has none.
- Every demo and comparison shows the engine's stats overlay. The overlay gains memory, triangle, object and GPU-time figures, and a switch on the page. A three.js page prints the same figures in the same layout.
- The comparison tier's speed runs, the ramp and the fixed counts, run with the overlay collapsed in both engines. A collapsed overlay samples nothing, so the headline figures carry no overlay cost. The three.js side uses the same overlay code and the same rule ([D-116](decisions/D-116-stats-overlay-figures.md#the-overlays-layout-and-rules)).
- The demos must show the engine's power, not one call each. The weak feature demos get richer scenes. A showcase tier holds larger scenes from the benchmarks. New demos cover the features that have none.
- The comparison demos show where null3D leads by most, by the figures in [Benchmark results](benchmark-results.md). These are animated crowds (S5's mechanism: 120 against 18 frames per second on the Mac) and deep hierarchies (S2: 3 to 16% of three.js's CPU time). They are also a town with shadows and many lights (S4 and S3). The set is Battle and Factory from the old repository, and a new Night town. The old repository's City is left out: most of its objects stand still, where three.js ties. Swarms of identical boxes are left out too: they are GPU-bound on phones, and the scene code takes most of the frame.
- Each comparison's headline figure is the largest count that each engine holds at the display rate on the viewer's device. A ramp finds it by raising the count. At a fixed count, both engines often hold the display rate, which hides the gap. Before a comparison ships, a device sitting runs its ramp on the Mac, the S24+, a Pixel, the iPad and a WebGL-only iPhone. null3D must hold the higher count on every device class.
- The comparisons have a high-fidelity look: shadows, environment light, fog, bloom, ambient occlusion and grading. Each engine draws each effect with its own best technique for the same intent ([D-52](decisions/D-52-intent-parity.md)). The owner reviews both engines' held frames before a scene ships. This replaces the old repository's rule that an effect stays off until both engines draw it pixel for pixel. Each effect stays a switch, and each device class gets one effect level that both engines use.
- Every demo runs by itself and is always interactive, with no switch. Later in the day, the owner asked for the camera hand-over and the pointer steering that [Always-on interaction](#always-on-interaction) describes.

## The look of the rendering demos

The owner's bar for every feature demo is the reworked generators demo. Eight more demos took a new look on 9 October 2026 (M2-EX9). They are picking, sprites and lines, the large world, the security camera, the glTF model, the character, environment light and post effects. Each stays one sketch under 150 lines that makes its look inline. The three demos that show loading keep their loaded files, and everything around those files is made in code.

| Demo | What it shows now |
| --- | --- |
| picking | Six pieces in glazed, chrome, gold, lacquer, satin and gloss finishes stand on pedestals on a turning plinth in a dark gallery. Three spotlights light them, two of which cast shadows, and the built-in room environment gives the reflections. Hover, click, outline and labels work as before, and a plan on the wall marks each click where it lands |
| sprites-lines | A fountain of sparks at nightfall over a dark pool, inside a stone rim. A reflection pass draws the sparks, the neon helix and the dashed loop in the water, and ripples bend the reflection. The sparks and the lines have colors above white, so bloom spreads them |
| large-world | The drive at golden hour from `timeOfDay`, lit by the sky's environment, with fog that thickens with distance and glows toward the sun. The asphalt, with a white line along each edge, and the grass are textures made in code. Each stretch has its own batch of low hills, 250 to 900 m from the road |
| security-camera | A wet yard at nightfall under a floodlight. The monitor shows the feed as a night camera does: gray, brightened, with scan lines and a band that rolls down, and its panel shows LCD stripes and dead cells up close |
| gltf-model | The BoomBox turns on a turntable in a dark studio. The turntable's polished top mirrors it through a reflection pass. A key light casts its shadow, the room environment gives its reflections, the neutral tone curve keeps its colors true, and depth of field blurs the floor beyond it |
| character | The Knight walks in a courtyard of cobblestones under the afternoon sun. A color map and a normal map made in code shape the stones. Plaster walls stand on three sides, with a stone pillar at each corner |
| environment | The spheres stand over a polished floor that reflects them and the background. The cycle is the sunset from the HDR file, the studio from the EXR file, and the light of the generated sky, in place of the built-in room |
| post-effects | The crates stand at the dead end of a neon alley at night, on wet asphalt that mirrors the neon through screen-space reflections. Depth of field focuses on the outlined crate, an amber bar joins the pink and cyan neon, and a lens grade adds color fringes, an anamorphic streak and grain |

The rules that these demos follow, and why:

- Until 11 October 2026 scene passes and reflection passes drew no point or spot lights ([D-104](decisions/D-104-scene-passes.md#point-and-spot-lights-in-scene-passes-8-october-2026), [D-120](decisions/D-120-planar-reflections.md#what-the-reflection-draws)). So the four demos with a pass, made before then, use only the directional light, the ambient light and the environment. The security camera's floodlight is the directional light, and a glowing lamp on the pole shows where it comes from. The post effects demo moves a point light with the pointer, so its wet ground has no reflection pass. Smooth puddles from a roughness texture shine with the lamps instead.
- A glowing material, a sprite and a line all draw in a reflection pass. The pool in the sprites demo reflects the sparks, the helix and the dashes.
- The `'night'` preset of `timeOfDay` gives a black sky: three.js's sky model goes dark once its sun is 2 degrees under the horizon. So the two night scenes take `'blueHour'`, which gives a deep blue sky and the moon as the main light. They keep their exposure low, 2 and 1.4, below the preset's 2.9. At the preset's exposure, the neon of the sprites demo turned white and lost its colors.
- Fog that thins with height measures its height from the world's origin. The large world's road is 6,378 km above it, so fog with a height falloff would be clear there. The large world uses plain fog, which thickens with distance alone.
- The cobblestones' normal map comes from the slope of each stone's height in closed form, in the same loop as the color. A pass of finite differences over a height array took more lines than the 150-line limit left.
- Picking turns its plinth and its pieces from `time.now`. It used to add `dt` each frame, which made the held frame depend on the frame rate.
- Depth of field draws nothing on the Low preset, which phones start on, as [Post-processing](../docs/api/post.md#depth-of-field) says. The two demos look right without it.
- Some demos make the room or the sky environment, or load large files. Their image tests may take 60 s, as the reworked math, instances and generators demos do.
- The post effects demo took screen-space reflections and the lens grade on 18 October 2026 (M2-EX43, [D-172](decisions/D-172-neon-harbour-follow-ups.md)). Its puddles are almost mirror smooth, so the neon and the crates streak down into the asphalt while the dry ground stays matte. The lens grade adds color fringes, an anamorphic streak on light brighter than white, and grain that changes 24 times a second. The two grading tables moved to `grades.ts` beside the sketch, so the sketch stays under 150 lines, and the demo's code link points at its folder. Against the old pictures the drawn ones differ in 0.39% to 0.43% of their pixels, against the limit of 0.1%. The references moved in both sets. The switch that turns the reflections on for a device that leaves them off lives in `examples/lib/ssr.ts`, which every demo with them shares.
- The security camera demo took the LCD look on 18 October 2026 (M2-EX43, [D-172](decisions/D-172-neon-harbour-follow-ups.md)). The monitor's shader moved to `monitor.ts` beside the sketch. It draws the panel's red, green and blue stripes when the screen is near enough to show them, and a few dead cells. Against the old pictures the drawn ones differ in 0.12% to 0.13% of their pixels, against the limit of 0.1%. The references moved in both sets.
- The area lights demo took screen-space reflections on 18 October 2026 (M2-EX43). Its road is smooth where the puddles lie, so the glowing shop windows, the neon sign and the street around them mirror in it, beside each light's own shaped highlight. The reflections stop at a roughness of 0.35, so the dry asphalt stays matte. Against the old pictures the drawn ones differ in 0.33% to 0.77% of their pixels, against the limit of 0.1%. The references moved in both sets.
- The picking demo gained a clickable plan on its wall on 18 October 2026 (M2-EX43, [D-172](decisions/D-172-neon-harbour-follow-ups.md)). The plan is drawn into a texture from code, with a grid and a square for each click. The sketch turns a click's world point into the plane's own coordinates, so the square lands where the pointer points. The texture changes only when a click adds a mark, so a held frame is the same on every run. The plan lives in `screen.ts` beside the sketch. Against the old pictures the drawn ones differ in 0.56% to 0.72% of their pixels, against the limit of 0.1%. The references moved in both sets.

### Frame rates of the rendering demos on the Mac

The figures come from Chrome on a Mac with an Apple M5 Max, on 9 October 2026. Each demo ran at the preset that the engine chose, with the governor on. The display runs at 120 Hz. Each figure is the stats overlay's reading, 15 seconds after the start, five readings a second apart.

| Demo | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| picking | 120 fps, GPU 4.9 to 5.4 ms | 120 fps, GPU 3.2 to 6.1 ms |
| sprites-lines | 120 fps, GPU 3.8 ms | 120 fps, GPU 3.9 ms |
| large-world | 120 fps, GPU 2.7 ms | 120 fps, GPU 4.7 ms |
| security-camera | 120 fps, GPU 3.3 ms | 120 fps, GPU 4.0 ms |
| gltf-model | 120 fps, GPU 3.6 to 5.3 ms | 120 fps, GPU 4.8 to 12.5 ms |
| character | 120 fps, GPU 4.4 ms | 120 fps, GPU 4.4 ms |
| environment | 120 fps, GPU 2.2 ms | 120 fps, GPU 4.9 ms |
| post-effects | 120 fps, GPU 4.5 to 5.5 ms | 120 fps, GPU 11.7 to 13.5 ms |

On WebGL2, the two demos with depth of field read 10 to 13.5 ms of GPU time, more than one frame at 120 Hz. The overlay still counted 120 fps. Other helpers loaded the Mac during the run, so the WebGL2 timer may count time that the GPU spent on their work. A phone or tablet check at Medium settles it. Depth of field draws nothing on Low.

## The translucency demo (M2-EX36, 12 October 2026)

The translucency demo shows light through thin surfaces ([D-153](decisions/D-153-subsurface-and-translucency.md)): a garden at golden hour with the low sun behind broad leaves and coral tulips, and a paper lantern that glows from the lamp inside it. The leaves, the ground and the plants' places are made in code in `examples/translucency/plants.ts`, so the sketch stays under 150 lines.

The look came from five rounds of screenshots on the Mac, and these points decided it:

- Light through a leaf shows only where the camera sees the side away from the light. The first camera looked down on leaves that faced up, so the sun lit their tops and few leaves glowed. The camera now stands low, under the arching leaves, and looks toward the sun.
- The sun stands to one side of the view. In the middle of the view, its glare and bloom washed out the frame. The demo takes 17:21 of `timeOfDay`, a little higher than its golden hour preset, since a sun 5 degrees up sent too little light through the leaves' undersides.
- The exposure, the fog and the bloom are lower than the other golden hour demos'. At their values, the haze turned the leaves pale and the sky white.
- One leaf texture serves three slots: its color as the base color map, its alpha as the diffuse transmission map, which lets less light through the veins, and so the veins show dark against the sun.
- The lantern's lamp has an intensity of 0.4. Inside a sphere of 0.2 m, a brighter lamp turned the paper white.
- The tulips' petals lean out at most 0.6 radians, so they open as cups. With the leaves' lean, up to 1.05 radians, they lay flat like umbrellas.
- The picking demo's wall plan reads the hit's own texture coordinates on 22 October 2026 (M3-A1). A click's event now carries `uv` and `hasUv`, so the plan marks the square from the hit itself instead of inverting the plane's world matrix and dividing by its size. The held frame draws no mark, so its pictures do not move.
