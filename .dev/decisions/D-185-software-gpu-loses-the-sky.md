# D-185: A software GPU loses the sky when the sky is switched back on

Status: decided. Date: 2026-10-16. Task: the showcase controls test on a software GPU.

Summary: On the software GPU, switching the night town's sky off and on again leaves the scene changed for good. The picture stays 49.4 to 49.7 from its starting picture over a five minute watch. The sky it draws afterwards is not the sky it drew before the switch. Forced WebGL2 returns the whole look, and the real GPU is unaffected. So this is the engine's drawing path on the software GPU, and not the page, the sketch or a budget. The fault is parked: `tests/image/showcase-hud.spec.ts` is unchanged, and no budget is raised for it.

## Question

Does the engine restore the sky, and its light, after the sky's switch is turned on again? The question is about the engine's own choice of drawing tier on a software GPU. A page that comes back wrong is a picture fault. No test budget can cover such a fault, so the answer decides whether the test is left alone.

## Data

The figures are the mean difference of the canvas's color, in steps of 255. A probe in the test read them 30 seconds after the switch. The runs were on a Mac drawing with Chromium on SwiftShader. The picture is split into its top 30 per cent, where the night town's sky sits, and the rows below it.

| Case | The page's start | From its starting picture | Sky strip from the start | Rows below from the start |
| --- | --- | --- | --- | --- |
| The engine's own tier | up | 49.5 | 26.7 | 59.2 |
| `&gpu=webgl2` | up | 6.2 and falling | 3.5 | 7.3 |
| `&gpu=compat` | never: controls hidden after 90 s | - | - | - |
| `&gpu=webgpu` | never: controls hidden after 90 s | - | - | - |

A five minute watch of the engine's own tier took 30 readings, one every eight seconds. Each reading sat 49.4 to 49.7 from the starting picture, with no trend. The same readings sat 13.0 from the sky-off picture. The canvas pictures show a starry sky after the switch, where the sky-off state is a flat dark backdrop. So the engine does draw a sky. It is simply not the sky the scene had.

On the real GPU, with the page drawing on its own thread, the same switch returns the look. The picture sat 1.55 to 1.62 from the start, and 12.3 from the sky-off picture. The test passes there.

How the data was produced: on 16 October 2026, the spec ran with a temporary probe that read the canvas after the switch. The page's `gpu=` switch varied, and the demo stayed at the night town. The figures are in the green-main landing task's run logs.

## Decision

Park the fault. It lies in the engine's background path on the software GPU. The same engine draws this sky before the switch, and draws it again on WebGL2 and on the real GPU. So the path can do the work. The fault is in how the sky and its light are established again after the background has held a plain color. Raise no test budget for it, and change no page for it.

## Consequences

`tests/image/showcase-hud.spec.ts` keeps every check and every allowance. A red run of it on a software GPU is read as this fault until the engine's background path is fixed.

Whoever fixes it can reproduce it from the switch alone. Open `examples/index.html?demo=night-town&preset=low`. Switch the Atmosphere group's Sky off, switch it on, and read the canvas.

The next showcase scene that toggles its sky meets the same fault, because the switch reaches the engine through the same call.
