# D-330: the pedunculate oak's crown is thinned by its own light, above a clean bole

Status: decided and built in the oak's record and the optional record fields behind its values. The
plant review's light and framing, the engine's box-fraction positions and level hand-over, and the
exact plant maths are built too. Seven of the owner's rulings are pending work, listed under
[Consequences](#consequences). Four options wait for the owner's choice, listed under
[Options the owner may still take](#options-the-owner-may-still-take). Task: none.

Summary: the head's far crown reads as an even dome, since its grower's light is nearly even and its
outline has no underside. The oak now drops the shoots that its own finished crown shades most, layer
by layer, and grows nothing below 0.175 of its height. Of its 35 reference files, 7 pass, 11 pass in
part and 17 fail, against 3, 6 and 26 for the head's oak.

## Question

The head's oak fills its fitted outline as an even dome, and growth fills the room under the dome
down to the ground. What makes the crown show the reference's masses, with sky between and under
them, above a clean bole? The answer must keep every budget and test, and it must not cut holes at
random.

## Rule

- A species passes only when every row passes on every reference picture
  ([plant review](../plant-review.md)). Row 6 is a band in both directions. The owner rejects a
  crown whose holes fall at random, as the clump field's do.
- Each new behavior sits behind an optional record field with a doc comment, a unit, a range check
  and a test. With the field absent, a plant grows as it did, so no other species changes.
- Every budget holds at every tier. The kit caps are 2.0, 3.1, 5.7 and 10.8 MB, and the variant
  budgets 9.4, 10.2, 11.3 and 11.6 MB. A variant grows in under 600 ms. The bole-and-crown,
  sharp-bend and shedding tests pass.
- The better look wins ([hard rule 40](../../AGENTS.md#hard-rules)).

## Data

### Why the head's crown is even

These figures come from `1b87b2641` on seed 11, variants 0 to 5. A script grew the oak through the
engine's own stages, and its rows match `growPlantNow` byte for byte on all six variants.

- The grower's light is flat inside the crown. A bud reads 0.70 at the top, 0.51 at 1 m down, 0.42
  at 2 m and 0.35 at 3 m. Below that it reads 0.24 to 0.36, down to 12 m. One bud's shade reaches 3 m
  down, and none falls to the side.
- So buds flush until the local light falls to that balance, wherever they stand: about one bud per
  cubic meter. In every tenth of the height from 0.3 to 0.9, 28 to 33 % of the 1 m cells hold a leaf
  center. 60 % of the leaf rows stand more than 2 m inside the outline.
- The outline has no underside. Its lowest fitted row, at 0.115 of the height, takes 85 % of the
  next row's width. The grower applies that row from the trunk out. Growth fills the room under the
  dome. The lowest leaf stands at 0.26 m on average, and 9 to 15 % of the leaf area hangs below the
  first fork.
- The head's see-through comes from the clump field, which leaves random patches of the crown bare,
  whatever wood they hold. The total sky gap passes, but the gaps stand in the wrong places. At 01
  the crown's top third holds 0.319 of its sky against the reference's 0.162, and its inner share is
  0.285 against 0.549.

### The choices

| Choice | Field and the oak's value | Pictures | Measured effect | Presses on |
| --- | --- | --- | --- | --- |
| Thin the crown by its own light | `shoots.placement.skyPrune` 0.42, in `skyPruneLayer` layers of 1 m | 01, 03, 05: sky through the crown's middle and under it | 0.34 to 0.42 raises the inner sky share of 01, 02 and 18 from 0.364, 0.362 and 0.395 to 0.445, 0.422 and 0.471. Off, the crown keeps 55 to 92 % more rows | Variant bytes, grow time |
| Trim the bare wood | `shoots.placement.bareTrim` 0.03 m of radius | 01, 18: no bare twigs under the crown | Off, the wood keeps 23 to 46 % more nodes, as bare twigs | Wood bytes |
| Floor the outline | `growth.floor` 0.175 of the height | 01, 02, 18: sky under the crown down to the fork | The sky gap against the reference's: 01 +0.001, 02 +0.039, 18 -0.034. Off, 25 to 593 more rows a variant | The bole-and-crown test, variant bytes |
| Shed the buds under the crown | `growth.shedding.underCrown` 1 | 01, 02, 17, 18 | The six variants' lowest buds rise from 0.03 to 1.41 m to 2.15 to 2.50 m | The shedding test |
| Feed the lit surface | `growth.light.surface` on | 01, 02: the top and rim carry the fullest shoots | 01's top-third share falls from 0.233 to 0.188 | Variant bytes at the low tier |
| Lift the shoots | `shoots.placement.lift` 15 degrees | 02, 03: the foliage rides on the limbs | At 30 degrees, the share of leaf area that hangs over 0.3 m below its wood falls from 0.156 to 0.055. 15 degrees keeps 02's sky gap in its band | Nothing measured |
| Big sprays on strong buds only | spray `vigor` 0.5 to 1, long shoot 0.04 to 0.5 | 21, 22: most shoots are twigs of a few rosettes | 01's center sky rises from 0.005 to 0.024, against the reference's 0.022 | Variant bytes |
| One side twig to a joint | `laterals` 3 on the long shoot and 1.6 ± 0.4 on the spray, `lateralGap` 0.3 | 21, 22 and the winter cut branch | The winter branch's fan share falls from 0.42 to 0.09 (reference 0). The crown's fan points fall from 10,947 to 0 | Kit bytes |
| Kinked twigs | `bend` 0.06 m at 34 degrees | The winter cut branch | With 5 cm pieces, kinks rise from 0.12 to 0.81 per ten twig widths (reference 1.04, pass from 0.52). The 6 cm pieces still pass, with fewer rings | Kit bytes |
| Rosettes of nine, held tight | `nodes` 9 ± 0.4, and the spray's tight internode curve | 09, 21, 22: 6 to 10 leaves a rosette, close at the twig's end | The tight curve takes the specks at 01, 02 and 18 from 32, 47 and 43 to 23, 31 and 31 | Kit bytes |
| A plumb bole | `growth.divide.plumb` 4 degrees | 17: the bole runs straight to the fork | The bole's bend below the fork falls from 5.5 to 13.2 degrees to 0, and its lean from 7.2 to 11.9 degrees to 1.0 to 4.3 | The bole-and-crown test |
| The photographs' girth | `size.dbh` 2.45 m, `growth.bending.girth` 3.5 m | 02, 18: the bole about an eighth of the height across | The trunk at 1.3 m falls from 4.81 m to about 2.5 m, and the wood bytes by 20 to 27 %. The crown sags as it did | The sharp-bend test |
| Named forms | `forms`: woodland and young | 30, 31, 32 | All three pass | Each form's kit within the species' budget, and finite positions in every variant |
| Density | `shoots.placement.density` 1.25, from 0.9 | The reference's cover without the clump field | Each 0.1 more closes the sky gap by 0.004 to 0.007 | Variant bytes |

The record also sets the tip buds, the acorns, the bark tint, the roots, the fork's elbow and the
lichen to their pictures. Each value's comment names the still it matches.

### The reference files

The worst judged row decides each label. "Head" is the head's oak, and "This record" is the oak this
record builds. The same review tool and slot file draw both. The color figures are
CIEDE2000, where about 2 is one visible step. The outline figure is the overlap of the two outlines,
with a guide of 0.75.

| Reference | Head | This record | Deciding figures |
| --- | --- | --- | --- |
| `01-whole-distant.png` | Fail | Partial | Outline 0.734; top-third sky 0.243 (at most 0.222); 17 specks (at most 9) |
| `02-whole-profile.png` | Fail | Partial | 7 loose pieces against the photo's 2; every crown measure passes |
| `03-whole-from-below.png` | Fail | Partial | Sky share 0.202 against 0.214; the limbs climb where the photo's spread almost level |
| `04-crown-outside.png` | Fail | Fail | Sky share 0.684 against 0.407: small tufts on thin twigs |
| `05-crown-underneath.png` | Fail | Fail | Sky share 0.139 against 0.305: few, dark leaves |
| `06-inside-crown.png` | Fail | Fail | Sky share 0.141 against 0.070; a smooth limb with no kinks |
| `07-limb-leaving-trunk.png` | Fail | Fail | The limb rises at about 45 degrees where the photo's leaves almost level |
| `08-limb-fork.png` | Fail | Fail | The arms part at about 40 degrees against 80 to 90, with no knot |
| `09-secondary-branching.png` | Fail | Fail | Leaf clusters crowd one side of the branch; the twig zigzags evenly |
| `10-fine-twigs.png` | Fail | Fail | Outline 0.332; sky gap 0.157 against 0.181 |
| `11-leaf-cluster.png` | Fail | Fail | Outline 0.499: a heaped bunch where the photo has one flat rosette of seven |
| `12-single-leaf-upper.png` | Fail | Fail | Leaf color 7.5; outline 0.835 |
| `13-single-leaf-underside.png` | Pass | Pass | Outline 0.831; leaf color 2.2 |
| `14-bark-base.png` | Fail | Fail | Flat, angular root slabs where the photo has thick, rounded roots |
| `15-bark-mid-trunk.png` | Partial | Partial | The ridges break into short blocks |
| `16-bark-on-limb.png` | Partial | Partial | Fine light streaks where the photo has rugged plates with lichen |
| `17-trunk-taper.png` | Fail | Partial | The bole runs as a cylinder above a sudden skirt |
| `18-silhouette.png` | Fail | Fail | Sky gap 0.118 against 0.152, 0.014 past its band |
| `19-acorns-on-stalk.png` | Fail | Partial | The stalk is about one acorn long against two, and the nuts are dull |
| `20-winter-branch-architecture.png` | Fail | Partial | Fan share 0.111 against at most 0.1; the other three branch figures pass |
| `21-branch-studio.png` | Fail | Fail | Outline 0.325: many small leaf groups where the photo has five or six big rosettes |
| `22-subbranch-studio.png` | Fail | Fail | Sky gap 0.135 against 0.258: one clump on a short stem |
| `23-leaf-cluster-studio.png` | Fail | Fail | Outline 0.472: many leaves where the photo has one rosette of five |
| `24-leaf-texture-upper.png` | Pass | Pass | Outline 0.964; leaf color 2.1 |
| `25-leaf-texture-underside.png` | Partial | Pass | Outline 0.832; leaf color 0.8 |
| `26-bark-texture.png` | Partial | Pass | Surface color 1.86 |
| `28-young-bark.png` | Pass | Partial | Edge directions 0.252 against the head's 0.057: the camera meets the limb on a slant |
| `30-woodland-form-whole.png` | Fail | Pass | Outline 0.666; sky gap 0.200 against 0.199 |
| `31-woodland-clean-bole.png` | Fail | Pass | A long, straight, branch-free bole |
| `32-young-oak-whole.png` | Fail | Pass | Crown box 186 x 252 against 180 x 241 pixels |
| `oak-turntable.mp4` | Partial | Partial | Mean outline 0.752, lowest 0.694; 176 of 193 frames inside the gap band |
| `oak-wind-motion.mp4` | Partial | Partial | Top band motion 0.048 against 0.072 |
| `branch-turntable.mp4` | Fail | Fail | Mean outline 0.308; too open in 109 of 145 frames |
| `subbranch-turntable.mp4` | Fail | Fail | Mean outline 0.353; too closed in 59 of 97 frames |
| `leaf-cluster-turntable.mp4` | Fail | Fail | Mean outline 0.460; no frame at the guide |

These runs cut the leaf cluster from the long shoot, so rows 11, 23 and the leaf-cluster turntable
show its sprig. [The owner's rulings](#the-owners-rulings) give the short shoot's figures.

### Budgets and grow time

At the low, medium, high and ultra tiers, the kit measures 1.753, 2.941, 5.585 and 10.699 MB. Its
caps are 2.0, 3.1, 5.7 and 10.8 MB. The ultra kit is at 99 % of its cap. The largest of seed 11's six
variants measures 7.19, 7.44, 7.75 and 8.17 MB, against budgets of 9.4, 10.2, 11.3 and 11.6 MB. Over
seeds 1 to 11, none of the 66 plants goes over its budget at any tier. A variant grows in 344 to 445 ms,
against the head's 408 to 531 ms.

How the data was produced: the reference rows come from `bun run plants:review pedunculate-oak
--refs <the oak's folder> --views whole,skeleton --slot-query
tools/lib/plant-review/slots/pedunculate-oak.json`, 629 frames in 119 pages. One run drew this
record's oak on the code of `162839fa`, which holds the oak and the review tool. That code comes
before the engine change, the exact maths and the leaf-cluster ruling. The other drew the head's oak, `96583613c` with the same
review tool. Both ran headless in Chrome for Testing on the Mac's GPU, at seed 11, variant 0 and
preset high, against the reference repository at `835524369`. Other review runs and tests shared the
machine.

The bytes are the generator's own sizes of the same tree, over all six variants, and over seeds 1 to
11 for the sweep. The grow time is the fastest of five growths a variant, in three rounds that
alternate with the head. The machine's load read 2.6 to 3.2. Each choice's figure is a trial against
the same crown without that change, under the same tool. The leaf-cluster figures compare the code of
`27b63cd0b` with that of `b166787de`, which adds the ruling. Each option's figures compare
`b166787de` with and without the option. Those runs drew only the stills and videos that the change
moves, by the same command, slot file and machine. The bole widths come from the foot test's own
width measure, over the six variants.

## Look

The crown thinned by its own light looks better than the clump field. Its sky falls between the limb
masses and under the crown, and the trunk shows to the fork, as 01, 02 and 18 show it. The clump field
cut holes inside a limb's mass and left loose tufts at the edge, and the owner rejected that look.
The floor at 0.175 keeps the drawn tree's width and its single crown piece. A floor of 0.17 with
larger far cards puts 18's gap inside its band, but grows a narrower tree.

## Decision

Take the choices in the table. The sky prune opens the crown where its own leaves shade it, so the
oak drops the clump field.

Rejected:

- **The clump field.** It strips rosettes in random patches, wherever the wood runs. The total sky
  gap passes it, while the top-third and inner shares fail.
- **A higher shade line on the grower's light.** That light is flat, about 0.3 inside the crown, so a
  line at 0.15 removes 4 % of the buds, and it spares every tip.
- **No side bud below level on a branch.** It gives the cleanest underside, with the lowest foliage at
  3.54 m. But it fails the bole-and-crown test at 20, 30 and 40 degrees, each time in another variant.
  Five of the six variants sit at the test's minimum of 3 great limbs.
- **The floor at 0.17 with far cards at 1.35.** Every sky band falls inside, and the crown's top swings
  0.096 of the height over a turn, against 0.131. But 02's outline overlap falls to 0.754 and its width
  over height to 1.55, against the photo's 1.78. The pieces rise to 4, 10 and 5, and variant 5 grows a
  broken fork.
- **A lift of 30 degrees.** 02's sky gap reads 0.1415, past the top of its band at 0.1408.
- **Fuller rosettes, eight nodes on the long shoot and the spray.** They give the cleanest far masses,
  13 specks against 33. But the kit grows 18 to 33 %: 7.07 MB against the 5.7 MB cap at the high
  tier.
- **Near-level limbs.** A division angle of 78 degrees breaks the bole-and-crown test: variant 5 keeps
  2 great limbs and grows a broken fork. The angle stays at 64 degrees until that test changes.
- **Leaves on this year's spray only.** 02's top-third share rises from 0.209 to 0.247, past its band.

### The owner's rulings

- The kit caps stay as they are.
- The engine reads a plant part's positions as fractions of the species box. A detail level stays
  whole until the next has faded in
  ([implementation notes](../implementation-notes.md#the-vegetation-add-ons-plants)). With both, 01's
  sky gap reads 0.018 above the reference's, still inside its band, and its top-third share passes at
  0.217. 02 and 18 do not move.
- The plant code grows with the core's exact maths in every browser, and the generator's version is
  '2'.
- The leaf-cluster cutting takes this year's short shoot, one rosette round its bud cluster, as 11 and
  23 show. The long shoot draws a sprig of two or three rosettes. By eye, 11 and 23 now show the
  photographs' subject. The short shoot takes 11's outline overlap from 0.499 to 0.566 and 23's from
  0.472 to 0.496, and 23's leaf color from 8.7 to 5.0. But the rosette is denser than the
  photographs': both sky gaps fall to 0.048 under their references, past the band. 11's leaf color
  rises from 2.4 to 6.1, and the leaf-cluster turntable's mean outline falls from 0.460 to 0.394. The
  view looks down on the rosette, so its stalk hardly shows, where the photographs show it below.
- The floor stays at 0.175. Most of the review judges seed 11's variant 0, while a game shows every
  variant. So the crown's swing over the variants is a stated fault.
- The clump field stays off the oak.
- The judging rules in [plant review](../plant-review.md) hold where the standard is silent.

### Options the owner may still take

Four changes wait for the owner's choice. Each stands alone, so any one can be taken.

- **The bole's taper.** `base.taper` of 0.25 over 4.5 m widens the bole all the way down from the
  fork into its foot, as still 17 shows. The woodland and young forms keep their own boles. Still
  17's edge-direction misfit falls from 0.078 to 0.073, the whole views move by 0.003 at most, and
  still 31 draws the same picture. The bole stands 3.00 to 3.06 m across at breast height, against
  2.56 to 2.61 m. That is 0.138 to 0.166 of the height, inside the photographs' 0.116 to 0.178. At
  0.3, variant 5 reaches 0.1704 of its height and fails the foot test's bound of 0.17.
- **A limit on the spray's side twigs.** `lateralMost` 65 on the spray turns back the twig that hangs
  down still 21's branch with a pale, edge-on rosette. Still 21's sky gap falls from 0.313 to 0.285,
  against the photograph's 0.326, and leaves its band. The branch's turning video keeps 35 of its 145
  frames inside the gap band, against 10, and its height spread comes inside its band. The whole
  views move by 0.002 at most.
- **Dormant buds at the twig kinks.** A `bend.buds` share puts a small bud at that share of a twig's
  kinks, as still 20's winter twigs show. At half the kinks the ultra kit reaches 10.865 MB, 0.065
  MB over the cap that the owner keeps. So the field would ship with no oak value.
- **The cameras of stills 11 and 04.** Still 11's cut piece may come as near the frame's sides as its
  photograph's piece comes. It then fills 0.945 of the width and 0.773 of the height, against 0.833
  and 0.691, where the photograph's fills 0.952 and 0.953. Its framed overlap rises from 0.398 to
  0.499. Still 04's rim view asks for a frame 0.85 full, not 0.55, and its sky share falls from 0.684
  to 0.311, against the photograph's 0.407. The 04 part is tuned on one tree, seed 11's variant 0:
  fill targets of 0.75 and 0.8 pick another limb, low on the rim.

## Consequences

- `core/record.ts` gains the optional fields, each range checked in `core/check.ts`, and
  `core/forms.ts` lays a named form over the record. The oak's `record.ts` sets the values, each with
  a comment on what it matches, and `species/pedunculate-oak/forms.ts` holds the woodland and young
  forms.
- The bole-and-crown test (`grow/leaders.test.ts`) reads every variant of seed 11. Five of the six sit
  at its minimum of 3 great limbs, so a change that moves side shoots can break one.
- The ultra kit is at 99 % of its cap. A change that adds leaves or rings to a shoot model needs a cut
  elsewhere.
- Only variant 0 at the high tier has a byte test. The sharp-bend test's cutoff is an absolute 0.1 m
  radius, so about 40 % of the wood it covered escapes it on the thinner trunk.
- Grow time reads over 600 ms on a loaded machine, the head's too. Judge it on a quiet one.
- Stated faults: the crown's top swings 0.131 of the height across a turn, averaged over the six
  variants, against the head's 0.09. Variant 4 swings 0.221, a high shoulder on one side. One growth in
  240, seed 10's variant 4, leans 6.04 degrees, where its bole runs on along a side shoot. One
  woodland plant in 240, seed 5's variant 5, grows 0.884 of its height across, against the forms
  test's 0.8. A fine twig runs far outside its outline.
- The shade prune and the tip line remove almost nothing that the sky prune does not remove too. With
  both off, a sky prune of 0.43 grows the same crown: rows within 1.8 %, leaves within 1.2 % and wood
  within 0.2 %.
- Pending work, by the owner's rulings, in order:
  1. Redraw the picture references that this record's changes move, on every tier of both sets. The
     oak's `plant-pedunculate-oak` comes first: it differs from the head's own drawing in 36.4 to
     36.7 % of its pixels. Then come the other plant pictures that the box-fraction positions move.
  2. Judge the bole-and-crown test's limb count over the variants, and keep "no limb carries over
     half the wood". Then raise the division angle 4 degrees at a time from 64, and read the crown
     top's swing over all six variants after each step.
  3. Make the sharp-bend test's cutoff relative to the trunk.
  4. Sweep the byte budgets over every variant at every tier in a test, and over several seeds in the
     heavy checks.
  5. Adopt the judging rules into the reference repository's rubric.
  6. Drop the shade prune and the tip line from the oak, with the sky prune near 0.43, once a review
     run confirms the crown.
  7. Fix the views into and under the crown, the cut pieces' rosettes, the leaf cluster's density,
     the roots and the silhouette, largest first.
