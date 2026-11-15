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
