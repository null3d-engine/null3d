# D-10: WebGL2 skinning

Status: decided by its rule on 2026-10-02. Date: 2026-10-02. Task: M1-L2. Test: T-21.

## Question

On WebGL2, should the engine skin each animated mesh in the vertex shader of every pass that draws it? Or should it skin each mesh once per frame with transform feedback, into a buffer that the shadow and main passes then draw?

## Rule

Adopt transform feedback if it saves at least 10% of the frame time with two or more cascades. It must do so on the S24+ and on the iPad, with identical images.

## Data

The skinning page (`tests/pages/skinning.html`) draws the same scene both ways with WebGL2 calls of its own, so the code does not ship in the engine. [Device sessions](../devices.md#the-skinning-plan) describes the scene and the timing. In short:

- A crowd of 50 to 500 generated characters. Each has 2,560 vertices, 5,040 triangles and a chain of 32 joints, with four joint weights per vertex. The page bends each chain every frame and uploads the joint matrices to a float texture.
- A directional light with 1 to 4 cascades of 2048 x 2048 texels, each fitted to its slice of the view. Both paths cull the crowd per pass on the CPU.
- A frame of 1280 x 720 pixels on every device, with four shadow map taps per pixel.
- The vertex shader path skins each character in each pass that draws it. The transform feedback path skins each character that some pass draws once, then draws the skinned buffers with plain vertex shaders. With `WEBGL_multi_draw`, each pass draws its characters in one call.

Each figure is the median of 12 batches of frames drawn back to back. Each batch ends when the GPU has finished its last frame.

### Reference: the Mac

MacBook Pro M5 Max, Chrome through Playwright (headless), 2 October 2026. GPU time from timer queries, per frame:

| Characters | Cascades | Characters drawn: main / each cascade | Skinned once | Vertex shader, frame / GPU ms | Transform feedback, frame / GPU ms | Saved |
| --- | --- | --- | --- | --- | --- | --- |
| 100 | 1 | 100 / 100 | 100 | 0.21 / 0.17 | 0.24 / 0.21 | -15% |
| 500 | 4 | 454 / 0 / 55 / 330 / 469 | 485 | 0.57 / 0.54 | 0.70 / 0.70 | -23% |

Both paths drew the same image in both runs: no pixel differed.

### The S24+ and the iPad

Run 20261002-133456-skinning, 2 October 2026: Galaxy S24+ with Chrome 154, and iPad Pro 11-inch with Safari 26.6.2. Neither browser has GPU timer queries, so the figures are whole frames in ms. "Saved" is the share of the vertex shader path's frame time that transform feedback saves; a negative share is a cost.

| Characters | Cascades | Characters drawn: main / each cascade | S24+: vertex shader | S24+: transform feedback | S24+: saved | iPad: vertex shader | iPad: transform feedback | iPad: saved |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50 | 1 | 50 / 50 | 1.27 | 2.23 | -75.8% | 3.86 | 4.14 | -7.2% |
| 50 | 2 | 50 / 0 / 50 | 3.99 | 5.55 | -39.1% | 3.98 | 4.27 | -7.3% |
| 50 | 3 | 50 / 0 / 26 / 50 | 4.88 | 5.56 | -14.0% | 4.63 | 4.68 | -1.1% |
| 50 | 4 | 50 / 0 / 0 / 50 / 50 | 6.20 | 7.35 | -18.5% | 5.00 | 5.09 | -1.8% |
| 100 | 1 | 100 / 100 | 2.08 | 4.22 | -103.3% | 5.52 | 6.54 | -18.6% |
| 100 | 2 | 100 / 4 / 100 | 2.49 | 4.64 | -86.4% | 6.09 | 6.68 | -9.7% |
| 100 | 3 | 100 / 0 / 59 / 100 | 5.64 | 7.39 | -31.0% | 6.37 | 5.72 | 10.3% |
| 100 | 4 | 100 / 0 / 4 / 97 / 100 | 7.27 | 8.78 | -20.8% | 7.27 | 6.26 | 14.0% |
| 200 | 1 | 200 / 200 | 2.90 | 5.94 | -104.4% | 5.75 | 7.32 | -27.2% |
| 200 | 2 | 200 / 9 / 200 | 3.28 | 6.39 | -94.7% | 5.30 | 6.72 | -26.7% |
| 200 | 3 | 200 / 0 / 93 / 200 | 7.01 | 10.17 | -45.0% | 5.64 | 6.78 | -20.1% |
| 200 | 4 | 200 / 0 / 9 / 169 / 200 | 8.77 | 11.90 | -35.8% | 7.35 | 7.79 | -6.0% |
| 500 | 1 | 454 / 492 | 4.16 | 11.59 | -178.3% | 7.70 | 9.31 | -21.0% |
| 500 | 2 | 454 / 56 / 483 | 5.50 | 12.55 | -128.3% | 7.83 | 9.46 | -20.7% |
| 500 | 3 | 454 / 9 / 190 / 476 | 6.00 | 12.59 | -109.8% | 8.61 | 10.35 | -20.2% |
| 500 | 4 | 454 / 0 / 55 / 330 / 469 | 12.01 | 19.00 | -58.1% | 9.57 | 11.62 | -21.4% |

- The two paths drew the same image on every page of both devices: no pixel differed.
- The JavaScript time per frame was at most 0.68 ms on either path, and at most 0.15 ms more on the transform feedback path.
- With `WEBGL_multi_draw`, which both browsers have, each pass of the transform feedback path drew its characters in one call.
- The phone stayed at Samsung's throttle level 0, with a skin temperature of 32.1 to 33.4 °C.

How the data was produced: `bun tests/real-browsers.ts --plan skinning --android chrome --lan ipad-safari`, from a checkout of the branch `feat/m1-l2-skinning-spike` on the main checkout's ports. The results are in that checkout's `target/runs/20261002-133456-skinning`. The Mac's figures came from the same page in headless Chrome, with `?characters=` and `?cascades=`.

## Decision

Skin in the vertex shader of every pass on WebGL2. Transform feedback fails the rule: it never saved frame time on the S24+, where it cost 14% to 178% more. On the iPad it saved 10.3% and 14.0% at 100 characters with 3 and 4 cascades, and cost up to 27.2% elsewhere. The rule asks for a saving on both devices, so those two iPad pages do not meet it. The Mac's GPU agrees: transform feedback cost 15% and 23% there.

## How three.js handles it

three.js's WebGL renderer also skins in the vertex shader. It reads the bone matrices from a float texture, and its shadow depth materials skin each mesh again in every shadow pass. null3D skins the same way. The data above shows that skinning once per frame with transform feedback would not pay on the lab's phone and tablet.

## Consequences

- The WebGL2 renderer skins in the vertex shader, reading the joint matrices from a float texture. Each shadow pass skins again. The renderer needs no transform feedback code and no buffers of skinned vertices.
- The skinning page and the runner's skinning plan stay in the tests, to measure again when a new device or browser could change the answer.
- Test T-21 is closed by this record.
