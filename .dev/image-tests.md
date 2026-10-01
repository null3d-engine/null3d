# Image tests

This guide covers the image test manifest, its references, and the review that makes a new image a reference. [AGENTS.md](../AGENTS.md) lists the commands, and [Device sessions](devices.md) covers the runs on phones, tablets and the Mac's browser apps.

## The manifest

- `tests/image/manifest.ts` lists every image test. One harness, `tests/lib/images.ts`, runs each test in Chrome through Playwright. The device runner's checks plan runs each test in the other browsers.
- A sketch test names a sketch module and a hold time. The image page, `tests/pages/image.html`, draws the sketch in the engine's hold mode. The image is 320 x 180 pixels unless the test gives another size.
- A page test names a test page that draws and publishes its image itself, such as the texture page or a benchmark page.
- Each demo in `examples/demos.ts` is a sketch test named `demo-` and the demo's name, held at the demo's hold time. A new demo needs no entry of its own in the manifest. A unit test checks that `examples/demos.ts` lists every demo folder, and that each sketch stays under 150 lines.
- A test draws on all three GPU tiers unless it lists fewer. A sketch draws in the pipelined thread mode unless it lists others.
- Every thread mode of a test must draw the pixels of its first mode exactly. A thread mode changes only when the engine draws a frame, so the pixels must stay the same.
- A test can borrow the references of another test: the same scene drawn another way, such as with `?uploads=copy`. A test can also require that every tier draws the image of its first tier.
- A test can require values in its page's result besides the image, such as the replay page's counts of visible boxes.
- Test images live in `tests/pages/assets/`, and sketches fetch them from their own address. The texture tests decode one small picture from PNG, JPEG, WebP and AVIF files, and make their other images in code.
- The KTX2 tests load files that `basisu` 2.50 encoded from PNG files with `-ktx2 -mipmap -y_flip`. The file `quarters-etc1s.ktx2` holds `quarters.png` in ETC1S, with `-q 255`. The file `quarters-uastc.ktx2` holds it in UASTC, with `-uastc` and a half transparent quarter. The ramp of 30 x 20 texels adds `-linear`. The `?compression=` switch draws the `ktx2-bc7`, `ktx2-astc` and `ktx2-rgba8` tests, so every device draws each route. They borrow the `ktx2` references: on the Mac and on SwiftShader, every format drew within 0.003% of the pixels of that image.
- The command-line tool's tests, `tests/image/cli.spec.ts`, run `bunx @null3d/cli shot` in the fixture project `tests/fixtures/project`. Its images must match the references of the manifest's `project` test, which draws the same sketch. Change the fixture's sketch, and its references change too.
- The tests of `bunx @null3d/cli test`, `tests/image/cli-test.spec.ts`, run it in copies of the fixture project, each with its own `null3d.json`. A copy's references are copies of the manifest's `project` references, so its passing tests need no reference images of their own.
- The harness and `bunx @null3d/cli test` judge images with the same code and the same default tolerance, from `packages/cli/src/compare.js`.
- A page may paint over what GPUs draw differently, and publish it as data instead. The depth precision page paints each pixel where depth fought as the nearer surface, so every GPU matches one reference. It publishes the fighting pixels as fields.

## Adding a test

1. Add the test's entry. A sketch stays under 150 lines, and takes its settings from the query of its path, such as `sketch.ts?fog=exp2`.
2. Run the test on the Mac: `bun run test:images -g <name>`. It has no reference yet, so it fails and saves its image.
3. Look at the image with `bun run images:review`. Make it the reference with `bun run images:review --accept <name>`.
4. Make its SwiftShader reference the same way: `CI=1 bun run test:images -g <name>`, then review and accept the image. On the Mac, Playwright's Chromium draws CI's SwiftShader images byte for byte.
5. Run the checks plan in Safari and Firefox on the Mac. Run it on the phone and the iPad too, when their GPUs may draw the test another way.

A CI run that finds a missing or changed image saves it too. `bun run images:review --ci <run>` fetches those images for review.

## Parity with three.js

- A test of a feature scene can have a three.js twin: a page in `bench/pages/threejs/` that draws the same scene. Both engines build the scene from one data module in `bench/scenes/`, such as `ortho-camera.ts`.
- `bench/tests/parity.spec.ts` lists each such test with its twin. On each tier it compares the test's image with the twin's by three.js's rule, as `bun run parity` compares the benchmark scenes. It runs in `bun run test:bench`, on SwiftShader in CI. The twin loads from the production build of the benchmark pages. The test's image loads from the dev server, because the image test page loads its sketch by address.
- A comparison passes when fewer than 0.1% of the pixels differ, or when no more differ than between three.js's two renderers on the same scene. Each run saves both images and their diff in `test-results/parity/`.

## References

- References live in `tests/image/references/<set>/<tier>/<test>.png`. Each environment has a full set. `chromium-swiftshader` is Chromium on SwiftShader, the software GPU that CI draws with. `chrome-real-gpu` is Chrome on the Mac's GPU.
- SwiftShader and the Mac's GPU differ at object edges, in up to 0.35% of S1's pixels.
- Playwright's runs use the SwiftShader set in CI, and the real-GPU set elsewhere. With `CI=1`, a run on the Mac uses CI's SwiftShader setup and draws CI's images.
- A comparison passes when at most 0.1% of the pixels differ by more than pixelmatch's threshold of 0.1. A test can set its own tolerance.
- pixelmatch skips a pixel that it finds on an anti-aliased edge, from neighbors of exactly one color. The engine dithers its output, which leaves few such neighbors, so most edge pixels count.
- An image without a reference, or one that differs from its reference, fails its test. The harness saves it as a candidate in `test-results/images/<place>/<tier>/`, with the reference, the diff and the facts of the comparison.
- Only `bun run images:review --accept` turns a candidate into a reference. The review lists each candidate in the terminal, and writes a page that shows it beside its reference and its diff.
- A candidate of a test that borrows another test's references cannot become a reference. Neither can a candidate of a tier that must draw the first tier's image. The review says why: fix the drawing, or change the other test's reference.

## Other browsers and devices

- The checks plan compares each image with its `chrome-real-gpu` reference at the device tolerance, 0.5% of the pixels by default.
- A test whose scene covers little of its frame records a tighter device tolerance, so a frame that lost its scene still fails. S2's trees cover under 1% of its frame, and its device tolerance is 0.2%.
- Where a device's GPU draws a test another way, add the device to the test's `devices`, such as `ipad` or `sm-s926b`. That device then compares with its own references in `tests/image/references/<device>/`, at the test's own tolerance. Its next run saves the images to accept.
- Each browser saves its candidates under its runner's name, such as `test-results/images/ipad-safari/`. `bun run images:review` shows them with the others.
- On 30 September 2026, Safari and Firefox on the Mac drew Chrome's images. With HDR color, at most 0.09% of the pixels differed, all at the edges of objects.
- Safari and Firefox have no compatibility mode, so a request for it gives a device with core features. The engine keeps to compatibility mode's limits there all the same, and its images match Chrome's.

## CI

- CI splits the browser tests, the manifest among them, into shards that run at once, as the `browser` job's matrix lists them. CI's `build` job builds the WebAssembly files once, and each shard downloads them. Add a shard when one takes more than about 5 minutes.
- Playwright splits the tests by count, not by time. A file that runs its tests in parallel, such as `images.spec.ts`, can split between shards, and any other file stays in one shard. The manifest's image tests are quicker than most other tests, so the shards that hold them finish first.
- A shard that fails uploads its `test-results/` folder with the candidates. `bun run images:review --ci <run>` downloads them with the GitHub CLI.
- In the merge queue, the `real-browsers` jobs run the manifest in Safari and Firefox on GitHub's macOS machines, each in shards of its own. [Device sessions](devices.md#browser-apps-on-the-mac) says how they split. A shard that fails uploads its runs and candidates as `real-browser-runs-<browser>-<shard>`, and `bun run images:review --ci <run>` downloads those too.
