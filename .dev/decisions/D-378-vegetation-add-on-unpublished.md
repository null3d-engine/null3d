# D-378: The vegetation add-on stays in the repository and ships nowhere

Status: decided by the owner. The packages are private and the plant demo is hidden; the demos'
own plants, the grass package and the Blender models are built in the same branch. Task: none.

Summary: The vegetation add-on and its textures package are private: no release builds, packs or
publishes them, and work on them goes on in the repository. No demo draws its plants. The feature
demos make their own plants in code, the showcase scenes load plant models that a script builds in
Blender, and the GPU grass moves into a published package of its own, `@null3d/grass`.

## Question

The add-on's plant generator is far from the look and the cost that the demos need, and no date
for it holds. The demos that draw its plants wait for it. What do the demos draw meanwhile, and
does the add-on ship?

## Rule

The owner's rulings, in their words: "Everything else should stop using the vegetation add-on.
Don't build the add-on anymore or publish it but leave it in the codebase", "we still want to be
able to work on the add-on, so don't remove any of its code", "Vegetation demo no longer will be
visible but don't remove it" and "Wind demo should use non-addon plants and trees". The grass is
the one part of the add-on that the demos keep, from a package of its own.

## Data

| Measure | Add-on plant | Demo's own plant |
| --- | ---: | ---: |
| Triangles of a conifer at its coarsest level | 3,079 | 30 to 62 (the forest demo's firs) |
| Page memory of a demo that loads the add-on, against one that does not | 248.8 MiB | 51.8 MiB |

The figures come from the forest demo's notes in `examples/forest/woods.ts`.

## Look

The demos' own plants are the plants that each demo drew before the add-on: the stone garden's
pines and bamboo, the light shafts wood's pines and the atmosphere valley's pines, made in code,
and Creek's broadleaves and bank plants, built by script in Blender. The add-on's plants today
draw as stand-ins for most species, which look worse than either.

## Decision

- `packages/vegetation` and `packages/vegetation-textures` are private. The pack, the publish job
  and the CDN build skip a private package, so none of them builds or ships the add-on. Its unit
  tests, its picture tests and its tools keep running, so work on it goes on.
- The add-on's code stays whole. Code that moves to a published package for the demos, the grass
  and the far-card hand-over, is re-exported from the add-on under its old name.
- The vegetation demo keeps its folder, and its entry moves to `examples/hidden-demos.ts`: no
  page lists it, its own address still starts it, and its image test still draws it. A website
  imports only `examples/demos.ts`, so its build never takes in the meadow, whose add-on a website
  cannot install. A flag on the entry was rejected for that reason: the website's build would
  still bundle the sketch that the list names.
- The shader permutation list records the listed demos only, so the engine's shipped shader set
  keeps no variant that only the hidden meadow uses.
- Feature demos make their content in code ([Examples](../examples.md#procedural-first)), so
  the stone garden, the light shafts wood, the atmosphere valley and the wind demo grow their own
  plants in code. Loading Blender models in them was rejected: it breaks that rule for no gain in
  look over the code-made plants they drew before.
- Showcase scenes may load models built by script in Blender. Creek loads its broadleaves and bank
  plants from the sample content again, and the island loads its pines, olives, holm oaks and
  oleanders from a Blender script of its own. A new Creek replaces the present scene later
  ([D-363](D-363-owner-rebuilds-creek.md)).
- The GPU grass moves to `@null3d/grass`, a published foundation add-on. Keeping it in the add-on
  was rejected: the demos draw it, and a reader could not install what the demo shows. The
  package takes no code from the add-on. These are the three seams of the split.
  - The grass takes a blade's shape as a width function and a fold (`GrassBladeShape`). The
    species record's blade stays in the add-on. The record's width (`bladeWidth`) closes a
    pointed tip with the plant core's exact power function. Moving it would take the plant core's maths into the grass,
    or make plants differ between script engines. `grassCover` reads a species record, so it
    stays in the add-on. It wraps `bladeWidth` in the shape, so the cover's widths keep their bits.
  - The integer hash (`pcg`, `hashAt`, `unitAt`) moves to the grass, and the add-on's own hash
    module re-exports it. It lives on its own entry, `@null3d/grass/hash`, which imports nothing.
    The plant generator's job-worker task holds no engine import, and the grass's main entry
    imports the engine.
  - The sway distance of each preset (`PLANT_SWAY_DISTANCE`, `swayDistanceFor`) moves to the grass,
    since a page without plants needs it. The add-on re-exports it. `setWindLayer` for plant
    materials stays in the add-on.

## Consequences

- The docs pages of the add-on carry the `planned` status, and the skills no longer offer it.
- The release guide lists thirteen public packages, the grass package among them.
- `tools/samples/blender/` holds the scripts that build the showcase scenes' plant models.
