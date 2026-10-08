# Examples

The demos in `examples/` serve two readers. A developer who clones this repository runs them against the packages of the clone. The null3D website shows them on its demo pages, built against the packages from npm. This guide says how one folder serves both, and which files a demo may load. It also records what the owner decided about the examples on 8 October 2026.

## Layout

| Path | Contents |
| --- | --- |
| `examples/demos.ts` | The list of demos and their groups, in `DEMO_GROUPS` order. Each entry names its group and its sketch, with a literal `new URL('./<name>/sketch.ts', import.meta.url)`, and says why the demo loads files, when it does |
| `examples/lib/run.ts` | `startDemo`, which starts a demo on a canvas that the page gives it, and shows its labels in a layer that the page gives it |
| `examples/lib/source.ts` | `sourceUrl`, the GitHub address of a demo's code, for a "View code" link ([below](#the-link-to-a-demos-code)) |
| `examples/index.html`, `examples/index.ts` | The examples page of a clone: a sidebar of the demos by group, and a panel that runs the demo that `?demo=<name>` names ([below](#the-examples-page-of-a-clone)) |
| `examples/<name>/sketch.ts` | One demo, under 150 lines |
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
2. Shows the demos in its own layout. Its pages import `examples/demos.ts`, the list of demos with their groups, titles, summaries, controls and sketches, and `startDemo` from `examples/lib/run.ts`. It links each demo to its code with `sourceUrl` from `examples/lib/source.ts`, at the release tag that it builds from. The website owns the canvas, the text and the styles; the examples page of this repository is not part of it. Code that every layout needs, such as how a demo starts, its labels and later its stats overlay, belongs in `examples/lib/`, not in `examples/index.ts`.
3. Builds its pages with `null3d()` from the plugin, `base: './'`, and `resolve.dedupe` for `@null3d/engine` and `@null3d/controls`. The dedupe matters when the submodule has its own `node_modules`: its workspace links point at packages whose built files are missing. Each entry of the list names its sketch with a literal address, so the build ships every sketch that the website imports.
4. Sets the environment variable `VITE_NULL3D_SAMPLES_BASE` to the folder of the sample files, such as `./samples/`, and copies them there with `copyNamedSamples` from `tools/lib/samples.ts`, which copies every file that the demos name.
5. Sends the isolation headers, for example with a Cloudflare Pages `_headers` file, as [hosting](../docs/getting-started/hosting.md) says.

Until the first npm release, the website builds the engine from the submodule instead: `bun install` and `bun run build` in the submodule, then the same config with the repository's `sourceResolve`.

`bun run test:packages` checks this path in CI. After its fresh project passes, it copies `examples/` into the project, where a submodule would sit. Beside it, it writes a page of its own layout that imports only the list and `startDemo`, and builds that page against the packed tarballs, with `VITE_NULL3D_SAMPLES_BASE` set. Then the instances and security camera demos must start from the build. Those two make their content in code, so the check needs no sample files.

## The examples page of a clone

The examples page is the clone's own layout of the demos. The website has a layout of its own and does not use this page.

- In a wide window, a sidebar at the left lists the demos by group. The groups come in the order of `DEMO_GROUPS` in `examples/demos.ts`, and a group with no demos does not show. The panel at the right runs the demo that `?demo=<name>` names. Its canvas fills the panel. A caption at the top left gives the demo's title, its summary and how to steer it.
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

In hold mode the engine runs no check, and the preset follows the device's kind. The image tests do not use `startDemo`. The manifest draws each demo's sketch through the test pages, so the examples page does not change their images.

## Procedural first

A demo makes its meshes, textures, environments and grading tables in code. It loads files only when loading them is what it shows, or when a comparison shows both engines handling the same files. The demo's entry gives the reason in its `assets` field. `tests/lib/images.test.ts` fails when a sketch loads a file and its entry gives no reason. It also fails when an entry gives a reason and the sketch loads nothing. A sketch loads a file when it calls `sampleUrl`, an `assets.load` function or `assets.preload`.

The reasons are:

- Content made in code shows what the engine draws, at any scale, with no download. It keeps each demo self-contained, and the website ships no large files for it.
- Loading still needs demos of its own: developers load glTF models, HDR environments, KTX2 textures and grading tables, and a comparison with three.js must show both engines loading the same files.

Demos load sample files through `sampleUrl('<path>')` from `examples/lib/samples.ts`, with a string literal, so the sample check and `copyNamedSamples` find each file.

## Decisions of 8 October 2026

The owner decided these points about the examples:

- The separate `null3d-engine/demos-vs-threejs` repository moves into `examples/`, as a tier of comparison demos. It does not stay a self-contained app. Its scenes, its three.js code and its rules move here, and its two character models go to the sample-assets repository. Then the repository is deleted, with the owner's go-ahead at that time. Its measuring tools do not move: `bench/run.ts`, `bench/parity.ts`, `tests/real-browsers.ts` and `bench/readme-media.ts` do that work here.
- One `examples/` folder serves the clone and the website, as above. The website lays the demos out in its own design, so the examples give it data and a way to start each demo, not a page.
- Demos are procedural first, as above.
- The examples page of a clone lists the demos by group in a sidebar, and runs one in a panel beside it, as above. Each pick loads a new page. `startDemo` names no preset, so the engine's start-up check picks one for each device. The sidebar shows no thumbnails: they would need image files, and the website's copy of the folder has none.
- Every demo and comparison shows the engine's stats overlay. The overlay gains memory, triangle, object, main-thread and GPU-time figures, and a switch on the page. A three.js page prints the same figures in the same layout.
- The demos must show the engine's power, not one call each. The weak feature demos get richer scenes. A showcase tier holds larger scenes from the benchmarks. New demos cover the features that have none.
- The comparison demos show where null3D leads by most, by the figures in [Benchmark results](benchmark-results.md). These are animated crowds (S5's mechanism: 120 against 18 frames per second on the Mac) and deep hierarchies (S2: 3 to 16% of three.js's CPU time). They are also a town with shadows and many lights (S4 and S3), and a page that stays responsive beside a heavy scene. The set is Battle and Factory from the old repository, a new Night town, and a Busy page. The old repository's City is left out: most of its objects stand still, where three.js ties. Swarms of identical boxes are left out too: they are GPU-bound on phones, and the scene code takes most of the frame.
- Each comparison's headline figure is the largest count that each engine holds at the display rate on the viewer's device. A ramp finds it by raising the count. At a fixed count, both engines often hold the display rate, which hides the gap. Before a comparison ships, a device sitting runs its ramp on the Mac, the S24+, a Pixel, the iPad and a WebGL-only iPhone. null3D must hold the higher count on every device class.
- The comparisons have a high-fidelity look: shadows, environment light, fog, bloom, ambient occlusion and grading. Each engine draws each effect with its own best technique for the same intent ([D-52](decisions/D-52-intent-parity.md)). The owner reviews both engines' held frames before a scene ships. This replaces the old repository's rule that an effect stays off until both engines draw it pixel for pixel. Each effect stays a switch, and each device class gets one effect level that both engines use.
