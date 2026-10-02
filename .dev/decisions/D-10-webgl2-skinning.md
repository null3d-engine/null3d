# D-10: WebGL2 skinning

Status: proposed; the phone and tablet data are pending. Date: 2026-10-02. Task: M1-L2. Test: T-21.

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

Pending: the skinning plan on the S24+ (Chrome) and the iPad (Safari).

How the data was produced: `bun tests/real-browsers.ts --plan skinning --android chrome --lan ipad-safari`.

## Decision

Pending the phone and tablet data.

## Consequences

Pending. Animation and skinned meshes come to the engine later; this record sets which path the WebGL2 renderer builds.
