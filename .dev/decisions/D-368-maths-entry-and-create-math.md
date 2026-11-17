# D-368: A maths entry and createMath for deterministic simulations

Status: decided by the owner, and built. The engine has the maths entry `@null3d/engine/math` with its sub-paths, and `createMath`. One implementation serves each helper that needs a transcendental function. Nothing is pending. Task: none.

Summary: A replayed simulation imports null3D's exact helpers from `@null3d/engine/math` sub-paths: six cost 1,202 bytes and no refused name. From `@null3d/engine` they cost 9,133 bytes and one refused name under Bun 1.4.3, and 87,857 bytes and 37 under Bun 1.3.11. The call `createMath({ sin, cos, acos, exp })` builds the other eight on given functions, and the main entry's helpers time within 2% of main's.

## Question

A game's simulation runs where a server replays it. The replaying engine refuses every function whose result differs between JavaScript engines, and every page API. Can such a simulation use null3D's math helpers?

## Rule

- Simulation code that imports the math gets no name that the replaying engine refuses, through any bundler.
- It reaches no page, worker, generated or WebAssembly code.
- The main entry keeps every export. A sketch's helpers keep their results bit for bit and their tree-shaking.
- No helper of the main entry runs more than 2% slower than main's in V8, JavaScriptCore or SpiderMonkey.
- Each helper has one implementation, with no second copy that can drift from the first.

The owner ruled that null3D gains a maths-only entry and `createMath({ sin, cos, acos, exp })`. That call returns the eight helpers that need those functions, bound to the functions given. A game's simulation then passes the replaying engine's scan with an exact math library, while drawing keeps the browser's `Math`. The owner allowed any change to null3D that a game of the vbz platform needs.

## Data

The first table gives what a simulation bundle holds, by how it imports the helpers. Each module calls `vec3.add`, `vec3.cross`, `vec3.normalize`, `quat.multiply`, `mat4.multiply` and `math.clamp`. Each is built as the vbz SDK builds a game's simulation: `bun build ./x.ts --target=browser --format=esm --minify`, with `NODE_ENV=production` alone in the environment. The flag `--conditions=null3d-source` makes the bundler read this checkout's source. A refused name is one in clockwork2's list of names that a simulation may not use, its `validate/scan/banned.ts` at version 0.9.0.

| How the simulation imports the helpers | Bun 1.3.11 | Bun 1.4.3 |
| --- | --- | --- |
| A module with no helper | 46 bytes | 46 bytes |
| `import * as vec3 from '@null3d/engine/math/vec3'`, and the same for `quat`, `mat4` and `math` | 1,202 bytes, no refused name | 1,202 bytes, no refused name |
| The same, with `createMath` and one built helper called | 3,939 bytes, no refused name | 3,934 bytes, no refused name |
| `import { mat4, math, quat, vec3 } from '@null3d/engine'` | 87,857 bytes; 37 refused names: `Math.sin` 10, `Math.cos` 9, `Atomics` 5, `requestAnimationFrame` 4, `Math.acos` 2, `document` 2, and `**`, `FinalizationRegistry`, `Math.exp`, `Math.random` and `navigator` once each | 9,133 bytes; 1 refused name, the main entry's top-level `FinalizationRegistry` |

How the data was produced: one build of each module of the branch's tree with each Bun, from a scratch folder under `tests/`. A count of each refused name in the output gives the names. An earlier study measured main with Bun 1.3.11. There, the main entry gave 119,981 bytes and 43 refused names for a game's whole simulation. A maths entry written as `export * as vec3 from ...` gave 21, because Bun 1.3.11 keeps each re-exported namespace whole. Modules imported one by one gave 1,134 bytes and none. The packed package could not be bundled for a simulation at all. Its main entry names a shader module that the package leaves out, and its exports map named no maths module.

The second table gives the time of each helper of the main entry, in nanoseconds per call. Each figure is the median of six runs, in turns with main's bundle, each run in a process or a page of its own. A run calls the helper in a loop of static namespace calls that keeps every result, as a sketch's production bundle calls it. Each form was bundled with `bun build --target=browser --format=esm --minify`.

- Node 22.23 (V8) and Bun 1.4.3 (JavaScriptCore) timed 25 rounds of 200,000 calls.
- Chromium 153 (V8) and Firefox 142 (SpiderMonkey), headless through Playwright, timed 15 rounds of 2,000,000 calls. Firefox ran with `privacy.reduceTimerPrecision` off.
- A Linux computer with 4 cores ran nothing else, at a load average from 0.6 to 1.3.

Three forms of the shared implementation were timed against main's helpers:

- The arguments form: each namespace function passes `Math.sin` to a call such as `slerpWith(sin, acos, out, a, b, t)`.
- The wrapper form: a maker returns the helper, and the namespace's function calls it.
- The built form: the namespace exports the helper that a maker built.

| Helper | Engine | Main | Arguments form | Wrapper form | Built form |
| --- | --- | --- | --- | --- | --- |
| `slerp` | JavaScriptCore | 30.44 | 33.83 (+11.1%) | 30.42 (-0.4%) | 30.82 (+0.9%) |
| `setAxisAngle` | SpiderMonkey | 13.83 | not timed | 14.36 (+3.8%) | 13.83 (0.0%) |
| `slerp` | SpiderMonkey | 44.55 | not timed | 45.40 (+1.9%) | 44.05 (-1.1%) |
| `angle` | SpiderMonkey | 23.57 | not timed | 24.50 (+3.9%) | 23.19 (-1.6%) |
| The six timed | V8 in Node | | -0.6% to +1.1% | -1.4% to +0.1% | -0.6% to +1.8% |
| The six timed | JavaScriptCore | | -0.4% to +11.1% | -2.1% to +2.0% | -1.8% to +1.9% |
| The six timed | V8 in Chromium | | not timed | -0.8% to +3.1% | -0.8% to +0.9% |
| The six timed | SpiderMonkey | | not timed | -0.9% to +3.9% | -3.9% to 0.0% |

The six helpers timed are `quat.setAxisAngle`, `fromEuler`, `rotateY` and `slerp`, `vec3.angle` and `math.damp`. Every run of every form summed its results to the same number as main's. `create-math.test.ts` holds each built helper to main's results bit for bit.

## Look

The options draw the same pictures: every helper gives main's results bit for bit, so no image changes.

## Decision

The maths entry is a family of sub-paths:

- `@null3d/engine/math` holds `createMath`, its types and the array types.
- `@null3d/engine/math/vec3`, `/quat`, `/mat4` and `/math` each hold the exact helpers of the main entry's namespace of that name, as named function exports.

A simulation writes `import * as vec3 from '@null3d/engine/math/vec3'`, and reads as a sketch does. Each sub-path is the very module that the main entry's namespace re-exports, so the two hold the same functions. The modules behind the entry import only each other. So a bundler that keeps whole modules still reaches nothing else. Colors stay out: four of the five color helpers use `**`, and a simulation has no use for color.

The eight helpers that need a sine, a cosine, an arc cosine or an exponential are `quat.setAxisAngle`, `fromEuler`, `rotateX`, `rotateY`, `rotateZ` and `slerp`, `vec3.angle` and `math.damp`. A search of every math module found no other. Each is written once, in `packages/engine/src/math/create-math.ts`, as a maker that takes the functions and returns the helper.

- The main entry's namespaces build each helper once, at load, on the browser's functions, and export it. This is the built form.
- The call `createMath` builds all eight on the caller's functions, and groups them as the namespaces group them.
- It throws E1213 for an argument that lacks one of the four functions. The error is an `EngineErrorWithFix` from `errors/engine-error-core.ts`, which carries its fix text itself.
- That class carries the code, the docs page and the mark that `instanceof EngineError` reads. The class `EngineError` loads its fix text by a dynamic import, which a simulation may not hold.
- `create-math.test.ts` holds the fix that `createMath` gives equal to the table's fix for E1213.
- The random helpers move to a module of their own, `random.ts`, which only the main entry reaches.
- The maths entry and its four sub-paths join the entry points that add-ons and examples may import, in AGENTS.md rule 12. A simulation in an example imports them as a game does.
- One list, `packages/cli/src/public-entries.js`, names those entry points for the add-on check and for the repository's import check.

Options rejected:

- `export * as vec3 from ...` in one maths module: Bun 1.3.11 keeps every helper of a re-exported namespace. With them come `Math.sin`, `Math.acos`, `Math.exp` and `Math.random`.
- Named exports from one module: the namespaces share names, such as `multiply`, `normalize` and `create`. One module would need new names for them, which no sketch uses.
- The main entry with a bundler that tree-shakes: under Bun 1.4.3 it still brings a top-level `FinalizationRegistry`, and under Bun 1.3.11 about 88 KB of page code.
- One object of every namespace from `createMath`: a bundler keeps an object whole, so a simulation would pay for every helper.
- The arguments form: JavaScriptCore ran `slerp` 11% slower than main's.
- The wrapper form: SpiderMonkey ran `setAxisAngle`, `slerp` and `angle` up to 4% slower than main's.
- A copy of the eight helpers written against `Math`: two implementations, which a drift test could hold to agree only on the inputs that it tries.
- `createMath` throwing `EngineError` itself: the class reaches the table of fixes through a dynamic import, which a simulation may not hold.
- `engine-error.ts` registering its table of fixes with a shared class at load: that side effect kept the table in every bundle of the main entry. The six helpers' bundle grew to 34,274 bytes under Bun 1.4.3.

## Consequences

- `packages/engine/package.json` names the five sub-paths, with the source under `null3d-source` and the built twins in `lib/math/`.
- `math-entry.test.ts` holds the exports map to the built twins. It holds the modules behind the entry to importing only each other, and to naming nothing that a simulation may not use.
- The same test bundles `tests/fixtures/rules-code/sim.ts` as the vbz SDK bundles a simulation. It reads the bundle for every name of clockwork2's list, which it copies, and for the names of page and worker code.
- That scan reads the bundle through the TypeScript compiler, so it sees each name with its scope. It refuses every use of `Math` but a member access to an exact member. It refuses a global name only where no binding of the bundle shadows it. The type check (`tools/typecheck.ts`) reads the fixture with no DOM types.
- A namespace member that a maker builds is a constant, declared with a function type of its own. The main entry's declarations then name no type of the maths entry. The API reference reads the signature from that function type and the summary from the member's own comment (`tools/lib/api-docs.ts`).
- `create-math.test.ts` draws its inputs from the engine's seeded generator and gives `createMath` the browser's `Math`. `math-entry.test.ts` bundles the fixture with `Math` too.
- `tools/lib/addon-imports.test.ts` passes an example that imports the maths sub-paths and refuses one that imports a module behind them. It holds the list of entry points to the package's exports map.
- The tree-shaking checks count such a constant as a helper (`tests/lib/tree-shaking-build.ts`). The quaternion check now also calls `quat.setAxisAngle` and `math.damp`, and finds no other angle helper in the bundle.
- The reference lists the built helpers first in their namespace's table. It shows `fromEuler`'s `order` as optional, with its default in the summary.
- In V8, closures of one function share the feedback of their call sites. A thread could call a helper that the main entry built and one that `createMath` built on other functions. Those call sites then see two targets, which no run here timed. A sketch has no use for `createMath`, and the docs show it in simulation code only.
- The docs page `guides/deterministic-simulation` says which helpers a simulation may import and from where. It shows `createMath` with an exact math library. It keeps input, picking and physics that decide a result out of the sketch, and gives a production recipe for a game's engine files.
- `api/math`, `guides/physics`, both skills and the three.js mapping link to it.
