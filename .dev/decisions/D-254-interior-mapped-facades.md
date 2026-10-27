# D-254: Interior-mapped facades in one add-on, with codes in an atlas

Status: decided. Built: the facades example add-on, with both mappings and its generated pages, and its cost per GPU path and preset measured. Task: M3-B2.

Summary: A city's windows draw their rooms by interior mapping. One surface function serves two
mappings. A whole wall takes its cells from the world position. A pane takes its cell from the
mesh's own coordinates. The wall finishes and the window codes are generated in code, so no image
ships and every scene stays offline.

## The problem

Night town's comparison and Skyway each need a facade shader with the same room, lamp, blinds and
far fade, and the same power-on wave. A shader in each scene copies all of it, and a third scene
would copy it again.

## The choice

- **One shader, two mappings.** A uniform picks between the wall mapping and the pane mapping. The
  shader computes one cell, one window code and one ray into the room. Both mappings share them. A
  wall's cell follows the face's own tangent in the world, so a window keeps its size. A pane's
  cell comes from the mesh.
- **Two generated pages.** The wall page holds four finishes in a two by two grid. Each tile is
  one cell of a wall, with the opening, the frame and the sill painted in. Its alpha holds the
  window's share of light. The code page holds 256 rooms. Each texel gives a room's warmth, its
  lamp's level, its blinds' share and its furniture. Integer hashes make both, so every machine
  draws the same wall.
- **The far fallback reads the page itself.** A cell that falls below a few pixels fades to the
  page's mip levels. The alpha of those levels gives the window's share of light. The shader
  widens the sample's derivatives as the cell shrinks, so the page reaches its coarsest level. The
  grid then fades to a steady glow, with no second map.
- **The power-on wave costs one uniform write.** Each window works out when the wave reaches it,
  from its own distance to the wave's origin. Its light then rises on an analytic damped spring.
  The spring overshoots a little and settles. A scene that never starts the wave is already lit.

## The options rejected

- A texture or a layer for each window code. A city of 100,000 windows would need far more
  textures than a material binds. D-47 limits a material to six.
- A wall and a mask alone. The windows read as flat panels, with no parallax when the camera
  passes.
- A second map for the far average. The page's own mips already hold it. A second map would cost a
  texture slot and an upload.
- A wave written on the CPU for each window in each frame. The shader already knows the time and
  the distance.

## Faults to avoid

- **A branch before a derivative call.** The shader samples its pages with explicit derivatives. A
  branch that tests a material's value is not uniform control flow for a derivative call under
  WebGPU's uniformity analysis. WebGPU then refuses the whole shader and draws no facade, while
  WebGL2 and SwiftShader compile it and draw. Every derivative call stands before the first branch,
  as the engine's shader rules ask. The add-on's image tests draw on all three tiers, so such a
  fault fails a test on the path that rejects it.
- **A wave measured from each object's origin.** A wall drawn as one mesh then lights as one piece,
  whatever its width. The power-on wave measures the pixel's own place on the ground, which serves a
  batch of buildings and a single wall alike.
- **The rooms' average light at its close-up strength.** A distant skyline then washes beige. The
  far fallback keeps a third of that light, so a city of lit windows reads as a glow.

## The figures

The two wall pages hold 256 KB each, about 342 KB with their mip levels. The code page holds 1 KB.
The material costs about 1.0 ms of GPU time a frame against a plain wall, at 1920 by 1080 with a
render scale of 1, on both WebGPU paths at every preset. WebGL2 reads 0.85 ms at Low and falls to
0.05 ms at Ultra, as its plain wall grows from 1.83 to 3.15 ms while the facade wall stays near 2.7
to 3.2 ms. Every row held the display's 16.665 ms interval. The quiet run on
the Mac's M3 Max in Chrome 156 held a load of 2.0 to 2.9, and it is [the record](../tested-devices/macbook-pro-m3-max-chrome/20261027-093120-facades-cost.md).
The cost test waits for a load under 8, and its command is in the add-on's README.

## The limits

The shader reads both wall pages with explicit derivatives. No texture read sits under a branch,
as WebGL2 requires. A wall must run along one of the world's horizontal axes, since its cell comes
from the world position. The wall page repeats one cell for each window, so a wall's finish repeats
with its windows.
