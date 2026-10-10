# Examples

The demos in `examples/` serve two readers. A developer who clones this repository runs them against the packages of the clone. The null3D website shows them on its demo pages, built against the packages from npm. This guide says how one folder serves both, and which files a demo may load. It also records what the owner decided about the examples on 8 October 2026.

## Layout

| Path | Contents |
| --- | --- |
| `examples/demos.ts` | The list of demos and their groups, in `DEMO_GROUPS` order. Each entry names its group and its sketch, with a literal `new URL('./<name>/sketch.ts', import.meta.url)`, and says why the demo loads files, when it does |
| `examples/lib/run.ts` | `startDemo`, which starts a demo on a canvas that the page gives it, shows its labels in a layer that the page gives it, and shows the stats overlay |
| `examples/lib/source.ts` | `sourceUrl`, the GitHub address of a demo's code, for a "View code" link ([below](#the-link-to-a-demos-code)) |
| `examples/index.html`, `examples/index.ts` | The examples page of a clone: a sidebar of the demos by group, and a panel that runs the demo that `?demo=<name>` names ([below](#the-examples-page-of-a-clone)) |
| `examples/<name>/sketch.ts` | One demo, under 150 lines |
| `examples/lib/interact.ts` | `interact`, which gives a demo's camera orbit controls and lets the pointer steer the demo ([Always-on interaction](#always-on-interaction)) |
| `examples/lib/` | Code that several demos share, such as `sampleUrl` |
| `examples/vite.build.config.ts` | The production build of the page against this checkout's packages |

The image tests, the device plans and the page tests read `examples/demos.ts` and the `examples/<name>/sketch.ts` paths ([Image tests](image-tests.md)). A folder under `examples/` that holds a `sketch.ts` must be a demo in the list.

## Two builds from one folder

The examples page links only by relative addresses, and each demo's entry names its sketch with a literal address. The null3D Vite plugin ships a sketch when it finds `new URL('./x.ts', import.meta.url)` in a module, so a production build of the page holds every sketch, under any address prefix. A sketch address that code builds at run time, such as one from `location.origin`, does not ship.

### From a clone

- `bun run dev` serves the page at `/examples/` with the other test and benchmark pages.
- `bun run examples:build` builds the page and every demo into `target/examples/`, against this checkout's packages, with the engine's address switches on. `bun run examples:preview` serves that build with the isolation headers and the sample files. Run `bun run build` first, for the WebAssembly files.
- The demos that load files need `bun run samples:fetch` once on a new machine ([Sample content](sample-content.md)).

### On the website

The website's repository holds this repository as a git submodule, pinned to the release tag that matches the `@null3d/engine` version it installs. Its build:

1. Installs `@null3d/engine`, `@null3d/controls` and `@null3d/vite-plugin` from npm, and never lists the submodule as a workspace, whose `workspace:*` versions would break.
2. Shows the demos in its own layout. Its pages import `examples/demos.ts`, the list of demos with their groups, titles, scenes, summaries, controls and sketches, and `startDemo` from `examples/lib/run.ts`. A page shows each demo's `scene` after its title, as in "Instancing · 100,000 columns". It marks a demo with an `assets` field as one that loads files. It links each demo to its code with `sourceUrl` from `examples/lib/source.ts`, at the release tag that it builds from. The website owns the canvas, the text and the styles; the examples page of this repository is not part of it. Code that every layout needs, such as how a demo starts, its labels and its stats overlay, belongs in `examples/lib/`, not in `examples/index.ts`.
3. Builds its pages with `null3d()` from the plugin, `base: './'`, and `resolve.dedupe` for `@null3d/engine` and `@null3d/controls`. The dedupe matters when the submodule has its own `node_modules`: its workspace links point at packages whose built files are missing. Each entry of the list names its sketch with a literal address, so the build ships every sketch that the website imports.
4. Sets the environment variable `VITE_NULL3D_SAMPLES_BASE` to the folder of the sample files, such as `./samples/`, and copies them there with `copyNamedSamples` from `tools/lib/samples.ts`, which copies every file that the demos name.
5. Sends the isolation headers, for example with a Cloudflare Pages `_headers` file, as [hosting](../docs/getting-started/hosting.md) says.

Until the first npm release, the website builds the engine from the submodule instead: `bun install` and `bun run build` in the submodule, then the same config with the repository's `sourceResolve`.

`bun run test:packages` checks this path in CI. After its fresh project passes, it copies `examples/` into the project, where a submodule would sit. Beside it, it writes a page of its own layout that imports only the list and `startDemo`, and builds that page against the packed tarballs, with `VITE_NULL3D_SAMPLES_BASE` set. Then the instances and security camera demos must start from the build. Those two make their content in code, so the check needs no sample files.

## The examples page of a clone

The examples page is the clone's own layout of the demos. The website has a layout of its own and does not use this page.

- In a wide window, a sidebar at the left lists the demos by group. The groups come in the order of `DEMO_GROUPS` in `examples/demos.ts`, and a group with no demos does not show. Each link gives the demo's title and its scene, and a small "loads files" tag marks a demo with an `assets` field. The panel at the right runs the demo that `?demo=<name>` names. Its canvas fills the panel. A caption at the top left gives the demo's title and scene, its summary and how to steer it.
- In a window narrower than 768 CSS pixels, the sidebar is a drawer. A menu button in a bar at the top opens it. The drawer slides in below the bar, so the same button closes it. Escape, a tap beside the drawer and a pick close it too. The caption starts folded to its title there, to leave the canvas clear.
- Without `?demo=`, the panel shows a short welcome and starts no engine. A page that ran a demo at once would start an engine on every visit, before the reader picks one.
- A small link in the caption opens the demo's held frame (`?hold=<time>`). The held page links back to the live demo. Beside it, "View code" opens the demo's code on the main branch in a new tab.
- The sidebar is a `nav` landmark, and the running demo's link has `aria-current="page"`. The menu button reports the drawer's state with `aria-expanded`. Opening the drawer moves the focus to the running demo's link and makes the panel inert. Closing it with Escape or a tap beside it returns the focus to the button.

### The link to a demo's code

`sourceUrl(demo, ref)` gives the GitHub address of a demo's code at a branch or a tag, and `ref` is `main` when a page names none. The clone's page names none. The website names the release tag that it builds from, so its link shows the code that it runs.

- A demo of one file links to that file: `blob/<ref>/examples/<name>/sketch.ts`. Every feature demo is one sketch, so the reader lands on the code at once.
- A demo of several files links to its folder: `tree/<ref>/examples/<path>/`. One file would show only part of the demo, and the folder lists every part. Such a demo sets its `code` field to its folder, with a slash at the end, such as `showcase/city/`. A demo of one file outside `<name>/sketch.ts` sets `code` to that file.

The address comes from the demo's entry, not from its `sketch` field. A build gives each sketch a hashed address of its own. `REPOSITORY_URL` in the same module holds the repository's address. A unit test checks it against the `repository` field of the root `package.json`.

### Each pick is a new page

Each link loads `?demo=<name>` as a new page. The page does not swap engines in place. A new page drops the last engine with its workers and its shared memory. Safari reserves address space for the whole maximum of each engine's shared memory, and an iPad page holds about 6 engines ([D-04](decisions/D-04-memory-maximum.md)). Safari also frees a dropped memory late ([D-98](decisions/D-98-memory-pool.md)). So a page that started a new engine for each pick could fail after a few picks on an iPad. A new page also clears whatever a demo left on the page, such as its labels and its listeners.

### Engine settings of the demos

`startDemo` names no quality preset, and leaves the frame-budget governor on, as every preset has it. The engine then picks the preset for each device. It starts from the device's kind: High on a desktop, Medium on a tablet and Low on a phone. It caps that at Medium on WebGL2 and in WebGPU's compatibility mode. Then its start-up check lowers the preset until one holds the frame rate, and keeps the result for the next visit.

A page that names a preset skips that check. A phone would then start at High, and stutter and heat until the governor stepped down. The check already gives High on desktops with a strong GPU, where the richer look matters. The `?preset=` switch still fixes a preset, to try another one.

`startDemo` shows the engine's stats overlay through the engine's `stats` option, so the examples page and the website both show it. It sits over the canvas's top-right corner, as it always does, collapsed to its frame rate. The caption sits at the top left, so the two stay apart. The examples page keeps the caption's width clear of the collapsed overlay, and hides the overlay while the phone's drawer is open. A page passes `stats: false` to leave it off. A visitor adds `?stats=off` to the address to hide it, or `?stats=open` to open the card. A click on the frame rate opens the card: each thread's CPU time and the GPU time against the target, memory, and the counts. Collapsed, the overlay costs nothing more than a page without it. While the card is open, the engine times one frame in eleven on the GPU. It also reads back the counts of the objects that the GPU culls. That costs a little GPU time and a few small objects on those frames ([D-116](decisions/D-116-stats-overlay-figures.md)). A held frame never shows the overlay, so the held frames match the image tests.

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
- A demo imports only the engine, `@null3d/controls`, `../lib/interact` and `../lib/samples`. Scripted motion reads `time.now`, as [Image tests](image-tests.md#the-feature-demos) asks. A camera that follows a moving object moves in `onLateUpdate`.

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
| time-of-day | The hour: the pointer's place across an upright plane through the lighthouse, from 4:00 at the left to 20:00 at the right |
| camera-lens | The focus, on the point of a piece or the board that a raycast finds |
| morph-flowers | The tulips near the pointed point, which open |
| input | Nothing: the keys, a gamepad and the camera gestures drive it. The right stick turns the camera before and after the hand-over |
| walk-and-fly | Nothing: the keys, the drag and the locked mouse drive first-person and fly controls |
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
| instances | 100,489 columns (317 on each side) in one batch at golden hour, and 10,201 on the Low preset of phones. The sky lights the columns through `assets.skyEnvironment()`. A lamp, which blooms, hovers over the center of the wave and lights the columns around it |
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
- The instances demo takes its count of columns from a table by preset. `quality.onChange` sets the batch's active count again when the preset changes. The setup places the rows ring by ring from the middle out. So the first rows of any count fill a square in the middle of the field. Low draws 10,201 rows, the old demo's count, and the other presets draw all 100,489. The Mac held the full field at 120 fps on both GPU paths. No phone has run it yet.
- The demos' interaction test (`tests/image/demo-interaction.spec.ts`) opens the math and instances demos on the Low preset. It checks the camera and the steering, not the look. On SwiftShader on the Mac, the full look took the instances test from 11.4 s to 25 to 30 s. The math test took 17 s. In CI, main's instances test already took 44.6 s of its 60 s, about four times its time on the Mac. On Low, the two tests took 7 to 10 s and 12 s on the Mac. With a quarter of the field on Low, the instances test took 14 s. That is too close to the limit in CI.
- The three demos make the room environment, which takes time on a software GPU. On SwiftShader on the Mac their held frames took 6 to 15 s, four tests at once. So their image tests take 60 s, as the other demos with the room environment do, since CI's machines are slower.

### Frame rates on the Mac

The figures come from Chrome 155 on a Mac with an Apple M5 Max, on 9 October 2026. Each demo ran at the preset that the engine chose, with the governor on. The math figures are from its third version, and the instances figures from its second, each measured after the owner's review. The display runs at 120 Hz. Each figure is the stats overlay's reading, 15 seconds after the start, over 5 seconds.

| Demo | WebGPU, High | WebGL2, Medium |
| --- | --- | --- |
| math | 120 fps, GPU 5.1 to 5.6 ms, sketch 0.4 to 0.5 ms, 300 drone lights | 120 fps, GPU 5.6 to 6.6 ms, sketch 0.5 to 0.6 ms |
| instances | 120 fps, GPU 4.2 to 4.8 ms, sketch 1.0 to 1.6 ms, 1.25 million triangles | 120 fps, GPU 3.0 to 5.4 ms, sketch 0.9 to 1.7 ms |
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
- The objects demo's fog uses the `exp2` curve. Exponential fog that hid the edge of the stage 100 m away also dimmed the crates 9 m away by a third. With `exp2`, the crates take 7% of the fog's color and the edge almost all of it.
- The mesh arrays demo has a reflection pass, so its light comes from the sun and the sky only. Scene passes draw no point or spot lights yet ([D-104](decisions/D-104-scene-passes.md#m2-limits-and-the-follow-up-task)). So the crystal's glow comes from bloom, not from a lamp.
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
- The lighthouse's beams are open cones with a custom material: added light that fades from the lamp outward and toward the cone's edges. The material's base color is black, so the sun lights nothing on them.
- The depth of field demo works at the real size of a chess board, in metres, because the blur follows a real lens. At f/1.8 and 85 mm, a few centimetres out of focus blur well. Low draws no depth of field, so the demo sets `dofSamples` to 16 there, again after each change of preset. Its aperture has six blades, so the string lights' discs show soft hexagon corners. Their blur reaches about 12 texels of the half-size image, so the gather's soft edge rounds the corners off. A largest blur of 0.05, not 0.03, made sharper corners, but spread the taps so far apart that the discs and the near pieces turned grainy.
- A points batch has no transform, so the galaxy turns by writing its positions. It splits the stars into 48 rings, works out one cosine and one sine per ring, and turns each star by its ring's pair. The rings sway ahead and back around a slow turn of the whole galaxy. A turn that differed by ring for ever would wind the arms up into rings within a minute. The batch is dynamic, so it uploads every star in every frame.
- The tulips' normals come from each petal's slopes, worked out from nearby points in both poses. The morph target holds the change of each normal, as it holds the change of each position and color.
- The walk and fly demo has no orbit controls: its controls are the feature it shows ([Always-on interaction](#always-on-interaction)).
- The demos' sketches stay under 150 lines with plain number arrays for their tables, such as each chess piece's parts. The formatter puts each array of arrays on many lines.

## Showcase scenes

The showcase tier holds a few large scenes that show the engine at its best, as the best three.js scenes that people share do. The reference is "Cozy creek", a three.js scene shared on 8 October 2026. It has clear water over a stony bed, dense grass and plants with soft shadows, and rocks and a cave. It also has time-of-day presets and a depth-of-field switch.

- **No line limit:** a showcase scene is not a feature demo, so the 150-line limit does not apply. It lives in `examples/showcase/<name>/`, and its code link points to the folder.
- **Shared code:** the showcase scenes share a stage (`examples/lib/stage.ts`: moods and times of day) and generators of detail (`examples/lib/procedural.ts`: textures made in code, terrain, rocks, grass).
- **Models:** terrain, stones, grass and water are made in code. Trees, plants and other organic hero models are built by script in Blender, and live in the sample-assets repository. A showcase scene's `assets` field says so.
- **Interaction:** a showcase scene takes the same interaction as the other demos: the camera, and the pointer that leads.
- **Engine features first:** each scene waits for the engine features it needs. The owner moved them before 1.0 ([D-117](decisions/D-117-showcase-features-before-1-0.md)):
  - per-row values in instance batches;
  - environment light from the sky, with time of day;
  - planar reflections, transmission and depth of field;
  - a temporal anti-aliasing prototype.

  Batch shadows come from M2-R6.
- **The first scene is Creek.** A forest at dawn, a seaside cove and a night town may follow.

## Groups and titles (owner, 9 October 2026)

The owner approved new groups for the demos. In the sidebar's order, they are Showcase, Compare with three.js, Building scenes, Light, materials and effects, Motion and interaction, Scale, and Testing and tools. A group shows only when it has demos, so the first two wait for their scenes.

| Group | Demos |
| --- | --- |
| Building scenes | generators, mesh-arrays, objects, layers |
| Light, materials and effects | environment, time-of-day, camera-lens, gltf-model, post-effects, sprites-lines, security-camera |
| Motion and interaction | character, input, walk-and-fly, morph-flowers, picking, math |
| Scale | galaxy, instances, far-from-origin, large-world |
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
- The comparison demos show where null3D leads by most, by the figures in [Benchmark results](benchmark-results.md). These are animated crowds (S5's mechanism: 120 against 18 frames per second on the Mac) and deep hierarchies (S2: 3 to 16% of three.js's CPU time). They are also a town with shadows and many lights (S4 and S3), and a page that stays responsive beside a heavy scene. The set is Battle and Factory from the old repository, a new Night town, and a Busy page. The old repository's City is left out: most of its objects stand still, where three.js ties. Swarms of identical boxes are left out too: they are GPU-bound on phones, and the scene code takes most of the frame.
- Each comparison's headline figure is the largest count that each engine holds at the display rate on the viewer's device. A ramp finds it by raising the count. At a fixed count, both engines often hold the display rate, which hides the gap. Before a comparison ships, a device sitting runs its ramp on the Mac, the S24+, a Pixel, the iPad and a WebGL-only iPhone. null3D must hold the higher count on every device class.
- The comparisons have a high-fidelity look: shadows, environment light, fog, bloom, ambient occlusion and grading. Each engine draws each effect with its own best technique for the same intent ([D-52](decisions/D-52-intent-parity.md)). The owner reviews both engines' held frames before a scene ships. This replaces the old repository's rule that an effect stays off until both engines draw it pixel for pixel. Each effect stays a switch, and each device class gets one effect level that both engines use.
- Every demo runs by itself and is always interactive, with no switch. Later in the day, the owner asked for the camera hand-over and the pointer steering that [Always-on interaction](#always-on-interaction) describes.
