# D-250: In-world screens draw as panels by distance

Status: decided. Date: 24 October 2026. Task: M3-B3. The measured cost of the LCD look is owed: the
cost run waits for a quiet Mac, and the machine was loaded when the branch was written.

Summary: An example add-on draws a display on an `OffscreenCanvas` as one canvas-backed texture with
its own refresh rate, changed-rectangle uploads and a click mapped back to the canvas. Its LCD
material reads the texture's derivatives, so sub-pixels, a scan band, dead texels and a boot glitch
appear as the camera comes close and fade to a smooth image far away.

## Question

How does a sketch show a display in the world, with a picture that changes, the look of a real
panel at a close distance, and a click that lands on the canvas pixel under the pointer?

## Rule

- The picture's cost stays on the canvas side: a change uploads only its rectangle, and a screen's
  refresh rate caps the reads. The upload path and its figures are [D-204](D-204-canvas-textures.md).
- The panel's look follows the distance from the texture coordinates alone. The look must not need a
  camera position, because a shader surface function has none and a value passed each frame would
  add a uniform write to every screen.
- A click's point on the canvas comes from the hit's own texture coordinates, so the sketch does no
  plane maths and no world matrix inversion.
- The add-on reaches the engine only through `@null3d/engine`, as an example add-on must.

## Data

| Measure | Plain image | LCD look | Device and browser |
| --- | --- | --- | --- |
| GPU time of a full-screen panel, milliseconds | owed | owed | Mac, Chrome, WebGPU |
| The same, on the WebGL2 path | owed | owed | Mac, Chrome, WebGL2 |
| The same, in compatibility mode | owed | owed | Mac, Chrome, WebGPU |
| Bytes of one 256 x 256 changed rectangle | 0.25 MiB | 0.25 MiB | any |
| Canvas reads a second at 12 Hz | 12 | 12 | any |

How the data was produced: the rows marked owed come from
`NULL3D_SCREEN_COST=1 bun run test:browser -- screens-cost.spec.ts`, which opens
`tests/pages/screens-cost.html` on each GPU path and preset. The page fills the view with one panel,
timed with its plain textured image and with the LCD material in turns, for three rounds of two
seconds each after a warm-up. The upload figures come from the canvas texture path of D-204.

## Decision

The add-on, in `examples/addons/screens/`, draws a screen as follows.

- **One canvas, one texture, one rate.** `createScreen` makes the `OffscreenCanvas`, paints the
  first picture through a `draw` callback before `textures.fromCanvas` reads it, and keeps the
  texture's `refreshHz`.
- **Changed rectangles.** `paint`, `mark` and `flush` join the rectangles that a drawing changed and
  call `texture.refresh` once with their union. A refresh that the rate or an upload in flight holds
  back keeps the union for the next call, so no change is lost.
- **The look by distance.** The shader takes `fwidth` of the texture coordinate in texels. A texel
  that covers more than about three pixels shows its red, green and blue bars, a row gap and its
  dead-texel hash; further away each of them fades out and the panel draws as a smooth image. The
  scan band, boot roll and tear read the sketch time, so the look needs no uniform writes.
- **Clicks.** `canvasPointAt` turns the hit's texture coordinates into a canvas point, with the
  second coordinate running against the canvas's down because a canvas texture turns the rows over.
  `screen.pointOf(event)` and `screen.texelOf(event)` use it, and `onClick` runs a handler with the
  point.

The alternatives were a per-screen material with a camera distance uniform, which costs a write for
every screen every frame and gives the wrong look at an angle, and a fixed screen-space pattern,
which shows sub-pixels at every distance and shimmers far away.

## Consequences

- The demos show the add-on: `canvas-screen` draws four panels with three rates and a close console
  panel, the picking demo's wall plan is a screen, and the showroom demo has a tablet. The Skyway
  cockpit follows when the interior work in that demo settles.
- `docs/guides/screens.md` and the cookbook's screen recipe give the calls and their limits, and the
  develop skill's recipe points at them.
- `examples/addons/screens/map.test.ts` holds the coordinate mapping: the corners, the middle, the
  row turn, clamping and whole texels. `bun run test` runs it with the examples.
- The security camera's monitor keeps its own small LCD look, because its picture comes from a
  render pass rather than a canvas. Moving it onto this material needs a material that takes any
  texture, and that is a later change.
