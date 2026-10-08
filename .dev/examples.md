# Examples

The demos in `examples/` serve two readers. A developer who clones this repository runs them against the packages of the clone. The null3D website shows them on its demo pages, built against the packages from npm. This guide says how one folder serves both, and which files a demo may load. It also records what the owner decided about the examples on 8 October 2026.

## Layout

| Path | Contents |
| --- | --- |
| `examples/demos.ts` | The list of demos. Each entry names its sketch with a literal `new URL('./<name>/sketch.ts', import.meta.url)`, and says why the demo loads files, when it does |
| `examples/lib/run.ts` | `startDemo`, which starts a demo on a canvas that the page gives it, and shows its labels in a layer that the page gives it |
| `examples/index.html`, `examples/index.ts` | The examples page of a clone: one layout of the demos, with the list and a full-window runner for `?demo=<name>` |
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
2. Shows the demos in its own layout. Its pages import `examples/demos.ts`, the list of demos with their titles, summaries, controls and sketches, and `startDemo` from `examples/lib/run.ts`. The website owns the canvas, the text and the styles; the examples page of this repository is not part of it. Code that every layout needs, such as how a demo starts, its labels and later its stats overlay, belongs in `examples/lib/`, not in `examples/index.ts`.
3. Builds its pages with `null3d()` from the plugin, `base: './'`, and `resolve.dedupe` for `@null3d/engine` and `@null3d/controls`. The dedupe matters when the submodule has its own `node_modules`: its workspace links point at packages whose built files are missing. Each entry of the list names its sketch with a literal address, so the build ships every sketch that the website imports.
4. Sets the environment variable `VITE_NULL3D_SAMPLES_BASE` to the folder of the sample files, such as `./samples/`, and copies them there with `copyNamedSamples` from `tools/lib/samples.ts`, which copies every file that the demos name.
5. Sends the isolation headers, for example with a Cloudflare Pages `_headers` file, as [hosting](../docs/getting-started/hosting.md) says.

Until the first npm release, the website builds the engine from the submodule instead: `bun install` and `bun run build` in the submodule, then the same config with the repository's `sourceResolve`.

`bun run test:packages` checks this path in CI. After its fresh project passes, it copies `examples/` into the project, where a submodule would sit. Beside it, it writes a page of its own layout that imports only the list and `startDemo`, and builds that page against the packed tarballs, with `VITE_NULL3D_SAMPLES_BASE` set. Then the instances and security camera demos must start from the build. Those two make their content in code, so the check needs no sample files.

## Procedural first

A demo makes its meshes, textures, environments and grading tables in code. It loads files only when loading them is what it shows, or when a comparison shows both engines handling the same files. The demo's entry gives the reason in its `assets` field. `tests/lib/images.test.ts` fails when a sketch loads a file and its entry gives no reason. It also fails when an entry gives a reason and the sketch loads nothing. A sketch loads a file when it calls `sampleUrl`, an `assets.load` function or `assets.preload`.

The reasons are:

- Content made in code shows what the engine draws, at any scale, with no download. It keeps each demo self-contained, and the website ships no large files for it.
- Loading still needs demos of its own: developers load glTF models, HDR environments, KTX2 textures and grading tables, and a comparison with three.js must show both engines loading the same files.

Demos load sample files through `sampleUrl('<path>')` from `examples/lib/samples.ts`, with a string literal, so the sample check and `copyNamedSamples` find each file.

## Always-on interaction

Every demo runs by itself, and takes the user's input at any moment. There is no switch between a tour and free control. `interact(ctx, camera, options)` from `examples/lib/interact.ts` holds the shared code. It gives the demo's camera orbit controls, and it gives a demo with something to lead a point that the pointer steers. Each demo's `controls` text in `examples/demos.ts` says how to interact with it.

The rules:

- Every demo's camera has the orbit controls of `@null3d/controls`. The demo's own camera motion runs until the user's first camera gesture. That is a drag with any button or with one finger, the wheel, a trackpad pinch, or two fingers. A drag counts once it moves past the engine's click limit: 2 CSS pixels for a mouse, 10 for a finger. From then on, the user owns the camera for the rest of the visit, and the scene goes on moving.
- The hand-over does not jump. Until the hand-over, the controls' target follows the point that the scripted camera looks at. At the hand-over frame, the controls read the camera where the script left it, and orbit that point. The scripted camera must stay inside the controls' polar and distance limits, or the first update moves it onto them. The security camera demo's camera once stood 10 cm below its target, under a limit that keeps it above. The old controls lifted it as they started, so its held frame showed the lifted pose. The demo now places the camera there itself.
- A demo with something to lead names a plane: `groundY` for a level plane, or `planeZ` for an upright plane that faces the camera. The `bounds` option keeps the point in a box. The `surfaces` option points at the scene's surfaces through a raycast first. A mouse steers by hovering with no button held, since a drag turns the camera. A finger steers by a tap, since a one-finger drag turns the camera. A click steers too.
- `steer(value)` moves the demo's scripted value toward the point, by a weight that eases from 0 to 1. The engine has no signal for a pointer that leaves the canvas. So after 3 seconds with no pointer movement, the weight eases back to 0, and the object goes back to its scripted path.
- Hold mode draws the same frame. No input reaches a held frame, and the helper then moves nothing. The controls turn the camera toward their target as they start, so the helper puts the camera back where the sketch had it. The controls' update runs only after the hand-over, or while they turn the camera by themselves. A weight of 0 gives the scripted value bit for bit. `examples/lib/interact.test.ts` checks these points, and the demos' image tests check the held frames.
- The user can look at a demo from any side. So a flat or open surface that the camera can get behind or below draws both faces, with `doubleSided: true`. These are the flat generator shapes, the height field, and the grounds of the character and security camera demos. A pan can take the camera under a ground even when the orbit limits keep it above the target.
- No two faces that point the same way share a plane, or they flicker as the view moves. A wall stands on its floor, not beside its edge, and a back wall fits between its side walls. The render layers demo's walls and the post effects demo's side wall had such faces, and the owner saw them shimmer on 8 October 2026.
- A demo imports only the engine, `@null3d/controls`, `../lib/interact` and `../lib/samples`. Scripted motion reads `time.now`, as [Image tests](image-tests.md#the-feature-demos) asks. A camera that follows a moving object moves in `onLateUpdate`.

What the pointer steers in each demo:

| Demo | The pointer steers |
| --- | --- |
| math | The light that the drones chase, on the plane at the light's mean height, inside the room |
| character | The Knight, which walks to the pointed point. Its speed, and so its blend of clips, comes from the distance left |
| sprites-lines | The fountain. Each spark keeps the place it was born at, so the fountain does not slide |
| instances | The center of the wave |
| mesh-arrays | The crystal, which hovers over the point of the hills that a raycast finds |
| post-effects | The pink lamp, so the bloom and the shading move |
| hold-mode | A paddle that shows only while the pointer steers it, and kicks the balls on it up |
| security-camera | The security camera, which aims at the pointed point of the yard |
| generators | The shapes, which turn toward the point on a plane in front of them |
| input | Nothing: the keys, a gamepad and the camera gestures drive it. The right stick turns the camera before and after the hand-over |
| The others | Nothing: the camera only. Picking keeps its hover and its click, and the engine gives no click after a drag of more than 2 CSS pixels |

Two demos need more than the shared rules:

- In far-from-origin, orbit controls work in the camera's parent space, and assume a parent that does not turn, as `lookAt` does. The camera used to ride a turning rig. Now the script turns the camera itself, with the same position and the same turn that the rig gave it. The controls' target is the point on the tray where the camera's view meets it.
- In large-world, the user's camera orbits a point 12 m ahead of the car. The point is on the car's line of sight, so the hand-over keeps the view. That point drives on, and the helper's `shift` moves the camera with it. The target is a plain array, which keeps 64-bit precision 6,378 km from the origin.

Why it works this way:

- The owner asked on 8 October 2026 for demos that run by themselves and answer the user at once, with no switch. A switch hides the controls from a visitor who never finds it. A tour that the user cannot stop feels broken.
- The hand-over at the first gesture serves both visitors. A visitor who only watches sees the tour. A visitor who reaches for the camera gets it at once. The tour does not come back, since a camera that moves while the user looks at something is worse than one that stays.
- The controls start with the demo, not at the first gesture. Controls ignore a button that is already down when they start, so controls made at the first press would ignore the whole first drag.
- Hover steers, not a drag, because a drag already turns the camera. On a touch screen, a tap is the only gesture that a drag does not take.
- The weight eases back after an idle time because the sketch cannot see a pointer leave the canvas. Without it, the last pointed point would hold the object for the rest of the visit.

## Decisions of 8 October 2026

The owner decided these points about the examples:

- The separate `null3d-engine/demos-vs-threejs` repository moves into `examples/`, as a tier of comparison demos. It does not stay a self-contained app. Its scenes, its three.js code and its rules move here, and its two character models go to the sample-assets repository. Then the repository is deleted, with the owner's go-ahead at that time. Its measuring tools do not move: `bench/run.ts`, `bench/parity.ts`, `tests/real-browsers.ts` and `bench/readme-media.ts` do that work here.
- One `examples/` folder serves the clone and the website, as above. The website lays the demos out in its own design, so the examples give it data and a way to start each demo, not a page.
- Demos are procedural first, as above.
- Every demo and comparison shows the engine's stats overlay. The overlay gains memory, triangle, object, main-thread and GPU-time figures, and a switch on the page. A three.js page prints the same figures in the same layout.
- The demos must show the engine's power, not one call each. The weak feature demos get richer scenes. A showcase tier holds larger scenes from the benchmarks. New demos cover the features that have none.
- The comparison demos show where null3D leads by most, by the figures in [Benchmark results](benchmark-results.md). These are animated crowds (S5's mechanism: 120 against 18 frames per second on the Mac) and deep hierarchies (S2: 3 to 16% of three.js's CPU time). They are also a town with shadows and many lights (S4 and S3), and a page that stays responsive beside a heavy scene. The set is Battle and Factory from the old repository, a new Night town, and a Busy page. The old repository's City is left out: most of its objects stand still, where three.js ties. Swarms of identical boxes are left out too: they are GPU-bound on phones, and the scene code takes most of the frame.
- Each comparison's headline figure is the largest count that each engine holds at the display rate on the viewer's device. A ramp finds it by raising the count. At a fixed count, both engines often hold the display rate, which hides the gap. Before a comparison ships, a device sitting runs its ramp on the Mac, the S24+, a Pixel, the iPad and a WebGL-only iPhone. null3D must hold the higher count on every device class.
- The comparisons have a high-fidelity look: shadows, environment light, fog, bloom, ambient occlusion and grading. Each engine draws each effect with its own best technique for the same intent ([D-52](decisions/D-52-intent-parity.md)). The owner reviews both engines' held frames before a scene ships. This replaces the old repository's rule that an effect stays off until both engines draw it pixel for pixel. Each effect stays a switch, and each device class gets one effect level that both engines use.
- Every demo runs by itself and is always interactive, with no switch. Later in the day, the owner asked for the camera hand-over and the pointer steering that [Always-on interaction](#always-on-interaction) describes.
