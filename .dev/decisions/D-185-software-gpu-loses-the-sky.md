# D-185: The showcase test read an empty canvas, not a lost sky

Status: corrected. Date: 2026-10-16, corrected 2026-10-17. Task: the showcase controls test on a software GPU.

Summary: The showcase controls test read its starting picture before the page had drawn anything, so every frame after a switch was measured against an empty canvas. A page posts its controls while its sketch builds the scene, which is before the engine's first frame, and on a software GPU that frame arrives much later. Two empty frames differ by nothing, so the test's still check accepted the empty picture. The engine draws the sky and its light again correctly. The test now waits for the page to take its loading overlay away, which it does on the engine's first frame, before it reads anything. The reading that first blamed the engine is corrected below.

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

## Correction (17 October 2026)

The first reading above was corrected on the night of 16 October 2026, by a probe that read the same
frame against the same empty starting picture: a frame read against nothing gives the frame's own
brightness, region by region. The figures above are flat at 49.4 to 49.7 of 255 over a five minute
watch, with 26.7 in the sky strip and 59.2 below it, and the same three regions then read 50.80,
28.46 and 60.37. So the readings were the night town measured against nothing, and the sky was never
lost. The two runs below, on 17 October 2026, show why that correction is right.

Run again on 17 October 2026, with the frame reader the test had at the time:

| Case | The engine's first frame | The test's first read |
| --- | --- | --- |
| Chrome on this Mac's real GPU | drawn before the controls appear: the loading overlay was already gone when the HUD showed, a second after the load | the night town, at a mean brightness of 8.04 of 255 against 6.68 in its reference |
| Chromium on SwiftShader | not drawn | `engine.capture()` fails with E1414, "the frame's pipelines were still building after 30 s", in three runs of three |

The mechanism sits in the code as well as in the figures. The sketch posts the controls at the end of
its setup (`examples/lib/cinematic.ts`, `postControls`), and the page takes its loading overlay away
on the engine's first frame (`examples/lib/run.ts`). The pipeline build lies between the two.

The rows above that force a tier do not separate a lost sky from a backend: a forced-WebGL2 run and
an unforced one compare two drawing paths, so nothing follows from the difference between them. The
page's own start on a software GPU is the other fault (D-186).

## Decision

The test waits for the page to take its loading overlay away before it reads any picture, because
that overlay leaves on the engine's first frame. No engine change follows from this fault.

The spec's own allowance is 600 seconds, and 180 of them are the wait for that frame. Waiting for
the frame is work the test did not do before, and on a software GPU the frame arrives about 30
seconds after the page loads on a quiet machine and minutes later on a busy one.

The test runs alone (`@alone`), which is new for a test that simply waits. Its pictures need the
engine to draw frames at all, and on CI's two-core runner a heavy test beside it starves them, which
is D-186's fault. And its allowance cannot sit in a shard: a shard's 25-minute limit covers its tests
taking twice as long as the median, and this test fails exactly on slow machines. Shard 14 held 14.6
minutes of tests, so this test spending 600 seconds inside it reaches 23 minutes with the setup. The
job that runs alone took 5.3 minutes of tests, so the same allowance reaches 16.3 minutes there.

## Consequences

`tests/image/showcase-hud.spec.ts` reads its pictures after the engine's first frame, so its checks
measure the scene they mean to measure. A run whose page never draws now fails at the wait for the
overlay, which names the page's start rather than a picture.

The trap belongs to any test that reads a page's picture, not only to this one. A picture taken
before the engine's first frame is a picture of an empty canvas, and a wait for two frames to agree
accepts it. The next showcase scene that toggles its sky is read the same way.
