Plans: the sky layer exposure figure and the aurora demo's pictures, 2026-10-26. The branch is
`fix/m3-r24-ground-reflections`, at `fa88e407e`. The runs used the Mac's installed Chrome
155.0.8059.85 on its GPU, which the `chrome-real-gpu` references name, and Playwright's Chromium
153.0.8010.12 on SwiftShader, which the `chromium-swiftshader` set names. Both ran through the
shared queue.

Result: the clean run of `sky-layer-exposure` passed on WebGPU, in compatibility mode and on
WebGL2. A run with the dim stretch only a fifth dimmer failed all three tests at the exposure
assertion, which shows that the test can fail. The aurora demo passed all six pictures against the
unchanged references, so the fix does not move its held frame.

The exposure runs drew `tests/pages/sky-layer-exposure.html`. Its page reads the sky, the lake
under it and a rough sphere at three stretches: exposures 0.1 and 0.01, and half the background's
intensity. The page draws 480 by 270 pixels at a pixel ratio of 1, in a 1280 by 720 Playwright
window.

| Run | Result |
| --- | --- |
| Both fixes, the page as it ships | 3 passed. The lake follows the sky within 6 levels at both exposures, the dim sky falls below 0.6 of the bright one, and the lake holds its value while the background's intensity halves |
| The dim stretch at 0.08, a fifth dimmer | 3 failed at the exposure assertion, with the three readings in the log |
| `demo-aurora`, the real-GPU set | 3 passed at 320 by 180 pixels, on WebGPU, compatibility mode and WebGL2 |
| `demo-aurora`, the software set | 3 passed, unchanged |

The queue admitted the job that drew these at 01:38:42, after 1,065 s. The machine was 67 per cent
idle, at a 1-minute load of 52. That job, `target/r24-chain.sh`, ran the breaks and then the clean
and aurora runs in one slot. The commands, from the worktree:

```sh
bun run test:browser image/sky-layer-exposure.spec.ts
bun run test:images -g demo-aurora
CI=1 bun run test:images -g demo-aurora
```

Each ran with `NULL3D_PORT=6371 NULL3D_PRODUCTION_PAGES=skip`, through the shared heavy-job queue.

The logs are `target/r24-chain.log` and `target/r24-breakA.log`, which git does not keep. This file
holds the readings.

One more run tried the pre-fix drawing, admitted at 01:48:20 with a load of 30. It passed, because
the Vite plugin's shader compiler carries the engine's WGSL inside it. A change to
`background_layer.wgsl` reaches a page only after `bun run build` builds the compiler again. This
file therefore records no figure for the pre-fix drawing.
