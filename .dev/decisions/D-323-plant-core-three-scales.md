# D-323: the plant core grows plants at three scales, by eight growth models, one folder per species

Status: decided. Built: the contracts between the stages and the module layout, with a stub for every
stage. Also built: the generated species registry and species page, the record check, the owner's
caps and the core's own trigonometry. A stand-in grows for every stage, and the demos place stand-in
species by id until each species lands. The first generator is removed, by the owner's ruling. Not
built yet: the growers, the leaves and shoots, the wood, the plant material and placement. The near
pool, the wind records, the far cards and the species are not built yet either. Task: none.

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
  deterministic stand-in for each stage that is not built. The review page, the determinism tests and
  the demos use them, and no shipped species draws one. A demo names each species it places by id.
  `loadSpeciesOrStandIn` loads the species once its folder exists. Until then it makes a stand-in
  species of the demo's size and colors. The page side draws a stand-in kit with the engine's
  standard material and instance batches. So a demo keeps its scatter, placement, wind and far cards
  while its plants are stand-ins.
- **No legacy generator.** The owner ruled that the first generator is not kept. Its code, its
  built-in species, its tests and its pictures are removed. The demos draw stand-ins until their
  species land.
- **Caching.** Results are keyed by content (`kitKey`, `variantKey`), so a cached value is never
  stale. The page keeps them in memory for a visit. Keeping them across visits is the engine's work
  for every kind of scene, so the add-on keeps no browser storage of its own. A page passes a store
  of bytes (`PlantByteCache`) to `prepareSpecies`, and the core encodes each result for it.

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
- **Keeping the first generator beside the core until the demos move.** The owner ruled against it:
  two generators double the code to maintain, and every demo would move twice.
- **An IndexedDB cache in the add-on.** Every kind of scene has derived data worth keeping across
  visits, so the engine keeps it, with one budget and one switch.

## Consequences

- `@null3d/vegetation` has one entry. It exports the plant core beside the scatter, the ground maps,
  the grass and the floating leaves.
- This record supersedes four parts of [D-241](D-241-vegetation-foundation.md): "The
  generator's shape", "The bark and leaf atlases, and why the browser paints them", "What each leaf
  cell holds" and "The plants' look, after the owner's first review". It also supersedes D-321,
  D-299, D-301, D-302 and D-303, which describe the first generator. D-300 stays a rejected test.
- The first generator's tests and pictures are removed with it. They are the thirteen species
  pictures, the atlas, leaf card, coverage, wind and impostor plant pictures, and the specs, pages
  and device plans that only it used. The species and the core's far cards and near pool bring their own
  tests back on the new core.
- `docs/api/vegetation.md` describes the core and says that the species are being rebuilt.
  `docs/api/vegetation-species.md` is generated.
- The shipped textures live in their own package, `@null3d/vegetation-textures`, one folder per
  species, so a code update carries none of them. The package is private until its first species
  ships textures.
- `packages/vegetation/src/` holds one folder per module: `core/`, `grow/`, `crown/`, `leaf/`,
  `wood/`, `lod/`, `wind/`, `render/` and `species/`. Each has its own `public.ts` barrel, and the main
  entry only re-exports them.

## The first species set

By the owner's ruling, the core ships ten species first. Then work moves to the rest of the engine, and
the other species wait as a to-do item.

| Growth model | Species |
| --- | --- |
| Self-organizing | pedunculate oak, European beech, silver birch, common alder, weeping willow, hawthorn |
| Ground plants | hosta, pendulous sedge, meadow grass |
| Fronds | bracken |

- These ten are the species that Creek uses, so Creek draws only real species. Creek grows pendulous
  sedge at its wet edges where it grew soft rush.
- The light-shafts wood becomes a beech wood. The atmosphere valley grows oak and beech. The
  contact-shadows garden grows oak, hawthorn and meadow grass.
- The Island keeps stand-ins until its Mediterranean species land.
- No conifer, palm, culm or column model is built for the first set.

**To do: the other 42 species.** Each one has a full, checked reference set in the references
repository. Each one waits for its growth model and its species package:

| Growth model still to build | Species |
| --- | --- |
| Self-organizing (built; banyan and box hedge also need its aerial-root and clipping options) | holm oak, Norway maple, Japanese maple, common ash, small-leaved lime, horse chestnut, London plane, Lombardy poplar, hazel, southern live oak, quaking aspen, English elm, bare winter oak, flowering cherry, apple, olive, river red gum, umbrella thorn acacia, baobab, rhododendron, oleander, lavender, banyan, box hedge |
| Architectural | Norway spruce, Scots pine, Douglas fir, Italian stone pine, cedar of Lebanon, European larch, English yew, common juniper, giant sequoia, Italian cypress |
| Crown rosette and fronds | date palm, coconut palm, Mexican fan palm, tree fern |
| Culm | bamboo |
| Ground plants | agave, soft rush, wildflower (its reference set is still to be made) |
| Column | saguaro |

## The milestone branch's changes to the first generator

The milestone branch kept changing the first generator after this record deleted it. The merge of
`m3-start` into the plant core's branch read each of those commits. The generator stays deleted, as
the owner ruled. Each change was either dropped with the generator or ported into the new code:

- **Ported: the grass's GPU blade list, view cull, far share and near shadows** (`70a124e6`,
  `8f69e514`, `e48160ea`, `bee6de65`). The grass is kept, so its code merged into `src/grass/`, and
  the blade list's shader moved there beside it.
- **Ported: the sway distance of each preset** (`PLANT_SWAY_DISTANCE`, `swayDistanceFor`). The grass
  and Creek read it, and it lived in a file that the deletion removed. It now lives in `wind/sway.ts`.
- **Ported: the test that holds the two grass shaders' far share to one copy** (`8f69e514`). It sat in
  the deleted atlas test. It now sits in the grass test, beside the wind block copies.
- **Kept as a stand-in: Creek's wildflower clumps** (`6b25bccf`). The first generator's wildflower
  record and its picture test are gone. By the lead's ruling, Creek still places the clumps by the
  same rule, as a stand-in of the record's size and leaf color named `wildflower`. So the valley keeps
  its layout, and the species swaps in when it ships. The stream's 13 rules now place 1,245 points,
  320 of them wildflowers. The other species keep 925 of the 930 points that they placed before.
- **Dropped: the trunks' prepass option** (`6b25bccf`). The plant material draws every role with the
  mask build, the wood included, so the depth prepass already skips the wood. The stand-ins draw with
  the standard material until their species ship, and stay as they are.
- **Dropped: the hosta's flower color** (`99300b5c`). It was a field of the first generator's record.
  The plant core's hosta grows its flowers as extras, from its own record and textures.
