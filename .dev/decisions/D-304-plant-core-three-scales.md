# D-304: the plant core grows plants at three scales, by eight growth models, one folder per species

Status: decided. Built: the contracts between the stages and the module layout, with a stub for every
stage. Also built: the generated species registry and species page, the record check, the owner's
caps, the core's own trigonometry, and a stand-in for every stage. The first generator moves whole to
`@null3d/vegetation/legacy`. Not built yet: the growers, the leaves and shoots, the wood, the plant
material, placement, the near pool, the wind records and the far cards. Task: none.

Summary: a plant grows as a macro skeleton per variant. Small shoot prototypes per species stand on
the skeleton's bud sites. Each species picks one of eight growth models and lives in a folder of
its own, with its own budget under caps per model. Every value that reaches geometry comes from an
integer hash and the core's own trigonometry, so a variant has the same bytes in every script engine.

## Question

The first generator grows every plant with one recursive branch model and draws its leaves as cards.
It keeps its species, its atlas cells and its budget in shared lists. Fifty species must match their
references close up and from every side, and about ten workers build them at once. What shape must
the generator take?

## Rule

- A species reaches its references' anatomy at close-up distance. That needs real leaves on real
  shoots near the camera, with buds, and the right number of botanical orders.
- A species that one model cannot grow takes another model, not a special case in a shared one.
- A new species adds files only. No species can fail another's branch through a shared list, a
  shared cell index or a shared budget.
- One record and seed grow the same bytes on every script engine.

## Data

The first generator's limits, read from its code at the branch head:

| Limit | Where | Effect |
| --- | --- | --- |
| 255 branches a plant, one wind record each | The record check and the wind table | The Norway spruce's 715 finest of 970 branches share a rigid record |
| One leaf cell list, indexed by position | The leaf atlas painter | Two workers who each append a cell move each other's index without a conflict |
| One bark cell list, indexed by key order | The bark atlas painter | The same fault for bark |
| One catalogue budget with a 1.5 MiB margin | The generator's budget test | Two species that each pass alone fail together |
| 16 sides on every trunk | The wood mesher | A 1 m trunk's circle misses by 1 cm |
| Two copies of the plant surface, which a test holds equal | The plant and card shaders | Every lighting change edits two files |
| `Math.sin`, `Math.exp` and their kin in the skeleton | The generator | Their last bit may differ between V8, JavaScriptCore and SpiderMonkey |

The core's own functions (`core/math.ts`) use only the four operations and `Math.sqrt`, `Math.round`,
`Math.floor` and `Math.abs`. The language standard defines each of these exactly. The unit test holds
`sin`, `cos`, `exp`, `log` and `atan2` within 8 units in the last place of Bun's own functions, over
the range that geometry uses. It holds the inverse sine and cosine within 16, and `tan` and `pow`
within 64.

## Look

Real shoots with leaves look better than cards at the distance where the references show single
leaves, buds and twig zigzag. Cards cannot show a leaf's fold or its underside. The shoot prototypes
are instanced, so the near look costs a few prototypes per species. Cards baked from the same
prototypes take over where a shoot spans a few pixels.

## Decision

- **Three scales.** A macro skeleton per variant holds orders 0 to 2 or 3. Shoot prototypes per
  species hold the finest 1 to 3 orders, with buds and leaf meshes. Shoot rows place the prototypes
  on the skeleton's bud sites. The skeleton (`MacroSkeleton`) is the one contract between the
  growers, the instancer and the wood mesher: typed arrays in plant space, with axes and bud sites.
- **Eight growth models**, picked per species. Self-organizing growth in a light grid inside an
  envelope grows broadleaves, pines, shrubs and hedges. Rule-based architecture grows the whorled and
  tiered conifers. A crown rosette grows palms and tree ferns, culms grow bamboo, rosettes grow hosta
  and agave, and a frond colony grows bracken. Tufts grow grasses, sedge and rush, and a ribbed column
  grows the saguaro. Each model is a lazy chunk of the generator's job-worker task.
- **The silhouette is an input.** A self-organizing species grows inside an envelope measured from
  its reference turntable.
- **One folder per species.** A species folder holds its record, its entry and optional shape code.
  Only the job worker loads the shape code. `tools/vegetation-registry.ts` writes the registry and the species
  page from the folders, and git keeps neither. A species names its textures by folder, never by
  position.
- **A budget per species.** Each record's budget stays under the owner's caps for its class of model
  (`core/caps.ts`). One test walks the registry to check every species. Only the owner changes a cap.
- **Determinism by construction.** Every random choice comes from the integer hash, keyed by seed,
  salt, variant, index and purpose as separate keys. Every transcendental function comes from
  `core/math.ts`.
- **Stubs and stand-ins.** Every stage exists from the start and throws `NotBuiltError` until it is
  built, so each part of the core fills only its own files. A kit built with `placeholders` grows a
  deterministic stand-in for each stage that is not built. The review page and the determinism tests
  use them, and no shipped species draws one.

Rejected:

- **Extending the first generator.** Its recursion has no buds, no light competition and no shoot
  scale. Its shared lists break parallel work, and each limit in the table above needs its own
  rewrite.
- **One model for every plant.** A palm's frond spiral, a bamboo's jointed culm and a saguaro's ribs
  have no meaning as branch recursion. One model for all of them turns into special cases.
- **Leaves as cards at every distance.** Cards cannot show the anatomy that the references show at a
  meter, and every species is judged against that.
- **A hand-edited species list.** Ten workers who edit one list collide in every merge. A list that
  merges without a conflict can still be wrong, as the cell indices were.

## Consequences

- `@null3d/vegetation` exports the plant core from its main entry. The first generator is at
  `@null3d/vegetation/legacy`, which every demo and test page imports until the demos move to the
  core. The scatter, the ground maps, the grass and the floating leaves stay at the main entry.
- The legacy entry goes when the demos move. This record then supersedes "The generator's shape" in
  [D-241](D-241-vegetation-foundation.md), and D-298 to D-303, which describe the first generator.
- `docs/api/vegetation.md` describes both entries, and `docs/api/vegetation-species.md` is generated.
- The shipped textures live in their own package, `@null3d/vegetation-textures`, one folder per
  species, so a code update carries none of them. The package is private until its first species
  ships textures.
- `packages/vegetation/src/` holds one folder per module: `core/`, `grow/`, `crown/`, `leaf/`,
  `wood/`, `lod/`, `wind/`, `render/` and `species/`. Each has its own `public.ts` barrel, and the main
  entry only re-exports them.
