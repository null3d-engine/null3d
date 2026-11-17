# Vegetation process

This guide says how the vegetation add-on's species work runs. It gives the design every species is
built to, the helpers' roles and rules, and the owner's rulings that bind the work. It also says how a
new session picks the work up from the repository alone. [Plant review](plant-review.md) holds the standard a
species is judged by, and [the vegetation species guide](vegetation-species.md) holds where each species
stands.

## The design

Every species is one structure, built by a habit module for its form. The tree forms are dome and
vase trees, weeping trees and conifers. The others are a column with arms, a crown of fronds, a clump
of culms, and ground tufts, rosettes and colonies.

- **The frame.** A trunk, great limbs balanced round it, and a counted set of crown lobes with sky
  between them. The frame is planned from the species' own outline by height, with each side's reach and
  the crown's lower boundary under each limb. Every branch ends in a socket.
- **Ranked sockets.** Each socket's rank is set once across the whole plant. A rank that restarts in each
  pad or patch is another field and is not called rank.
- **Branch pieces.** A socket carries one branch piece: a cut branch end with its leaves, a frond or a
  shoot. A placed piece never carries placed pieces; a large piece is split into parts at one socket. A
  piece's flat side has a stated heading at its socket, never a random roll, and the piece keeps its
  measured depth.
- **The leaf is the ruler.** On a whole plant the one scale is the height from the species' fact sheet,
  and every other size is the photographs' measured proportion. A piece seen without its plant, such as
  a cut branch on a studio ground, takes its size from its leaf.
- **The levels.** The nearest level draws the real pieces. The first and second card levels draw each
  piece as crossed card planes. A card holds its piece's own size within three hundredths in height,
  width and depth. The far level is the impostor. A card is cut by a hard line that keeps the bake's measured
  cover at every mip level. A card's free neighbors share one support branch per clump, so every card set
  touches drawn wood.
- **Sparseness removes.** It thins the same grown plant by whole sockets in rank order, and wood that
  carries no kept socket goes. At its maximum the trunk, the great limbs and a stated least of foliage
  remain.
- **The triangle maximum simplifies.** It never removes what sparseness would keep. It makes parts
  coarser, then draws them as cards, then as the far card, and each part keeps a stated least. A plant
  refuses a maximum below its least, with an error that names it.
- **The scene's budget of real pieces.** Near the eye a card would draw larger than its texels, so the
  nearest copies draw real pieces inside one budget for the scene. Its first stage hands the budget out
  nearest copy first.

## The lines and their roles

Each helper works on its own branch, its line, and never in another's copy.

| Role | Line | Work |
| --- | --- | --- |
| Builders, by species | `veg/frames` (pedunculate oak, silver birch), `veg/trees` (holm oak, weeping willow), `veg/trees-b` (common ash, common alder, hawthorn), `veg/conifers` (Scots pine, Italian cypress, giant sequoia), `veg/forms` (sedge, meadow grass, hosta, bracken, saguaro), `veg/fronds` (date palm, tree fern, bamboo), `veg/pieces` (the branch pieces, the beech and the olive) | Each species' frame, pieces, record, textures and tints, and its rounds |
| Merge helper | `veg/integrate`, the shared line | Merges the lines, runs the checks and the digests, and hands the landing its head |
| Card bake | `veg/bake` | The card atlas and the card cut |
| Limit | `veg/limit` | Sparseness, the triangle maximum, the card join and the scene budget |
| Review tool | `veg/review-next` | The review page, its cameras, slots and figures |
| Independent reviewer | none | Judges rounds and audits tests and merges; builds nothing |
| Lead | none | Orders the work, rules where the owner has not, and relays between roles |
| Landing session | the milestone branch | Gates the shared line and lands it |

A species switches to its new structure once the reviewer passes it under the gate. A ready branch then
switches that species alone, as judged.

## The gate's checks and their automated tests

The gate is stated in [Plant review](plant-review.md#the-gate-a-species-must-pass). Every check must
name a test in the repository or a coverage rule in the review tool; a check with neither is not a
gate. This is the mapping at the gate's first head. The numbers are the gate's own items, so its
distance ladder and zoom (items 3 and 4) are the sweep's covered rounds, folded here into the
reference views and the switch. **Covered means a test that fails when the check fails**: a measure
that prints a figure, or a tool that exists, is not coverage.

| # | Check | Test or coverage rule | Covered today: what fails |
| --- | --- | --- | --- |
| 1 | Every reference view compared beside its same-named crop | `tools/lib/plant-review/coverage.test.ts`, "the coverage list": "is complete only when every file in use has a full comparison" and "blocks a pass for a missing render, an unmatched frame or a short wind clip"; `references.test.ts` holds the same-named crop rules | Yes: the two coverage cases fail on a missing or partial comparison, and the reference cases fail on a crop whose species or heading disagrees |
| 2 | Three close views: inside the crown, at the trunk, at a leaf's scale, each beside its crop | The cameras are tested (`close.test.ts`, "the framing a close view reports"; `subject-shots.test.ts`, "the view from inside the crown") | No: nothing fails when a round lacks one of the three views; the camera cases fail only on the camera logic. The run's coverage entry must fail on a missing view: the sweep's owner |
| 5 | Every drawn cluster's base within a cell of drawn wood, no row off a drawn carrier, at every sparseness and maximum | `packages/vegetation/src/lod/budget.test.ts`, "keeps one body at each maximum, at sparseness X" (the 0.4 m body fill, free wood and free leaves 0); `sparse.test.ts` holds each carrier and every sparser state's rows at their places; `leaf/piece-rows.test.ts` and `lod/clump-card.test.ts` hold the row and socket joins | Yes on the generator: the body case fails when a piece lies outside the 0.4 m cells or a row loses its carrier, and `sparse.test.ts` fails when a sparser state's carrier is missing. The sweep's body rail prints a figure but no test fails on it: B's coverage rule |
| 6 | A crown at 400, 1,000 and 10,000 with the leaves first | `lod/budget.test.ts`, "keeps every level within the maximum and each part within its allowance, at sparseness X" (every maximum, the floors and the sharing); the contract's X3 in `grow/planned-contract.test.ts` reads the cap's leaf triangles and the floors | Yes: the case fails when a level overruns its maximum or a part exceeds its allowance, and X3 fails when a cap's leaf share falls under its floor |
| 7 | The switch's grain and open sky either side of the first card level, inside the record's bars, at the from-below camera | The sky side has `lod/card-size.test.ts`, "keeps the sky inside the crown outline of the species within the review band" | No: the sky case fails only on the atlas proxy; no test fails on the drawn switch's grain or crossing. The level builder's case must read a drawn frame |
| 8 | The bake's mask follows the leaf kind, and a needle species' atlases differ from the broadleaves' | `compare.test.ts`, "the mask check gate", checks the review's mask against the reference crop, not the bake's | No: no test fails on the bake's mask by leaf kind. The level builder |
| 9 | The crown's tone against its crop, found by isolating one cause at a time | The measures are tested (`compare.test.ts`, "the measures"; the CIELAB clusters in `references.test.ts`) | No: the measures print figures, and no test fails on the tone bar below. Its case must be built |

The partial checks (2, and the review side of 5) take their coverage rules from the sweep's owner; the
missing ones (7, 8 and 9) are with the level builder, and the bar below is check 9's specification. A
species is not counted landed while one of them is red. **The mapping is open:** every entry that says
no failing test is unclosed, and the mapping must not be read as complete until the sweep's owner and
the level builder close them.

### Check 9's tone bar

One figure per species: the crown's foliage colour distance, CIEDE2000, between the render's crown
patch and the same-named reference crop's crown patch, read from the review tool's stills pair at the
whole view, on the plant alone, under the photograph's own light from the slot file. It passes at
**3 or less**, the review's working band, where about 2 is one visible step.

The isolating draws, all at the same camera and slot light, one cause each:

- the same view under the page's soft daylight, to price the light's share (the oak reads 8.9 steps
  under it and 1.9 under the photograph's own light);
- the parts picture, to name the material the figure reads;
- the leaf close view against its own texture crop, to separate the leaf's albedo from the crown's
  assembly;
- the three card draws on a close view: the colour term alone, the card plane's normal in place of
  the baked normal, and the transmitted term at zero.

The cause is the term whose change moves the figure inside the bar. The record's colour is never
fitted to close the figure, and a figure taken under the page's daylight, or one fitted to a single
picture, is not the bar.

## Rules every helper follows

1. **Every bun process goes through the machine's job queue**, the script the git setting
   `null3d.jobQueue` names. A targeted `bun test --conditions=null3d-source <files>` books 4 GB; any other
   unit run or script takes the CPU lane at a 4 GB peak. One short test file, under 30 seconds and 1 GB,
   may take the quick lane. No unit run lasts over three minutes: split it by file, by species or by
   habit.
2. **Drawings run one at a time** and are never chained in a script. Check the queue first. A plant round
   books 8 GB.
3. **Push after each finished item.** Work on one disk cannot be merged or judged.
4. **A figure names its commit, its picture, its level and which gap it is.** "Inside" means inside the
   review standard's band, in both views for a branch piece.
5. **A helper does not change a budget or a cap the owner set.** It asks the lead.
6. **Do the items in order and stop when the list is done.** Start no work that is not ordered.
7. **Never merge or push into the milestone branch.** Only the landing session lands.
8. **Begin every report with your exact model name.**
9. **A real round is drawn by its builder**, at the builder's newest pushed head, after merging the shared
   line. Name it `<species>-<commit>`. A run drawn on another line judges cameras only and says so with
   `-cameras-`. A plant whose whole views draw at the leaf form adds one picture at a card level.
10. **Count before you draw**, as [Plant review](plant-review.md#count-before-you-draw) says.
11. **Before each push, run the maths-rule test** (`core/math-use.test.ts`) through the queue. The
    browser's own maths, such as `Math.hypot`, `Math.cos` or powers, never reaches a plant's numbers; use
    the core's functions.
12. **Shaders.** Before committing a shader change, run `bun tools/shaders.ts` outside the queue
    under its own lock, while more than 12 GB are free. The commit hook then rebuilds nothing. Never queue `bun run shaders`, and never skip a hook.
13. **Color** follows [the color method](plant-review.md#color-found-by-isolating-its-cause). Measure
    first and isolate the cause. Change only your species' own textures and tints, and take a shared
    change to the lead first.
14. **Caps are ceilings** until every species is done, when all twenty species' caps are reset together
    to their measures plus a twentieth. A species that has passed the gate may raise its own caps once,
    to its measure plus a twentieth, by the lead's ruling. No raise passes an owner's class-wide cap.

## Merges into the shared line

- **Resolve a conflict hunk by hunk.** Never take one side of a whole file. Taking one side drops every
  change the other side made in that file, the changes that do not clash among them.
- **Check every line either parent added.** For each parent, read every line the merge removes, or
  compare the merge with git's own merge (`git show --remerge-diff`). Then run the tests of each file
  that conflicted.
- **Check every species entry after the merge.** A merge of the shared line into a builder's line can
  put an old record back over the builder's entry with no conflict shown. The shared line keeps a species
  that has not passed on its old grower, and that hold is a change after the merge base.
- **Compare all twenty species' digests before and after**, for each variant the species walk grows, on
  exports. A species that moves and is not the one the merge switches is named in the merge's message.
  The message gives the commit and file that move it, and whether its look moved. A switched species whose look moves
  stops the merge until its owner makes the change opt-in or the reviewer judges it again.
- A merge commit holds only conflict resolutions and mechanical fixes, as AGENTS.md says.

## The owner's rulings in force

- **The primary plant.** The whole plant's turning video and picture `01` define the one individual;
  the other pictures are matched on form and proportion.
- **One structure for every species**, with the pedunculate oak as the gate the trees followed.
- **Sparseness removes parts** from the same grown plant; at its maximum the trunk, the great limbs and a
  least of foliage remain.
- **Size.** One scale per species, from its fact sheet; every other size is a measured proportion. Where a
  fact sheet's proportion disagrees with the pictures, the pictures govern.
- **Crowns are built nearly round**: the narrow side of the plan is at least 0.75 of the wide side.
- **Color counts** in the side-by-side gate and in the rows.
- **Caps** stay ceilings until all twenty species are done, then are reset together.
- **Near the eye, plants draw real pieces** inside a scene budget of triangles, nearest first, and cards
  beyond it.
- **Species choices:** the saguaro's primary plant keeps its four arms in one plane. The sedge follows
  its turning video. The hawthorn's default season is autumn with fruit. The olive's trunk has the dark
  opening of picture `01`. The birch's picture `33` is a second form, and the ash's picture `21` is a
  limit of the reference.
- **The vegetation work lands in the milestone branch** once the shared line is green, by the landing below.

## The landing

The landing session gates and lands the shared line. Until it is handed over, the shared line takes only
the landing's steps, and builders keep working on their own lines.

1. The ready branches that switch passed species merge, each by the merge rules above.
2. The milestone branch merges into the shared line.
3. A full run at the head: the type check, the shaders and the unit tests. Then the species walk, the
   plant picture tests, and the docs and limits checks.
4. The species digests against the milestone branch: every species whose drawn data moves, with its cause.
5. The limit line joins only if its GPU walk has passed by then. The hawthorn's first card level must
   also fit 155,000 triangles. Otherwise the limit line lands next.

## Resume from the repository

A new session needs only the repository and the reference pictures.

1. Read AGENTS.md, this guide, [Plant review](plant-review.md) and [the vegetation species
   guide](vegetation-species.md).
2. List the lines with `git branch -r --list 'origin/veg/*'` and read each line's newest commits. A
   species' newest work is on its own line; the shared line holds what ships.
3. Pick the species with the lowest floor or the nearest open fault, from the species guide.
4. Draw its round as [the species guide](vegetation-species.md#draw-a-round-again) says, and judge it as
   [Plant review](plant-review.md) says.
5. Write the verdict into that species' section of the species guide, in place of what it held. Give the
   gate, the open faults with their figures, and what comes next.
