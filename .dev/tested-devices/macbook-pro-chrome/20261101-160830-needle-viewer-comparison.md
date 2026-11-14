Plans: needle-viewer comparison, in Chrome 156.0.8078.79 on the owner's MacBook Pro, headless, at
1280 x 720 and pixel ratio 1. The viewer is the static Needle Engine 2.60.4-pre build in
madjin/lightmap-tests at commit `26b002870c43dde7ab8763f16ed965742969716f`: its bundle
`assets/index.1c388c0b.js` has the SHA-256
`2d2c2b45b1a107c70ee69c17c71814e44c63e69aeeaec992116d9506b9047ce8`. The page gives the viewer
`tests/pages/assets/models/needle-lightmap/scene.gltf` through the `needle-engine` element's `src`
attribute, at `http://127.0.0.1:56084/index.html`. The engine draws the same file through
`tests/pages/sketches/needle-viewer-sketch.ts` at the same size, on WebGPU, compatibility mode and
WebGL2, at the High preset and held at 0.2 s, at
`http://127.0.0.1:5199/tests/pages/image.html?gpu=webgpu&preset=high&hold=0.2&size=1280x720&sketch=%2Ftests%2Fpages%2Fsketches%2Fneedle-viewer-sketch.ts`,
and at that address with `gpu=compat` and `gpu=webgl2`. The viewer reads the file's `Capture
Camera` node for its camera: position [-1, 9.2, -4.5], target [2, 7.9, -0.3], a 55-degree field of
view, near 0.03 and far 50. The sketch carries the same pose as constants, so the two agree today,
but a change to the node alone would desync them. Neither side adds a light, an ambient light, an
environment or a tone curve, and both scale the exposure by one. Run at `579b6c932` with
`bun tools/needle-viewer-compare.ts --viewer <clone> --out <folder>`. The tool serves the pinned
viewer, starts the dev server, opens headless Chrome, waits for the scene's `loading-finished` class,
and reads the viewer's canvas until two reads in a row match. No gate build was running when the run
started: the landing session's gate progress file ended with `gate done 15:50`, the heavy queue held
no gate job, and `ps` named no gate process.

Result: 1 comparison, 0 failures. The viewer picture is
`20261101-160830-needle-viewer-viewer.png`, taken after three matching reads. The engine's pictures
are `20261101-160830-needle-viewer-engine-webgpu.png`, `-engine-compat.png` and `-engine-webgl2.png`,
and each of their diff pictures marks the pixels that differ. The engine's WebGPU picture differs
from the viewer's at 0.051% of the pixels past the image tests' threshold of a tenth of the color
range, compatibility mode at 0.025% and WebGL2 at 0.052%, all under the 0.1% that the image tests
allow. At one step in 255 they differ at 8.486%, 5.121% and 8.400%, which is the dithering and the
rounding of surfaces that agree within a step. The pixels past the threshold sit on the roof slab's
and the wall's edges, where the two renderers smooth an edge with their own samples. The verdict:
the reduced `NEEDLE_lightmaps` file draws as Needle's viewer draws it. A wrong RGBM decode would
change the brightness, and a wrong coordinate set, scale or offset would smear the bake. The
pictures show neither, so the light map's decode and placement agree with the viewer's. The residue
is the two renderers' edges and their rounding, not the light map. The comparison covers the plain
light map only: the reduced sample carries no direction texture, so the direction is not compared
with the viewer.
