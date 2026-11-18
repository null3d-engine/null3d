# D-378: The vegetation add-on stays in the repository and ships nowhere

Status: decided by the owner. The packages are private and the plant demo is removed; the demos'
own plants, the grass package and the Blender models are built in the same branch. Task: none.

Summary: The vegetation add-on and its textures package are private: no release builds, packs or
publishes them, no CI job reads them, and work on them goes on in the repository by hand, with
`bun run test:vegetation`. No demo draws its plants. The feature
demos make their own plants in code, the showcase scenes load plant models that a script builds in
Blender, and the GPU grass moves into a published package of its own, `@null3d/grass`.

## Question

The add-on's plant generator is far from the look and the cost that the demos need, and no date
for it holds. The demos that draw its plants wait for it. What do the demos draw meanwhile, and
does the add-on ship?

## Rule

The owner's rulings, in their words: "Everything else should stop using the vegetation add-on.
Don't build the add-on anymore or publish it but leave it in the codebase", "we still want to be
able to work on the add-on, so don't remove any of its code", "Wind demo should use non-addon
plants and trees" and "Remove the hidden plant meadow for now if it's not meant to be visible as a
demo". The grass is
the one part of the add-on that the demos keep, from a package of its own. Then: "Let's completely
disable the vegetation add-on running in CI. It shouldn't be active in any way because it's a work
in progress."

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
  and the CDN build skip a private package, so none of them builds or ships the add-on.
- No CI job builds, type checks, tests, draws, documents or scans the add-on. One list,
  `tools/lib/vegetation-switch.ts`, names its packages and the files outside them that exist only
  for it: its picture and browser tests, their pages and sketches, and its tools. Every command
  that CI runs leaves them out, unless the switch `NULL3D_VEGETATION=1` is on. The unit run, the
  heavy checks, the type check, the image manifest, the reference check, the browser projects, the
  checks plan of the real browsers, the lint, the docs generators and the add-on checks all
  read it. A unit
  test fails when a file outside the list imports the add-on or a file of the list.
- `bun run test:vegetation` turns the switch on and runs the add-on's work by hand: its species
  registry, its lint, its unit tests, its heavy checks, its type check and its browser tests. The
  commit hook passes over the add-on's files, so this command is the add-on's gate. Its references
  stay in `tests/image/references`, and the reference check passes over them while the switch is
  off.
- The add-on's page and its species page leave the published docs while it is a work in progress.
  Its page is `packages/vegetation/docs/api.md`, and `bun tools/vegetation-registry.ts` writes the
  species page beside it. The API reference reads no part of the add-on.
- The add-on's code stays whole. Code that moves to a published package for the demos, the grass
  and the far-card hand-over, is re-exported from the add-on under its old name.
- The vegetation demo, the meadow of every species, is removed while no page shows it. Git keeps
  it, so it returns when the add-on ships. Keeping it hidden was rejected: no page listed it, yet
  its picture test cost CI a heavy job's whole time, since CI's software GPU took over 540 s for
  one of its frames.
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

- The add-on's page carries the `planned` status, and the skills no longer offer it.
- CI's browser shards lose the add-on's tests: 20 species by 3 GPU paths of pictures, which took
  1.36 minutes each on CI's software GPU, and about 30 minutes more of other plant tests. The two
  heavy-check jobs of the add-on's plant checks go too.
- A change to the engine that breaks the add-on shows only when someone runs
  `bun run test:vegetation`. That is the cost of the ruling.
- The release guide lists thirteen public packages, the grass package among them.
- `tools/samples/blender/` holds the scripts that build the showcase scenes' plant models.
