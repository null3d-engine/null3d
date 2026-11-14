# D-318: the pedunculate oak grows end to end from its own record, and fixed plants draw real shoots near the camera

Status: decided. The oak's species folder (`src/species/pedunculate-oak/`) and the placement of a
species' copies at fixed places (`src/render/static-shoots.ts`) are built. The oak draws in every
review view with its own textures. The wind records, the level distances and the far bake are
stand-ins until the near pool's package builds them. The owner's review of the oak against its
references is in progress.
Task: none.

Summary: the oak is the first real species. It grows four macro orders inside the envelope measured
from its turning video. Three shoot classes fitted to its studio stills carry 340,000 to 520,000
leaves. A kit holds its own mesh tier and the tiers below it, and the owner caps it per tier.
The coarse tiers mesh no buds and draw a leaf as one cut-out card. One copy draws at most 2.5 M
triangles inside its near band at High.

## Question

How is the oak's record fitted to its references, and how does a fixed oak draw before the near
pool exists? The plant core's design (D-323) gives the oak's growth, leaves, wood, material and
review tool to the packages before it. It leaves this one the oak's own numbers. It also leaves the
drawing of real shoots near the camera. The owner capped one copy's nearest level at 2.5 M triangles
at High and a tree kit at 6 MB.

## Rule

The look decides between options that keep the caps (hard rule 40). The owner ruled that quality
comes before size, and that a kit holds only what a page draws. The lead ruled that near foliage is
budgeted by what a frame draws, not by the whole copy. The coarse tiers may simplify twigs, buds and
leaves where no pixel shows them. A species passes only when the owner's reviewer
passes every rubric row against every reference.

## Data

### The record

- **Outline.** The envelope, the crown aspect of 1.53 and the all-round band of 0.29 come from the
  fitting tool's measure of the oak's turning video (D-315). Three variants of seed 11 fill the
  envelope with an overlap of 0.89 to 0.94 at eight angles.
- **Bole and limbs.** The leader's control falls from 0.4 to 0.3 early in growth, and apical
  dominance is 0.7. The stem ends at a fifth to a third of the height. There five or six limbs
  leave it between 2.5 and 4.5 m. The first limbs' buds open at 70 degrees from their axis and
  rise only weakly toward the light, so they run out nearly level and fill the crown's low skirt,
  as the fact sheet says. The trunk is 1.4 m across at breast height.
- **Foot.** A flare, six uneven buttress lobes, nine flutes and short thick surface roots.
- **Shoots.** Three classes, by bud vigor. The one-year shoot of still 23 ends in a rosette of six
  leaves round a stack of seven brown buds. The two-year twig of stills 10 and 22 carries three or
  four rosettes. It holds 18 to 25 leaves. The three-year spray of still 21 carries about 78 leaves. Leaves
  average 11 cm, inside the fact sheet's 7 to 12 cm.
- **Leaf angles.** Leaves turn a third of the way toward the sky. Turned three-quarters, they stood
  edge-on from the references' near-level views, and the crown read as bare wood.
- **Counts.** A variant holds 6,200 to 9,300 shoots and 340,000 to 520,000 leaves.
- **Acorns.** In autumn three in ten shoot tips hang an acorn on a 6.5 cm stalk, nearly straight
  down, so it clears the leaf rosette.

### What a kit holds, and its cap

A page draws at one quality preset, so a kit keeps the shoot meshes of its own tier. It also keeps
the tiers below it, which the near band draws farther out. Card cells are 64 texels on every tier. At 64 and
128 texels the oak's cards draw alike at 20 m, nearer than any card shows. The High atlas falls
from 6.55 to 1.64 MB.

| Tier | Oak's kit | Tree cap |
| --- | --- | --- |
| Low | 1.75 MB | 2 MB |
| Medium | 2.67 MB | 2.9 MB |
| High | 4.96 MB | 5.3 MB |
| Ultra | 9.09 MB | 9.5 MB |

### Triangles near the camera

A shoot's twigs and buds cost as many triangles as its leaves. The low tier now meshes no buds and
one stem ring at each year's end. It draws a leaf as two triangles over its outline's bounds. The
texture's coverage cuts the leaf's outline. The medium tier draws a tip cluster of buds as one cone.
A three-year spray falls from 3,132 to 252 triangles at the low tier.

The shoots hand over to cards where a shoot spans 104 pixels, since the oak's largest shoot is a
0.85 m spray. The split then stands at 9.5 m at 1,080 pixels and 60 degrees. The per-species test
counts the triangles inside the near band at High, each row at its band's tier. Variants 0 to 2
draw 1.3 to 1.8 M, the worse of an eye beside the trunk and one at the crown's edge. The cap is 2.5 M. An eye inside the
crown sees more, and the near pool cuts its split nearer at run time.

| Level | Variants 0 to 2 | Cap |
| --- | --- | --- |
| First card level | 43,800 to 62,700 triangles | 150,000 |
| Second card level | 20,400 to 29,200 triangles | 30,000 |
| Variant, without the nearest wood | 3.0 to 4.4 MB | 7.1 MB |

### The nearest wood, and its cap

The fitted oak meshes every finest macro axis as real wood near the camera. Its nearest wood
outgrew the tree cap set before it. The owner raised the cap per tier from the oak's largest of
three variants, with about 15 per cent to spare. The per-species test holds the real oak under it
at every tier.

| Tier | Oak's nearest wood | Tree cap |
| --- | --- | --- |
| Low | 7.03 MB | 8.1 MB |
| Medium | 7.78 MB | 9 MB |
| High | 9.13 MB | 10.5 MB |
| Ultra | 11.67 MB | 13.4 MB |

The owner's reason: twigs must stay true to the tree's anatomy, and quality comes before size. A
page that needs fewer triangles sets the coarseness, which grows a coarser plant.

### Fixed plants

`placePlants` without a near pool draws each level of each variant as instance batches over its
band of distance. The first 16 copies of a species draw their real shoot rows, composed once at
setup, out to the split. Their first card level draws from the copy out and gives way to the
shoots, pixel by pixel, inside the split. Placements of one species share its 16 near slots.

### Cover at a distance

The GPU makes the card atlas's smaller copies by averaging, so a sparse shoot's coverage falls
under the cutoff a few levels down. The oak's distant crown then let through 42 per cent sky against
the turning video's 10. The plant shader now adds a quarter of a card texel's coverage back for
each level of the mip chain it reads. A leaf texture's mips keep their coverage when built (D-324),
so leaves read theirs plain. Over the turning video the sky fell to 19 per cent.
The crown's outline overlap rose from 0.56 to 0.70, and its leaf color difference fell from 6.8
to 3.9.

### The fitted outline's width

The crown came out narrower than the references at their wide angles. At each of 32 angles of the
turning video, three widths over height were set side by side: the reference's silhouette, the
fitted outline's and the render's. The render followed the fitted outline. The outline fell short
of the reference at the wide angles: 1.47 against 1.70 at 0 degrees.

The video's camera stands about 2 plant heights out, near the ground. At that range a crown's side
toward the camera is drawn larger, so this crown looks 14 per cent wider from one side than from the
other. The hull took every view as seen from afar. The fitting tool now bounds each point through
the camera's distance, and draws the outline through it to check the fit. Up close, the near side's
looming tells which way the video turns, so the hull is fitted both ways and keeps the better match.
The oak's video turns against its frames' order. A hull keeps only what every view allows, and the
generated plant jitters narrower in some frames. So the hull widens by the least factor that makes
its outline, drawn through the camera, as wide on average as the views. A steady plant needs none.

| Measure, mean of 32 angles | Reference | Fitted outline |
| --- | --- | --- |
| Whole silhouette, width over height | 1.53 | 1.53 |
| Crown box, as the review measures it | 1.76 | 1.71 |
| Whole silhouette at 0 degrees | 1.70 | 1.66 |

### Fruit at a distance

An extra stays on a card level only where its breadth spans at least 3 pixels at the level's start.
The breadth is what a far eye sees: an acorn's nut is 2 cm across, though its stalk makes it 8.5 cm
long. So acorns draw at the nearest level only. Drawn on the card levels, the autumn oak's fruit
had put the first card level at 228,000 triangles and the second at 183,000, against caps of 150,000
and 30,000. The per-species test now holds the autumn and blossom plants to those caps.

### Cuttings

An oak's branch and sub-branch stills show its three-year spray and two-year twig. Cut from the
grown plant, a piece that long is mostly bare wood of the finest macro order. So a record's branch
or sub-branch hint may name a shoot class, as its cluster hint does. The cutting is then one shoot
prototype from the kit, with its twigs, buds and leaves. The oak's branch is its spray, its
sub-branch its long shoot and its cluster its short shoot. A hint that cuts from the grown plant
still names a macro order and a length. Among the pieces it can cut, those with lit buds come first.
The record check refuses a hint that names a class the record does not grow.

### Faults fixed on the way

- The bole leaned and swayed in an S below its fork: each internode leaned 3 to 23 degrees, and one
  variant stood 0.5 m off its foot at 2.3 m. Below the crown the leader is drawn straight up toward
  the light, but the wander that crooks a crown's shoots still turned it at every node. The bole
  below the crown now grows on along its own line, so it leans 0 to 2 degrees.
- Where the leader weakened and a side limb took the light, the stem ended in a cone in mid-crown.
  After growth, an axis now runs on into a child where its own continuation collapsed under the
  child's girth. The old continuation becomes the side branch.
- Taken at any angle, those hand-ons chained into loops: one finest limb in ten turned back past a
  right angle, and the bole took a dog-leg of up to 61 degrees. Wood now runs on only into a thick
  child within 40 degrees of the axis's line that never turns back past a right angle. Where the
  thick child leaves more steeply, the axis divides there instead. Its withered continuation leaves
  the same node, and the mesher draws a fork whose limbs rise from the axis's last ring. The bole
  stands straight to its fork at 2.3 to 2.9 m, and no axis collapses into a cone.
- A cut branch's root is a limb with no parent, which the wood mesher skipped, so cuttings had no
  wood. A parentless limb now meshes plain, without the stem base's shaping.
- A real kit's cutting keeps its shoots as rows, so its twigs and buds draw. Merged into a foliage
  part, the shader could not tell them from leaves.
- The bark's tile count changed where the trunk narrows above its flare, and the pattern jumped
  sideways at mid-trunk. A stem's foot now keeps the count of the plain stem above it, and its
  plates widen over the flare.
- The demos keep drawing stand-ins, so registering the oak changes no demo picture.

## Options rejected

- **Thinner leaves to meet the triangle cap.** With fewer leaves the crown is more open than every
  reference shows. The coarse tiers' simplification keeps the leaves and drops what no pixel shows.
- **A higher clean bole.** Raised past a tenth of the height, it made some variants stop growing at
  3 m. The bole's height comes from the weaker leader instead.
- **Thinner twigs to keep the old wood cap.** A plainer mesh on the finest axes met the cap, but
  it made the twigs anatomically wrong. The owner refused it.
- **128-texel card cells.** They cost four times the atlas memory for no visible gain.

## Who decides

The owner sets the caps; the lead ruled the kit's tiers, the near band's budget and the coarse
tiers' simplification. The reviewer judges the oak against its references.
