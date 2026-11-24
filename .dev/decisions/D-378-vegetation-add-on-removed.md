# D-378: The vegetation add-on is not in the repository

Status: decided by the owner. The add-on is removed: its two packages, its plant tools, its tests
and pages, its switch and commands, and its guides and records. Its work resumes from GitHub issue
[#551](https://github.com/null3d-engine/null3d/issues/551) and from main's commit `cbdd718e4`, the
last commit that holds the add-on, its tools, its tests and its records. The demos' own plants, the grass
package and the Blender models are built. Task: none.

Summary: The vegetation add-on is not in the repository. It is unfinished and not fit to ship in
0.1.0. Keeping it cost every command a switch and kept about a thousand files that no release used.
No demo draws its plants. The feature demos make their own plants in code, and the showcase scenes
load plant models that a script builds in Blender. The GPU grass is a published package of its own,
`@null3d/grass`.

## Question

The add-on's plant generator is far from the look and the cost that the demos need, and no date
for it holds. What do the demos draw, does the add-on ship, and does the repository keep it?

## Rule

The owner's rulings, in their words: "Everything else should stop using the vegetation add-on"
and "Wind demo should use non-addon plants and trees". Of the plant meadow, the owner ruled:
"Remove the hidden plant meadow for now if it's not meant to be visible as a demo". The grass is
the one part of the add-on that the demos keep, from a package of its own. The owner then ruled
that the add-on leaves the repository: git keeps it, and its work resumes from issue #551.

## Data

| Measure | Add-on plant | Demo's own plant |
| --- | ---: | ---: |
| Triangles of a conifer at its coarsest level | 3,079 | 30 to 62 (the forest demo's firs) |
| Page memory of a demo that loads the add-on, against one that does not | 248.8 MiB | 51.8 MiB |

| Measure | Figure |
| --- | ---: |
| Files that the removal deletes | about 1,080 |
| Of them, the add-on's two packages | 628 |

How the data was produced: the plant figures come from the forest demo's notes in
`examples/forest/woods.ts` at main's commit `cbdd718e4`. The file counts come from `git diff
cbdd718e4 --name-status` on the working tree that removes the add-on, counting the deleted files.

## Look

The demos' own plants are the plants that each demo drew before the add-on: the stone garden's
pines and bamboo, the light shafts wood's pines and the atmosphere valley's pines, made in code,
and Creek's broadleaves and bank plants, built by script in Blender. The add-on's plants drew as
stand-ins for most species, which look worse than either.

## Decision

- The repository holds no vegetation add-on. Its two packages, `@null3d/vegetation` and its
  textures package, are removed. So are its plant tools, its picture and browser tests with their
  pages, and the switch that kept them out of every CI command. Its commands, its guides and the
  decision records that settled only the add-on are removed too. No release, CI job or command reads
  any of them.
- The add-on's work resumes from GitHub issue
  [#551](https://github.com/null3d-engine/null3d/issues/551), which states the work. It also resumes
  from main's commit `cbdd718e4`, which holds the add-on, its tools, its tests and its records. That
  work brings the add-on up to date with the engine before anything ships.
- Feature demos make their content in code ([Examples](../examples.md#procedural-first)), so
  the stone garden, the light shafts wood, the atmosphere valley and the wind demo grow their own
  plants in code.
- Showcase scenes may load models built by script in Blender. Creek loads its broadleaves and bank
  plants from the sample content. The island loads its pines, olives, holm oaks and oleanders from a
  Blender script of its own. A new Creek replaces the present scene later
  ([D-363](D-363-owner-rebuilds-creek.md)).
- The GPU grass is `@null3d/grass`, a published foundation add-on. It takes no code from the
  vegetation add-on. These are its seams.
  - The grass takes a blade's shape as a width function and a fold (`GrassBladeShape`).
  - The integer hash (`pcg`, `hashAt`, `unitAt`) lives on its own entry, `@null3d/grass/hash`, which
    imports nothing, so a job-worker task can use it with no engine import.
  - The sway distance of each preset (`PLANT_SWAY_DISTANCE`, `swayDistanceFor`) lives in the grass,
    since a page without plants needs it.
- The far-card hand-over, `handOverToCards`, lives in `@null3d/impostors`
  ([D-274](D-274-impostors.md)).

## Options rejected

- **Keep the add-on in the repository and ship it nowhere.** It cost every command a switch and
  kept about a thousand files that no release used. Every CI command and check read the switch to
  leave the add-on out, and the add-on's own gate ran only by hand.
- **Ship the add-on in 0.1.0.** It is unfinished: most species draw as stand-ins, and its plants
  cost the demos far more than their own.
- **Keep the plant meadow as a hidden demo.** No page listed it, yet its picture test cost CI a
  heavy job's whole time. CI's software GPU took over 540 s for one of its frames.
- **Load Blender models in the feature demos.** It breaks the rule that feature demos make their
  content in code, for no gain in look over the code-made plants they drew before.
- **Keep the grass in the add-on.** The demos draw it, and a reader could not install what the demo
  shows.

## Consequences

- The published docs and the skills do not offer the add-on.
- CI's browser shards run none of the add-on's tests. Its pictures were 20 species by 3 GPU paths,
  at 1.36 minutes each on CI's software GPU. Its other plant tests took about 30 minutes more. The
  two heavy-check jobs of the add-on's plant checks are gone too.
- An engine change does not show whether it breaks the add-on. The work that resumes from
  `cbdd718e4` meets every such change at once. That is the cost of the ruling.
- The release guide lists the grass package among the public packages.
- `tools/samples/blender/` holds the scripts that build the showcase scenes' plant models.
- Records that settle code that stays as well as the add-on keep that part:
  [D-241](D-241-vegetation-foundation.md), [D-273](D-273-vertex-morphing.md),
  [D-274](D-274-impostors.md) and [D-283](D-283-fluid-wind-cost.md).
