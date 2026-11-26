# Browser tests of a whole app or game

Engine docs: `guides/testing`, `guides/deterministic-simulation`, `api/page`, `api/engine`, `api/math`, `api/time`, `getting-started/hosting`, `getting-started/network-use`, `guides/phones`, `cli/null3d`.

`bunx @null3d/cli shot`, `test` and `bench` cover held frames, image tests and timing. This reference covers the suite that starts a real app in a browser, waits until it is ready, drives it, and checks what it did. It runs the same way on another machine and in CI.

## Contents

1. Runner and browser
2. Start the real app
3. Wait for readiness
4. A test hook
5. What to assert
6. Determinism
7. Runs that hold on any machine
8. A worked example
9. What stays out of CI
10. Record the shader words that the suite reaches

## 1. Runner and browser

- Use Playwright Test with its own pinned Chromium.
- Install it with `bun add -d @playwright/test`, then `bunx playwright install chromium`.
- Use one browser at one version on every machine and in CI. Pin `@playwright/test` to an exact version.
- Never point a logic test at the developer's installed Chrome. Its version differs on each machine, and on macOS it fills the keychain.
- Run the suite with `bunx playwright test`. Playwright's launcher asks for Node, so its runner runs under Node.
- A Bun script that drives Playwright itself needs Bun 1.4.3 or newer. Older Bun can close Playwright's pipe to the browser, and the calls then wait forever.
- Headless Chromium on a machine with no GPU draws with SwiftShader, a software GPU. Give it the flags in section 8, or WebGPU is missing.

## 2. Start the real app

- Test the app's own page, as a player opens it. Do not build a separate test page that only looks like the app.
- Let Playwright's `webServer` start the server, on the port that the test uses.
- Test both the dev server (`bunx vite`) and the production build (`bunx vite build`, then `bunx vite preview`). Each catches faults that the other misses.
- Let CI test the production build. It is what players get, and it has no development checks.
- A production build ignores the engine's URL switches, such as `?gpu=` and `?hold=`, so a link cannot change a shipped game. A build that the suite drives with them sets the Vite plugin's `urlSwitches: true`. Section 8 turns it on only for the build that the suite starts.
- Keep the null3D Vite plugin in the config. It sends the cross-origin isolation headers on the dev server and on `vite preview`. Without them the engine runs single-threaded.
- Serve the page from `localhost` or over HTTPS. WebGPU needs a secure page. A network address over plain HTTP falls back to WebGL2 (`getting-started/hosting`).
- When the engine is a linked checkout outside the project, add its folder to Vite's `server.fs.allow`. Otherwise the dev server refuses the engine's WebAssembly file with 403.
- With a linked checkout, set `NULL3D_ENGINE_SHADERS` to the checkout's built shader modules for a production build. Without it, the plugin falls back to a download or to a build of the whole shader set from the engine's sources (`getting-started/network-use`).

## 3. Wait for readiness

- Never wait with a fixed sleep. A slow machine fails it, and a fast one wastes it.
- In a live page, wait for `engine.firstFrame`. It resolves when the first frame is on the screen.
- In a held page (`?hold=<seconds>`), wait for `window.__null3dHold`. The engine sets it when the hold ends, with `ok: false` on a failure, so a failed page never costs a timeout.
- Better still, wait for the app's own hook, which the page sets after `engine.firstFrame` and the app's own loading (section 4).
- Wait with `page.waitForFunction`, which polls until the value is true or the test's timeout ends.

## 4. A test hook

- Give the page one read-only object for tests, such as `window.__app`.
- Put on it a `ready` flag, the state the test checks, a hash of that state, and the input recording.
- Put on it the same input and choice functions that the page's UI calls, such as `act(action)` and `choose(option)`. A test then drives the same code paths as a player.
- Give the hook no call that the UI lacks. A test must not set state that a player cannot reach.
- Sketch code runs in a worker and has no DOM. The hook lives on the page. Input is page-level, and it travels to the sketch by message (`api/page`).
- When the app's logic lives in the sketch, have the sketch post its state each tick with `page.post`. The page keeps the latest copy for the hook.
- When a library on the page records the input for a deterministic simulation, the hook reads from that simulation (`guides/deterministic-simulation`).

## 5. What to assert

- Assert game logic on the simulation's state and its hash, never on pixels.
- Assert pictures with hold-mode image tests, one reference per GPU tier, with a tolerance: `bunx @null3d/cli test` (`cli/null3d`).
- Never compare browser screenshots. A screenshot shows the page's layout and the compositor, and some browsers change canvas reads to stop fingerprinting. Hold mode reads the frame back through the engine.
- Keep separate references for the software GPU and a real GPU. `CI=1 bunx @null3d/cli test` draws the software GPU's images on your own computer.

## 6. Determinism

- Step the simulation in fixed ticks: `onFixedUpdate(step)` in the sketch, or a tick counter on the page. Never step it by the frame's `dt` (`api/time`).
- Seed every random number. In the sketch, call `math.seed(n)` with a seed from the sketch module's address, and draw from `math.random` (`api/math`).
- Keep `Date.now()`, `performance.now()` and `crypto.getRandomValues` out of the simulation.
- Record each tick's input. A test replays the recording into a fresh simulation and checks that it reaches the same hash.
- Expect the same hash on every machine only from exact math. `guides/deterministic-simulation` says which helpers a simulation may import.

## 7. Runs that hold on any machine

- Pin the browser (section 1).
- Give each checkout its own port, from a variable of your own such as `APP_PORT`, with Vite's `--strictPort`. A server that another checkout left running then fails to start, and never serves the wrong files.
- Set `reuseExistingServer: false`. A server that answers on the port can belong to another checkout.
- Do not edit the project's files during a run. The dev server reloads the page under test, and restarts when its config changes.
- Serve every file that the build wrote. `vite preview` serves the whole output folder. A server that copies only some files breaks the engine's workers and shader files.
- Fail a test on any console error or page error (section 8).
- Retry once in CI, and record a trace on the first retry with `trace: 'on-first-retry'`. Never retry until a test passes.
- Start with one worker. A software GPU uses the machine's cores, and parallel pages slow each other.

## 8. A worked example

The page sets the hook after the engine draws its first frame. The `Game` class is the app's own simulation. It imports nothing from the engine.

```ts
// src/page.ts
import { createEngine } from '@null3d/engine';
import { Game } from './game';

const params = new URL(location.href).searchParams;
const seed = Number(params.get('seed') ?? Math.floor(Math.random() * 2 ** 31));
const game = new Game(seed);
const canvas = document.querySelector('canvas') as HTMLCanvasElement;
const engine = await createEngine({ canvas, sketch: new URL('./sketch.ts', import.meta.url) });

function act(action: string): void {
  game.act(action); // the keyboard handler and the on-screen buttons call this too
  engine.postToSketch('state', game.snapshot());
}

await engine.firstFrame;
Object.defineProperty(window, '__app', {
  value: Object.freeze({
    ready: true,
    act,
    state: () => game.snapshot(),
    hash: () => game.hash(),
    recording: () => game.recording(),
    replay: (recording: unknown) => Game.replay(seed, recording).hash(),
  }),
});
```

The spec opens the page with `?gpu=webgl2`. The CI build reads that switch only with the plugin's `urlSwitches` on, so the config turns it on for the suite's build alone. The other builds leave the option out, because an explicit `false` turns the switches off on the dev server too. Then `bunx @null3d/cli test`, `shot` and `bench` cannot set them:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import null3d from '@null3d/vite-plugin';

export default defineConfig({
  plugins: [null3d(process.env.NULL3D_E2E === '1' ? { urlSwitches: true } : {})],
});
```

`playwright.config.ts` starts the app on its own port: the production build in CI, the dev server elsewhere.

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';

const port = Number(process.env.APP_PORT ?? 4173);
const ci = Boolean(process.env.CI);

/** Chromium flags for WebGPU and WebGL2 on SwiftShader, the software GPU. */
const softwareGpu = [
  '--enable-unsafe-webgpu',
  '--enable-features=Vulkan',
  '--use-angle=swiftshader',
  '--use-vulkan=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--no-sandbox',
];

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  workers: 1,
  use: {
    browserName: 'chromium',
    baseURL: `http://localhost:${port}/`,
    trace: 'on-first-retry',
    launchOptions: { args: softwareGpu },
  },
  webServer: {
    command: ci
      ? `bunx vite build && bunx vite preview --port ${port} --strictPort`
      : `bunx vite --port ${port} --strictPort`,
    env: { NULL3D_E2E: '1' },  // the suite's build reads ?gpu= and ?hold=; the build you ship does not
    url: `http://localhost:${port}/`,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
```

The spec loads the page, waits for the hook, sends input, and checks the state. It fails on any console error or page error.

```ts
// e2e/game.spec.ts
import { expect, test } from '@playwright/test';

interface AppHook {
  ready: boolean;
  act(action: string): void;
  state(): { tick: number; score: number };
  hash(): string;
  recording(): unknown;
  replay(recording: unknown): string;
}
declare global {
  interface Window {
    __app?: AppHook;
  }
}

const problems: string[] = [];
test.beforeEach(({ page }) => {
  problems.length = 0;
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
});
test.afterEach(() => expect(problems).toEqual([]));

test('the player scores a point at the first gem', async ({ page }) => {
  await page.goto('/?seed=7&gpu=webgl2');
  await page.waitForFunction(() => window.__app?.ready === true);
  await page.evaluate(() => {
    for (let n = 0; n < 30; n++) window.__app?.act('right');
  });
  expect(await page.evaluate(() => window.__app?.state().score)).toBe(1);
  // The recording replays to the same state.
  const replayed = await page.evaluate(() => {
    const app = window.__app;
    return app ? app.replay(app.recording()) === app.hash() : false;
  });
  expect(replayed).toBe(true);
});
```

The picture test is a hold-mode image test in `null3d.json`. CI runs it with `bunx @null3d/cli test` beside the suite:

```json
{
  "tests": [{ "name": "first-gem", "sketch": "sketch.ts?seed=7&level=1", "hold": 2, "tiers": ["webgpu", "webgl2"] }]
}
```

A CI job then runs these steps:

```sh
bun install
bunx playwright install --with-deps chromium
bunx playwright test
bunx @null3d/cli test
```

## 9. What stays out of CI

- Real phones and tablets. Test them by hand on the devices, or on a device cloud such as BrowserStack. An emulated phone shows neither its GPU nor its heat (`guides/phones`).
- Frame rates and frame times. A headless software GPU in CI says nothing about them. Measure on a real machine with a visible window, or with `bunx @null3d/cli bench` on a production build.
- Pictures on a real GPU. CI keeps the software GPU's references. Draw the real GPU's references on a developer's machine.

## 10. Record the shader words that the suite reaches

A production build with the Vite plugin's `shaders.list` copies only the shader builds of the listed permutation words. The suite drives the states that the game offers, so it can write that list. Open the page with `withRecordingSwitch('/?gpu=webgl2&preset=low')` from `@null3d/cli/shaders`, drive it, then `await saveRecordedWords(page, 'shader-permutations.txt')`. The call ends the page's recording and adds its words to the list. The page must run a development build, or a production build with `urlSwitches: true`. Run it on both GPU paths at the low and high presets. Docs: `guides/assets-pipeline`, section "Record from your browser tests".
