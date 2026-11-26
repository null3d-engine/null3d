# Errors slice: sense and substance review

Pages in the slice: errors/E1101, E1107, E1203, E1209, E1218, E1224, E1305, E1404, E1410, E1416, E1422, E1431, E1437, E1506. All 80 error pages and the index come from one template (`errorPage` and `errorIndexPage` in `tools/lib/docs.ts:435-484`) and one table (`packages/engine/src/errors/codes.ts` for title, cause, example and version, `packages/engine/src/errors/fixes.ts` for the fix). A finding marked "template" or "data" applies to all 80 pages.

Paths below are relative to the generated copy of the repository.

Every finding below was checked against the source. None is "not verified".

## Findings, ranked

### 1. Template, all 80 pages: dense detail sits in the main text, with no place to fold it away (high, structure)

- **Pages:** every errors/E* page. Worst in the slice: E1416 (cause 194 words, 13 sentences), E1218 (95 and 91 words), E1410 (77 words, 5 sentences), E1422, E1209. Outside the slice: E1217, E1223, E1109, E1110, E1206, E1220.
- **Claim:** `ErrorEntry.cause` is documented as "What went wrong, in one or two sentences" (`codes.ts:13-14`), but many causes run to 6-13 sentences. They mix the one fact a reader needs (what failed) with limits, edge cases and internals. The template has no field for that detail, so it all lands in "What happened". The same long text then fills the page summary, the index cell and the pages list (finding 12).
- **Evidence:** `tools/lib/docs.ts:436-459` prints `entry.cause` and `entry.fix` as plain paragraphs. Stats: E1416 line 6 has 194 words and 13 sentences, and line 10 has 91 words. E1218 has 95 and 91 words.
- **Proposed edit:** Add an optional `details` field to `ErrorEntry` in `codes.ts`, for docs only (runtime code never imports `codes.ts`, so this adds no bytes to the engine). Keep `cause` to at most two sentences. Add a generator test that fails on a longer one. In `errorPage`, print `details` after the cause:

  ```md
  <details>
  <summary>Technical details: limits and edge cases</summary>

  ${entry.details}

  </details>
  ```

  For long fixes, add `fixDetails` in `codes.ts` the same way, and keep the runtime fix in `fixes.ts` short. Example for E1416: cause "assets.loadGltf() downloaded a file that it cannot read as a glTF 2.0 model. The file is broken, or it passes one of the engine's limits." The details block then lists the broken parts and the limits (finding 11).
- **Source:** packages/engine/src/errors/codes.ts, tools/lib/docs.ts

### 2. Template, all 80 pages: an error page links to nothing (high, missing-content)

- **Pages:** every errors/E* page.
- **Claim:** About 40 docs pages link to error pages, but no error page links back to the API page, concept or guide that explains the feature. The fix text names pages without linking to them, because the same text is the runtime message: "the hosting page of the docs gives the headers" (E1405, E1418), "which docs/guides/baked-light-data.md describes" (E1434), "Give options from the texture's docs page" (E1208), "The call's docs page lists them" (E1213). A newcomer on E1101 never learns what a slot is. A reader on E1422 never finds the full policy on the hosting page.
- **Evidence:** `tools/lib/docs.ts:436-459` has no link section. `fixes.ts:94,120,146`. `docs/concepts/handles.md:73-75` explains E1101 in full, and the E1101 page does not point to it.
- **Proposed edit:** Add `see: readonly string[]` (page ids, with an optional `#anchor`) to each entry in `codes.ts`. Print it as `## See also`, with each title taken from the page list, so the docs link check catches broken ones. For the slice: E1101 concepts/handles. E1107 concepts/architecture. E1203 guides/debugging. E1209 concepts/lighting, shaders/surface-functions. E1218 api/animation. E1224 api/scene, api/materials. E1305 and E1404 api/engine (`onFailure`), guides/debugging. E1410 getting-started/first-scene, guides/debugging. E1416 api/assets. E1422 getting-started/hosting#the-engines-files-on-a-cdn, getting-started/cdn. E1431 api/lights, getting-started/hosting. E1437 cli/null3d#chrome-for-testing. E1506 api/feature-instances, concepts/culling#how-each-path-culls.
- **Source:** packages/engine/src/errors/codes.ts, tools/lib/docs.ts

### 3. Template, all 80 pages: no page says how the error reaches your code, or in which builds (high, missing-content)

- **Pages:** every errors/E* page, for example E1101, E1203, E1305, E1404, E1431.
- **Claim:** An error can be thrown by the call, reject a promise, go only to `engine.onFailure`, or be logged to the console once. Some checks also run only in development builds. The pages never say which, so a reader cannot tell where to catch the error, or why a release build does not show it.
- **Evidence:**
  - E1101 and E1203 on transform setters run only `if (DEV)` (`scene/scene.ts:1146-1149`, `errors/checks.ts:41-50,63-66`). The engine core also logs E1101 for a queued change (`docs/concepts/handles.md:75`).
  - E1305 and E1404 reach only `onFailure`: "no promise rejects for them" (`docs/api/engine.md:163`).
  - E1431 is only logged with `console.error`, once per message, from the frame loop (`sketch/runner.ts:1358-1367,2283-2284`).
  - E1110 is the one cause that says "Release builds leave the check out" (`codes.ts:91`).
- **Proposed edit:** Add `reaches` ('throws' | 'rejects' | 'onFailure' | 'console', several allowed) and `builds` ('development' | 'every') to `ErrorEntry`. Print one line under the title, such as "Shows as: thrown by the call, in development builds. The engine core logs it for queued changes in every build."
- **Source:** packages/engine/src/errors/codes.ts, tools/lib/docs.ts

### 4. E1437: the page reads as fatal, but the command falls back to Google Chrome (high, missing-content)

- **Page:** errors/E1437
- **Claim:** The page says the tool deletes the archive. It does not say what happens next. By default the command then draws with the installed Google Chrome. It fails only with `NULL3D_CHROME=testing`, or when no Google Chrome is installed. The fix also leaves out `NULL3D_CHROME=testing`. It does not name the commands that download the browser: `shot`, `test`, `bench`, `check-addon` and `mcp`.
- **Evidence:** `packages/cli/src/browser.js:248-256` (`chromeFallback`), `:541-560` (`launchBrowser` with `fallback`). `docs/cli/null3d.md:581,595,598-599`: "The command then falls back… draws with your installed Google Chrome instead."
- **Proposed edit:** Add to the cause: "The command then draws with the installed Google Chrome, and warns that its pictures can differ from the references. It fails with this error only when NULL3D_CHROME=testing asks for Chrome for Testing alone, or when no Google Chrome is installed." Name the commands. Link cli/null3d#chrome-for-testing.
- **Source:** packages/engine/src/errors/codes.ts (cause), packages/engine/src/errors/fixes.ts and packages/cli/src/browser.js:96-97 (fix, which a test keeps equal to the table)

### 5. Index and E1437: "Every error the engine throws is an EngineError" does not hold for E1437 (medium, contradiction)

- **Pages:** errors/index, errors/E1437, guides/debugging
- **Claim:** The command line tool throws E1437 as a plain `Error` with a `code` property. It is not an `EngineError`, and `instanceof EngineError` is false. The index lists it among the engine's errors with no note. Its message also names no call or object, which the index says every message does.
- **Evidence:** `packages/cli/src/browser.js:104-111` (`Object.assign(new Error(...), { code })`). `tools/lib/docs.ts:477`. `docs/guides/debugging.md:26`.
- **Proposed edit:** In `errorIndexPage`, change the intro to "Every error that the engine throws is an `EngineError` with a code. The command line tool's errors, such as E1437, carry the same code and link in a plain `Error`." Drop "names the call and the object", or write "names the call or the object where there is one". Optionally group the CLI codes under their own heading (finding 12).
- **Source:** tools/lib/docs.ts

### 6. Template, all 80 pages: "Example" is neither the detail nor the printed message (medium, unclear)

- **Pages:** every errors/E* page. E1203, E1209 and E1224 show it most clearly.
- **Claim:** `ErrorEntry.example` is documented as "A message as the engine prints it" (`codes.ts:17`). The engine prints `code: detail fix See <docs url>` (`engine-error-core.ts:19-23`). The page shows only the detail, so a reader cannot match the long console text to the page. Some examples also add part of the fix: the E1203 example ends "Check the value computed before this call.", which the real detail does not hold (`errors/checks.ts:65`). Other real details repeat the fix's first sentence, so the printed message says it twice. E1209's detail ends "give the material fewer textures." and the fix starts "Give the material fewer textures." (`gpu/webgl2/programs.ts:199-202`). E1224's detail holds the whole fix list (`scene/scene.ts:5714`), and the fix repeats it.
- **Evidence:** `docs/guides/debugging.md:29` shows the real full E1203 message, which differs from the E1203 page's example.
- **Proposed edit:** In `errorPage`, print `messageFor(code, entry.example, entry.fix)` (import it from `engine-error-core.ts`), so the block is exactly what the console shows. Remove fix text from the E1203 example. Remove the repeated fix sentence from the E1209 and E1224 details at their throw sites.
- **Source:** tools/lib/docs.ts, packages/engine/src/errors/codes.ts, packages/engine/src/gpu/webgl2/programs.ts, packages/engine/src/scene/scene.ts

### 7. E1101: the cause hints that the new object can be harmed, and leaves out the build rules (medium, wrong-claim)

- **Page:** errors/E1101
- **Claim:** "Its slot may already hold a new object" suggests that the stale call changed the new object. The handles concept says the opposite: "A call on a destroyed object never changes the object that takes its slot, in any build." The page also leaves out three facts. The check runs in development builds only. In a release build the setter writes to an unused row. The engine core logs E1101 for queued changes.
- **Evidence:** `docs/concepts/handles.md:73-75`, `errors/checks.ts:41-50`, `scene/scene.ts:1146-1149`.
- **Proposed edit:** Cause: "A call used an object after you destroyed it. Development builds check every call on an object, and the engine core checks the changes that wait for the next frame. The call never changes another object that now uses the same slot." Add a details block on release builds (setters write to a row that no object uses, a second destroy() frees nothing, batch arrays and world getters throw in every build). Link concepts/handles.
- **Source:** packages/engine/src/errors/codes.ts

### 8. E1209: the cause is a sentence fragment, cause and fix repeat each other, and the numbers and backend are missing (medium, unclear)

- **Page:** errors/E1209
- **Claim:** The cause starts "A material whose shader reads more textures than a WebGL2 shader stage has units." That sentence has no main verb. Cause and fix both repeat "WebGL2 gives each stage at least 16 units, as many as the device reports". "The lit shader reads most of them" is vague. Other pages give exact figures: lighting takes 7 units, a material's maps share 6, and 3 stay free on a 16-unit device. Those pages also say WebGPU has no such limit. The E1209 page says neither.
- **Evidence:** `docs/concepts/lighting.md:275`, `docs/shaders/surface-functions.md:283`, `gpu/webgl2/programs.ts:186-203` (the check is WebGL2 only and uses the device's reported units).
- **Proposed edit:** Cause: "On WebGL2, a material's shader reads more textures than one shader stage has units. The engine refuses it before the device fails to link the shader." Fix: "Give the material fewer textures. On a device with 16 units, the lighting takes 7 and the material's maps share 6, so a custom material has 3 of its own. WebGPU has no such limit." Move the unit split into a details block. Link concepts/lighting and shaders/surface-functions.
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts

### 9. E1506: key terms are undefined, the API name is wrong, and the effect on frames is unclear (medium, term-before-definition)

- **Page:** errors/E1506
- **Claim:**
  - "A device that draws its scene directly" and "the direct path" are never explained.
  - The title says "Feature draw". The API page calls these "Add-on instance draws".
  - The fix writes `addComputeInstances()`, but the method is `scene.addComputeInstances`.
  - The page does not say which devices take the direct path: an Apple GPU in Safari, or any browser on iPhone and iPad, when the start-up probe measures it faster. It also does not say how to reproduce it with `?direct=on`.
  - "The frame records no draw" conflicts with the example ("the frame failed") and with the fix ("Destroy the draw to let the frames draw again"). From the code, every frame fails until the draw is destroyed.
- **Evidence:** `errors/core-failure.ts:186-190` (the frame call fails). `docs/concepts/culling.md:38`, `docs/guides/testing.md:220`, `docs/api/feature-instances.md:9,151`, `docs/api/reference/engine.md:78` (`drawPath`).
- **Proposed edit:** Title "Add-on instance draw after the first frame". Cause: "scene.addComputeInstances() made a draw after the first frame, on a device that draws directly. On that path the CPU counts every draw, so a count that the GPU writes has no place to go. Each frame then fails and draws nothing, until you destroy the draw." Add: "The engine draws directly on some Apple GPUs in Safari and on iPhone and iPad (engine.capabilities.directDraws). Add ?direct=on to the address to test this path on any WebGPU device." Link api/feature-instances and concepts/culling.
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts

### 10. E1305: it says "the GPU path", but only WebGPU raises it and only onFailure receives it (medium, unclear)

- **Page:** errors/E1305
- **Claim:** The cause says "The GPU path refused a command". In these docs, "GPU path" means WebGPU or WebGL2, and the reader is never told which. Only WebGPU raises E1305, from the device's uncaptured errors. The fix "it quotes the GPU path" means it quotes the browser's WebGPU error text. "After the start" is vague. The page also does not say that only `engine.onFailure` receives the error, once per device.
- **Evidence:** `render/loss.ts:120-137` (`GPUDevice.onuncapturederror`), `page/engine.ts:1046-1051`, `docs/guides/debugging.md:47` ("the WebGPU device… rejects the engine's work"), `docs/api/engine.md:163`.
- **Proposed edit:** Cause: "On WebGPU, the device refused a command that the engine gave it after createEngine() resolved, such as a buffer larger than the device allows. engine.onFailure receives the first such error on each device, and the engine draws on without the objects that the command made or drew. The canvas can stay black." Fix: "Read the message: it quotes the browser's WebGPU error."
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts

### 11. E1416: 13 sentences of limits in "What happened", and one unclear phrase (medium, technical-details-block)

- **Page:** errors/E1416
- **Claim:** The cause lists about 12 failure kinds and 6 numeric limits in one paragraph. The figures are correct, and implementers need them, but they hide the main point. "Key times that fall back" is unclear: it means key times that go down. The fix names the Khronos glTF Validator without a link.
- **Evidence:** The limits match `scene/file-limits.ts:39-55` (256 MiB per array, 64 MiB floor + 32 bytes per byte, 1 GiB cap, 4,096 texture side), `crates/null3d-core/src/animation/skeleton.rs:12` (1,024 joints) and `crates/null3d-core/src/animation/resample.rs:23-28` (4,194,304 keys). Stats: line 6 has 194 words, line 10 has 91 words.
- **Proposed edit:** Cause: "assets.loadGltf() downloaded a file that it cannot read as a glTF 2.0 model. The file is broken, or it passes one of the engine's limits. The message names the part." Then a block:

  ```md
  <details>
  <summary>Technical details: what counts as broken, and the limits</summary>

  - Broken: bad JSON or binary chunk; an offset or count past the data; a missing buffer or image; nodes in a loop; a skin or clip that breaks glTF's rules, such as key times that go down; Draco data that does not decode, or decodes to other counts than its accessors.
  - At most 1,024 nodes moved by skins and clips, the largest skeleton.
  - Decoded size: 64 MiB plus 32 bytes per byte of the file and its buffers, at most 1 GiB. Meshopt blocks count toward it. One array: at most 256 MiB.
  - One clip: at most 4,194,304 keys (frames times tracks).
  - Embedded PNG or JPEG: sides at most 4,096; all images at most 1 GiB decoded.
  - The rewriteUrl option can refuse an address the file names.

  </details>
  ```

  Link the validator (https://github.khronos.org/glTF-Validator/).
- **Source:** packages/engine/src/errors/codes.ts (with the new `details` field), packages/engine/src/errors/fixes.ts

### 12. Index and page list: each cause is printed four times, and 80 codes sit in one flat table (medium, duplication)

- **Pages:** errors/index, pages, every errors/E* page
- **Claim:** `entry.cause` is the page body, the front-matter `summary`, the index's "What happened" cell and the pages list's summary cell. The index has 6,109 words. Some cells, such as E1217 and E1223, hold 200-300 words. Readers scan the index to find a code, and they cannot. The codes fall into groups (11xx objects, 12xx values, 13xx browsers and GPUs, 14xx setup and loading, 15xx rendering), but the index does not show them.
- **Evidence:** `tools/lib/docs.ts:441` (`summary: entry.cause`) and `:464-467` (index rows). `docs/pages.md:157+`. `fixes.ts:4-5` gives the groups. Stats: errors/index has 6,109 words.
- **Proposed edit:** Use the first sentence of the cause as `summary`, or add a short `summary` field, for the front matter, the index and the pages list. In `errorIndexPage`, split the table under five `##` headings by the code's second digit, each with a one-line intro. Consider leaving error pages out of pages.md and linking the index instead.
- **Source:** tools/lib/docs.ts

### 13. Data: notes meant only for contributors reach user error pages (medium, internal-note)

- **Pages:** errors/E1402, errors/E1421, errors/E1105 (outside the sample; data applies)
- **Claim:**
  - E1402's cause describes "null3D's own dev server" serving "a checkout of its repository" and comparing "the stamp of the Rust sources". Only engine contributors meet that.
  - E1421's cause lists "instance_index and texcoords for the engine's own tests" as features.
  - E1105 and E1402 fixes say "If you build the engine from source, run bun run build again." That is a contributor step.
- **Evidence:** `codes.ts:322,467`, `fixes.ts:17,88`. AGENTS.md "Writing docs": "Write for developers who use the engine… Notes for maintainers belong in code comments".
- **Proposed edit:** Cut the checkout and stamp sentences from E1402's cause and keep them in a code comment. List only user features in E1421 (and leave test-only names out of the runtime message too). Drop the "from source" sentence, or move it to a details block headed "Technical details: building the engine yourself".
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts

### 14. Data: "This is an engine bug. Report it" gives no place to report (medium, missing-content)

- **Pages:** errors/E1107, E1404, E1305 in the slice; also E1110, E1307, E1405, E1502, E1505.
- **Claim:** Eight fixes tell the reader to report a bug, and no error page says where. The README has the link (GitHub Issues). The debugging guide names `engine.report` as useful in a bug report. Neither is linked from an error page.
- **Evidence:** `fixes.ts:20,26,80,84,92,94,156,162`. `README.md:222`. `docs/guides/debugging.md:95`.
- **Proposed edit:** In `errorPage`, when the fix holds "report it", add after the fix: "Report it on [GitHub Issues](https://github.com/null3d-engine/null3d/issues), with the full message, the browser and `engine.report`." The runtime fix text stays the same.
- **Source:** tools/lib/docs.ts

### 15. E1203: the page leaves out that setters check only in development builds (medium, missing-content)

- **Page:** errors/E1203
- **Claim:** Transform setters check for NaN only in development builds. In a release build, NaN reaches the transform with no error. The page does not say this. A reader who sees an object vanish in production cannot link it to this code. Some other calls, such as reflection probe options, check in every build.
- **Evidence:** `scene/scene.ts:1146-1149` (`if (DEV) checkVector`), `errors/checks.ts:63-66` ("Call it inside `if (DEV)`"), `scene/probes.ts:244-245` (an unguarded check).
- **Proposed edit:** Add: "Development builds check the transform setters. Release builds leave that check out, so a NaN position reaches the scene, and the object can vanish. Test in a development build to find the call." Covered more widely by finding 3.
- **Source:** packages/engine/src/errors/codes.ts

### 16. E1218: six causes in one paragraph, a cause missing, and an unexplained "problem N" message (medium, unclear)

- **Page:** errors/E1218
- **Claim:**
  - The cause runs six unrelated failures together.
  - The fix covers clip events named 'loop' or 'finished', but the cause never names that case.
  - The last sentence, "as a clip whose keys lie hours apart is", is hard to parse. The reason is that the engine resamples clips at a fixed rate, so two keys hours apart make millions of keys.
  - When the core refuses data, the message reads "the engine refused the animation data or call (problem N, at M)", and the page does not say what N means.
- **Evidence:** `errors/core-failure.ts:134-143`. `generated/core.ts:681-695` (problem 1 joints, 2 parent, 3 length, 4 not finite, 5 keys, 6 unknown skeleton, 7 wrong skeleton, 8 events, 9 mask, 10 play, 11 unknown instance, 12 unknown clip, 13 layer, 14 unknown mask, 16 track). `crates/null3d-core/src/animation/resample.rs:19-28` (30 keys per second; 23 minutes for a 65-joint rig, 45 seconds for 3,072 tracks). `generated/core.ts:633` (4 layers, so 0 to 3 is right).
- **Proposed edit:** Make the cause a short list: an unknown clip, layer, joint or morph target; an option out of range; animator() on an object with no clips; a clip event named 'loop' or 'finished'; animation data the core refuses. Add a details block "Technical details: problem numbers and clip size". It holds the problem number table and this note: "The engine keeps 30 keys per second for each track. One clip holds at most 4,194,304 keys: 23 minutes for a 65-joint rig, or 45 seconds for the largest skeleton. Two keys hours apart pass it."
- **Source:** packages/engine/src/errors/codes.ts

### 17. E1422: the page leaves out the no-build-step case and uses an internal thread name (medium, missing-content)

- **Page:** errors/E1422
- **Claim:**
  - A page with no build step makes its sketch module at a `blob:` address, so it also needs `blob:` (and `'unsafe-inline'` for an inline script) in script-src. The CDN page says so. E1422's cause and fix do not.
  - E1422 is also raised when the policy blocks the sketch module itself.
  - The example says "the job-0 worker". The user docs call these "job workers"; `job-0` is an internal thread name.
  - The page does not link the hosting page that holds the whole policy.
- **Evidence:** `docs/getting-started/cdn.md:164-176`, `docs/getting-started/hosting.md:84-98`, `sketch/define-sketch.ts:322-327`, `page/frame-stats.ts:132`.
- **Proposed edit:** Add: "A page without a build step makes its sketch at a blob: address, so its script-src needs blob: too." Change the example to "blocks a job worker". Move the Firefox note and the blob: mechanism into a details block. Link getting-started/hosting#the-engines-files-on-a-cdn and getting-started/cdn.
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts

### 18. E1404: unclear terms, and an example that points to the wrong cause (medium, unclear)

- **Page:** errors/E1404
- **Claim:**
  - "The drawing on the page" means the engine thread on the page in the single-threaded build or with `sketchThread: 'main'`, and the page does not say so.
  - "A trap in the engine core" is WebAssembly jargon.
  - The example, "the render worker failed: out of memory.", suggests a scene that is too large (E1109 or E1304). The fix then calls it an engine bug.
  - The fix "destroy the engine and start it again" does not fit the start case, where createEngine() has already stopped the engine.
- **Evidence:** `page/engine.ts:979-988` (`failureError`), `errors/errors.test.ts:247-249` ("the drawing on the page failed"), `docs/api/engine.md:163-164`.
- **Proposed edit:** Cause: "An engine thread hit an error it could not handle, such as a crash inside the engine core's WebAssembly. That thread is a worker, or the page itself when the engine runs on one thread." Use an example that is not about memory, such as "the render worker failed: unreachable." Fix: "After the start, destroy the engine and create a new one. If the message names memory, see E1109."
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts

### 19. E1410: the common cause and the related code are missing, and retry detail sits in the main text (low, missing-content)

- **Page:** errors/E1410
- **Claim:**
  - The debugging guide gives the most common cause: the sketch module reads `document` while it loads. The E1410 page does not.
  - A policy-blocked module fails with E1422 instead, and the page does not say so.
  - The page does not say how to tell a failed download from a script error ("When the download worked").
  - The two-import retry is correct, but it is implementation detail.
- **Evidence:** `docs/guides/debugging.md:41`, `sketch/define-sketch.ts:305-357`.
- **Proposed edit:** Add: "A common cause is sketch code that reads document or window when the module loads: the sketch runs in a worker." Add: "A message that quotes 'Failed to fetch' means the download failed. A message that quotes a script error, such as ReferenceError, means the module's code threw." Add: "A Content-Security-Policy that blocks the module gives E1422." Move the retry sentences into a details block.
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/errors/fixes.ts

### 20. E1431: the page does not say the error is only logged (low, missing-content)

- **Page:** errors/E1431
- **Claim:** The frame loop reports E1431 with `console.error`, once per message. It is not thrown, it does not reject, and it does not reach `onFailure`. A reader who sees dark area lights in production, with no console open, gets no signal. The example also lacks its final period.
- **Evidence:** `scene/scene.ts:3634-3658`, `sketch/runner.ts:1358-1367,2283-2284`. The example is in `codes.ts:524`.
- **Proposed edit:** Add: "The engine logs this error to the console once, and the scene draws on with dark area lights." Add a period to the example and to the detail in `scene.ts:3655`.
- **Source:** packages/engine/src/errors/codes.ts, packages/engine/src/scene/scene.ts

### 21. E1224: "point material" is named, but the code refuses particle-buffer materials (low, wrong-claim)

- **Page:** errors/E1224
- **Claim:** The cause lists "a sprite, point or line material". The code refuses sprite, line and particle shading. A points batch uses sprite shading, so its message says "a sprite material". A particle buffer's material is refused as "a particle material", and the page does not mention it.
- **Evidence:** `scene/scene.ts:1888-1892` (`batchOnlyShading`), `scene/sprites.ts:152-153` (points use `SHADING_SPRITE`), `scene/scene.ts:5283-5284` (particle buffers use `SHADING_PARTICLE`).
- **Proposed edit:** Cause: "scene.overrideMaterial received the material of a sprite, points, line or particle batch. The message calls a points material a sprite material." Link api/scene#overrideMaterial.
- **Source:** packages/engine/src/errors/codes.ts

### 22. E1107: "the TypeScript side and the core" is unexplained jargon (low, term-before-definition)

- **Pages:** errors/E1107, also E1105, E1402
- **Claim:** "The TypeScript side" is never defined in the user docs. The architecture page calls these parts the engine's JavaScript and the engine core. The fix also gives no workaround while the bug stands.
- **Evidence:** `codes.ts:56,70,109`. `docs/concepts/architecture.md`.
- **Proposed edit:** Write "the engine's JavaScript and its WebAssembly core disagree about the scene". Link concepts/architecture. Add: "Reload the page to start from a clean scene."
- **Source:** packages/engine/src/errors/codes.ts

### 23. Index: add-on error codes and gaps in the numbering are not explained (low, missing-content)

- **Page:** errors/index
- **Claim:** Add-ons own codes from 2000 to 9999 (E1225 fix, guides/add-ons). A reader with an E2xxx code finds no word about it on the index. The table also skips codes (E1210-E1212, E1427-E1429) without saying that this is expected.
- **Evidence:** `fixes.ts:70`, `docs/guides/add-ons.md:33`, `errors/engine-error.ts:35`.
- **Proposed edit:** Add to the index intro: "Codes from E2000 to E9999 belong to add-ons. Each add-on documents its own. Numbers that are missing here are not in use."
- **Source:** tools/lib/docs.ts

### 24. Data: typo "fromDatafour" in the E1208 fix, which runtime messages also print (low, wrong-claim)

- **Page:** errors/E1208 (outside the sample)
- **Claim:** "Give fromDatafour numbers per texel" is missing a space. The text is also the runtime message.
- **Evidence:** `fixes.ts:42`.
- **Proposed edit:** "Give textures.fromData() four numbers per texel".
- **Source:** packages/engine/src/errors/fixes.ts

### 25. Index and debugging guide: "links to the code's page here" points to GitHub, not the website (low, contradiction)

- **Pages:** errors/index, guides/debugging
- **Claim:** The message's link is a fixed GitHub address on the `generated` branch. A reader on the docs website follows it to GitHub, not to "here".
- **Evidence:** `errors/engine-error-core.ts:13`, `tools/lib/docs.ts:477`.
- **Proposed edit:** Write "and links to the code's page in the repository, which this page mirrors". Or, when the website's address is fixed, point the base address there.
- **Source:** tools/lib/docs.ts (and packages/engine/src/errors/engine-error-core.ts if the base address changes)

## Screenshots, demo links and concepts with no demo, per page

Demo links use https://github.com/null3d-engine/null3d/tree/main/examples/<code>. Most error pages need no picture. A shot is proposed only where it shows the symptom or the place to look.

### errors/E1101
- Shots: none.
- Demo links: none.
- Concepts with no demo: use of an object after destroy(); slots and generations.

### errors/E1107
- Shots: none.
- Demo links: none.
- Concepts with no demo: an internal mismatch between the engine's JavaScript and its core.

### errors/E1203
- Shot `console-e1203` (manual): the browser's developer tools console in a development build, with the E1203 error expanded. It shows the code, the detail, the fix, the docs link and the stack trace line in the sketch. It goes under "Example". Alt: "Chrome's console showing an E1203 EngineError with its fix, docs link and the sketch line that passed NaN." Source files: packages/engine/src/errors/checks.ts, packages/engine/src/errors/engine-error-core.ts.
- Demo links: none.
- Concepts with no demo: NaN from a zero-length vector; development-only checks.

### errors/E1209
- Shots: none.
- Demo links: none. The shader-inputs demo uses a custom material but no textures of its own, so it does not show the limit.
- Concepts with no demo: WebGL2 texture units; a custom material's textures beside the lighting's.

### errors/E1218
- Shots: none.
- Demo links: character (`character/`), under "How to fix it", for clip names, layers and a blend. morph-flowers (`morph-flowers/`), under "How to fix it", for morph targets by name.
- Concepts with no demo: the clip key limit; clip events named 'loop' or 'finished'; joint overrides by name (the look-at demo covers joints and could be linked: `look-at/`).

### errors/E1224
- Shot `override-one-material` (scripted): the objects demo with the Look choice set to "One material", beside its default view. Every crate is drawn in one standard material, which is what a valid override does. It goes under "How to fix it". Alt: "The turntable stage drawn twice: each crate in its own material, then every crate in one override material." Steps: open the objects demo on the webgpu tier at its hold time of 2.5 seconds, capture the default view, then set the 'look' choice to 'One material' and capture again. Place the two side by side. Source files: examples/objects/sketch.ts, examples/demos.ts.
- Shot `objects-default` (reference): the objects demo's default view, the left half of the pair. Reference image: tests/image/references/chrome-real-gpu/webgpu/demo-objects.png.
- Demo links: objects (`objects/`), under "How to fix it".
- Concepts with no demo: refusing a sprite, line or particle material as the override.

### errors/E1305
- Shots: none.
- Demo links: none.
- Concepts with no demo: WebGPU device limits; engine.onFailure.

### errors/E1404
- Shots: none.
- Demo links: none.
- Concepts with no demo: an engine thread that fails; restarting the engine after onFailure.

### errors/E1410
- Shot `network-sketch-404` (manual): the developer tools Network panel with the sketch module's request at 404, and the Console tab with the "second import" warning and the E1410 error. It goes under "What happened". Alt: "The Network panel showing the sketch module failing to download, and the console's retry warning and E1410 error." Source files: packages/engine/src/sketch/define-sketch.ts.
- Demo links: none.
- Concepts with no demo: passing the sketch as new URL(..., import.meta.url); a sketch that reads document while it loads.

### errors/E1416
- Shots: none.
- Demo links: gltf-model (`gltf-model/`), under "How to fix it", as a model that loads with every map.
- Concepts with no demo: the decode limits; Draco and meshopt failures; a skeleton over 1,024 joints.

### errors/E1422
- Shot `console-csp-e1422` (manual): the developer tools console on a page whose policy leaves blob: out of worker-src. The browser's own CSP violation report and the E1422 error are shown together. It goes under "What happened". Alt: "Chrome's console showing a Content-Security-Policy violation for a blob: worker, followed by E1422." Source files: packages/engine/src/sketch/define-sketch.ts, packages/engine/src/page/engine.ts.
- Demo links: none.
- Concepts with no demo: a Content-Security-Policy for engine files on a CDN.

### errors/E1431
- Shot `area-lights-default` (reference): the area-lights demo's default view, with the shop windows and neon sign lit. It goes under "What happened", left of the next shot. Reference image: tests/image/references/chrome-real-gpu/webgpu/demo-area-lights.png. Alt: "Neon street after rain, lit by rectangle and tube lights."
- Shot `area-lights-no-tables` (scripted): the same demo and camera with the request for area-light-tables*.bin blocked, so the windows and sign give no light. It goes beside the reference. Alt: "The same street with its area lights dark, because the tables file did not download." Steps: open the area-lights demo on the webgpu tier at its hold time of 2 seconds, with a Playwright route that aborts requests matching area-light-tables, and capture. Source files: examples/area-lights/, packages/engine/src/scene/area-light-tables.ts, packages/engine/src/scene/scene.ts.
- Demo links: area-lights (`area-lights/`), under "What happened".
- Concepts with no demo: serving the tables file from another origin.

### errors/E1437
- Shots: none. The output is terminal text, which a code block shows better.
- Demo links: none.
- Concepts with no demo: the Chrome for Testing hash check; the fallback to Google Chrome.

### errors/E1506
- Shots: none.
- Demo links: none. No demo calls scene.addComputeInstances.
- Concepts with no demo: add-on instance draws; the direct draw path and ?direct=on.
