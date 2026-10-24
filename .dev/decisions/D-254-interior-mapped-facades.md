# D-254: Interior-mapped facades in one add-on, with codes in an atlas

Status: decided in the M3-B2 branch on 25 October 2026. Date: 2026-10-25. Task: M3-B2.

Summary: A city's windows draw their rooms by interior mapping. One surface function serves two
mappings. A whole wall takes its cells from the world position. A pane takes its cell from the
mesh's own coordinates. The wall finishes and the window codes are generated in code, so no image
ships and every scene stays offline.

## The problem

Night town's comparison and Skyway each wrote a facade shader in M2. They copied the room, the
lamp, the blinds and the far fade between them. Both wanted the same power-on wave. A third scene
would have copied them again.

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
- A wall and a mask alone, as the older night scene drew. The windows read as flat panels, with no
  parallax when the camera passes.
- A second map for the far average. The page's own mips already hold it. A second map would cost a
  texture slot and an upload.
- A wave written on the CPU for each window in each frame. The shader already knows the time and
  the distance.

## The faults found

- **WebGPU drew no facade.** The shader sampled its pages with explicit derivatives, and a branch
  stood before them. The branch tested a material's value, which WebGPU's uniformity analysis does
  not accept as uniform control flow for a derivative call. WebGL2 and SwiftShader compiled it, so
  two paths drew while the main one refused the whole shader. Every derivative call now stands
  before the first branch, as the engine's shader rules ask. The add-on's image tests draw on all
  three tiers, so the fault now fails a test on the path that rejects it.
- **A wall lit as one piece.** The power-on wave measured each object's origin. A wall drawn as one
  mesh lights as one piece, whatever its width. It now measures the pixel's own place on the
  ground, which serves a batch of buildings and a single wall alike.
- **A distant skyline washed beige.** The far fallback mixed the rooms' average light at its
  close-up strength. It now keeps a third of that. A city of lit windows then reads as a glow.

## The figures

The two wall pages hold 256 KB each, about 342 KB with their mip levels. The code page holds 1 KB.
The cost of the material against a plain wall, per GPU path and preset, is owed. Its command is in
the add-on's README. The test waits for a load of 8. The machine stayed between 120 and 150 through
the night the add-on was built. A figure taken then would measure the load, not the material.

## The limits

The shader reads both wall pages with explicit derivatives. No texture read sits under a branch,
as WebGL2 requires. A wall must run along one of the world's horizontal axes, since its cell comes
from the world position. The wall page repeats one cell for each window, so a wall's finish repeats
with its windows.
