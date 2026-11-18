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
- The vegetation demo keeps its folder and its entry in `examples/demos.ts`, which marks it
  `hidden`: no page lists it, its own address still starts it, and its image test still draws it.
- Feature demos make their content in code ([Examples](../examples.md#procedural-first)), so
  the stone garden, the light shafts wood, the atmosphere valley and the wind demo grow their own
  plants in code. Loading Blender models in them was rejected: it breaks that rule for no gain in
  look over the code-made plants they drew before.
- Showcase scenes may load models built by script in Blender. Creek loads its broadleaves and bank
  plants from the sample content again, and the island loads its pines, olives, holm oaks and
  oleanders from a Blender script of its own. A new Creek replaces the present scene later
  ([D-363](D-363-owner-rebuilds-creek.md)).
- The GPU grass moves to `@null3d/grass`, a published foundation add-on. Keeping it in the add-on
  was rejected: the demos draw it, and a reader could not install what the demo shows.

## Consequences

- The docs pages of the add-on carry the `planned` status, and the skills no longer offer it.
- The release guide lists twelve public packages, and the grass package joins them.
- `tools/samples/blender/` holds the scripts that build the showcase scenes' plant models.
