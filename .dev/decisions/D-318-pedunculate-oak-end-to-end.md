# D-318: the pedunculate oak grows end to end from its own record, and fixed plants draw real shoots near the camera

Status: decided. The oak's species folder (`src/species/pedunculate-oak/`) and the placement of a
species' copies at fixed places (`src/render/static-shoots.ts`) are built. The oak draws in every
review view with its own textures. The wind records, the level distances and the far bake are
stand-ins until the near pool's package builds them. The owner's review of the oak against its
references is in progress.
Task: none.

Summary: the oak is the first real species. It grows four macro orders inside the envelope measured
from its turning video. Three shoot classes fitted to its studio stills carry 330,000 to 530,000
leaves. A kit holds its own mesh tier and the tiers below it, and the owner caps it per tier.
The coarse tiers mesh no buds and draw a leaf as one cut-out card. One copy draws at most 2.5 M
triangles inside its near band at High.

## Question

How is the oak's record fitted to its references, and how does a fixed oak draw before the near
pool exists? The plant core's design (D-305) gives the oak's growth, leaves, wood, material and
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
  leave it between 2.5 and 4.5 m, at 10 to 50 degrees. The trunk is 1.4 m across at breast height.
- **Foot.** A flare, six uneven buttress lobes, nine flutes and short thick surface roots.
- **Shoots.** Three classes, by bud vigor. The one-year shoot of still 23 ends in a rosette of six
  leaves round a stack of seven brown buds. The two-year twig of stills 10 and 22 carries three or
  four rosettes. It holds 18 to 25 leaves. The three-year spray of still 21 carries about 78 leaves. Leaves
  average 11 cm, inside the fact sheet's 7 to 12 cm.
- **Leaf angles.** Leaves turn a third of the way toward the sky. Turned three-quarters, they stood
  edge-on from the references' near-level views, and the crown read as bare wood.
- **Counts.** A variant holds 5,900 to 9,600 shoots and 330,000 to 530,000 leaves.
- **Acorns.** In autumn three in ten shoot tips hang an acorn on a 4.5 cm stalk.

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

The shoots hand over to cards where a shoot spans 72 pixels, since the oak's largest shoot is a
0.6 m spray. The split then stands at 8.7 m at 1,080 pixels and 60 degrees. The per-species test
counts the triangles inside the near band at High, each row at its band's tier. Variant 0 draws
at most 2.5 M, the worse of an eye beside the trunk and one at the crown's edge. An eye inside the
crown sees more, and the near pool cuts its split nearer at run time.

| Level | Variants 0 to 2 | Cap |
| --- | --- | --- |
| First card level | 37,600 to 61,100 triangles | 150,000 |
| Second card level | 18,500 to 29,700 triangles | 30,000 |
| Variant, without the nearest wood | 2.8 to 4.5 MB | 7.1 MB |

### Fixed plants

`placePlants` without a near pool draws each level of each variant as instance batches over its
band of distance. The first 16 copies of a species draw their real shoot rows, composed once at
setup, out to the split. Their first card level draws from the copy out and gives way to the
shoots, pixel by pixel, inside the split. Placements of one species share its 16 near slots.

### Faults fixed on the way

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
- **128-texel card cells.** They cost four times the atlas memory for no visible gain.

## Who decides

The owner sets the caps; the lead ruled the kit's tiers, the near band's budget and the coarse
tiers' simplification. The reviewer judges the oak against its references.
