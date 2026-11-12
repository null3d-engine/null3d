# Plant review

A species is judged by a reviewer who wrote none of its work, against the reference set for that
species, row by row. This page states the standard, the twelve rows, the coverage rules and the
process. It also says how the review lights and frames each picture, the judging rules where the
standard is silent, and how to tune a crown. The plant references guide, `.dev/plant-references.md`,
says how each measure works and what it cannot see.

## The rule

A species is judged as though it will be seen close up. Its anatomy, its branch subdivision in three
dimensions, its leaf clusters, its bark and its crown have to match the real plant, because a viewer
will walk up to it. A render that reads as a tree from twenty meters and as a bundle of cards from
two has failed, whatever it looks like from far away.

A species passes only when its structure, anatomy, appearance and quality match every reference
picture it has. Not a majority, and not the ones that flatter it. One failing row fails the species.

A species must also resemble its reference from a distance, and that is judged on shape, not on
color. Put the two whole views side by side and compare the silhouettes: where the crown's outer edge
runs, how far the widest part sits below the top, how far the lowest limbs reach, what angle the
major limbs leave at, how much trunk shows before the first fork, and whether the mass is one dome, a
vase, a spire or a set of separate pieces. Two pictures can hold the same colors and the same share
of foliage and still be different trees. A pixel-difference figure or a color match is not this test
and never substitutes for it.

Each species needs at least twenty reference pictures, most of them taken near the plant. They cover
the whole habit at distance and in profile, the crown from outside and from underneath, the major
limbs where they leave the trunk, how a limb forks and how it subdivides again, the fine twig
structure, leaf clusters at the end of a shoot, single leaves on both faces, bark at the base, at
mid-trunk and on a limb, the trunk's taper and root flare, and the silhouette. The set also carries
turning videos and usually a wind clip.

## No piece hangs free

At every level and at every sparseness setting, every drawn piece is connected to the plant's body.
A leaf, twig, card or bough that loses its parent when a level thins or a share drops is either joined
back to the piece it belonged to or removed; nothing is left standing in the air.

This binds the generator and the reading. A level that thins its wood, drops its axes or thins its
cards must prune whatever loses its parent, so the drawn plant stays one connected body at that level,
and the unit tests hold that: a plant built at each sparseness setting has one connected component that
reaches its root, whatever its density. The reading counts the pieces as the row requires, and where a
picture shows a piece standing free, the shader and the generator are at fault whichever row is being
read; the picture fails, and the fault is a generator fault, not a row to judge.

## Sparseness and polygon count are different dials

Sparseness is about how much foliage and how many limbs the plant carries: a sparse plant has fewer
leaves and fewer limbs, and every one of them still connects to the trunk and the root. It changes how
much plant there is, never whether the plant holds together.

Polygon count is about how finely the plant is defined, not about how much plant there is. A dense crown
can be drawn with very few polygons, and then it looks blocky: its forms are coarse and its surfaces
faceted while its foliage stays as full as the photographs show. A high polygon count buys smoothness of
form: round trunks, blended joins and rounded leaf clusters, not density.

So a species is set twice: its density by what its pictures show, and its polygon budget by the target
its level must hold, with the blockiness that budget buys accepted at the distance the level is seen. A
coarse setting that thins the plant, or a density setting that changes how smooth it looks, has mixed
the two dials and is wrong.

Sparseness is where the connectedness rule shows first, because thinning is when parents are lost. A
sparse picture that scatters leaf clumps through air is a failed picture even where its density figure
sits inside its band.

## The branch structure

The silhouette is judged on how the branches fill the space, not only on the outline they trace.
The owner's ruling sets five points, and they bind every tree and every species in the catalogue,
including any species added later:

- **The sky is spread evenly through the silhouette.** Openings sit throughout the crown, in the
  share the species' own reference shows. Sky gathered into a few large holes in one place fails,
  and so does a crown with an open rim and a solid middle.
- **No branch ends bare.** A branch carries foliage at its end, or it is pruned away. A thin bare
  tip against the sky fails at any view, even when the recorded figures are inside their bands.
- **Bends are gentle and progress upward.** A branch curves as it grows, and each bend carries it
  up and out from the trunk. An odd kink, a bend back toward the trunk, or a zigzag between joints
  fails.
- **The branch count fits the species.** Too many branches and subbranches fill the crown with wood
  the plant does not have; too few leave it thin. The reviewer counts the visible limbs at the
  skeleton view against the reference, and the subbranch orders at the crown close-up.
- **Laterals are spaced along their parent.** Subbranches leave the parent at separate points, with
  a clear gap between one and the next. Several laterals from one point, or a crowd of them within
  one internode, fails unless the species shows that clustering. Most trees carry one lateral at a
  node in a spiral, or a pair at opposite nodes, and do not bunch their subbranches; a tiered whorl
  is natural in a conifer, and clustered shoots in some shrubs. Even spacing carries the crown's
  foliage with less wood, so a crown that reaches its density by crowding laterals fails this point
  as well as the row 6 reading.
- **The structure is balanced through 360 degrees.** Branches and subbranches are spread around the
  trunk in every direction, so the tree reads balanced from above and from the side. One heavy side
  and one thin side fails, even when the foliage's outline is regular.

The rows carry the points:

| Point | Judged on |
| --- | --- |
| even sky through the crown | row 6, with row 12's plausibility |
| no bare termination | row 12, subdivision and no strays |
| gentle upward bends | row 7, with row 1's limb angles |
| branch count | row 2 |
| lateral spacing along the parent | row 2, with row 12's neatness |
| balance through 360 degrees | the coverage rule below |

A species that fails a point fails the row that carries it.

## The twelve rows

| # | Row | What is judged | Evidence |
| --- | --- | --- | --- |
| 1 | Structure | The skeleton: one stem or many, where the first limbs leave, the angles they leave at, how they fork, where the crown begins, and whether the silhouette is one solid shape or a set of pieces | The whole view against its reference, plus the skeleton view |
| 2 | Branch density | How many branches there are, how they are spaced along the trunk and along each parent branch, and whether the spacing follows the species: whorled tiers for a conifer, alternate for a broadleaf, a fan for a palm | The skeleton view, counting the visible limbs and their gaps along each parent |
| 3 | Branch length and taper | Whether a branch reaches far enough before it forks, and whether it thins along its length | The skeleton view and a close view of a limb |
| 4 | Leaf shape | The painted silhouette of one leaf: entire, toothed or lobed, its proportion, its tip and its base | The leaf close-up against the reference leaf picture |
| 5 | Leaf cluster density | How many leaves a cluster carries, how tightly they sit, and how a cluster meets its shoot | The leaf close-up and the crown close-up |
| 6 | Foliage density and see-through | How much of the crown's volume the foliage fills, and how much background shows through the crown at the default whole view. A crown denser than its reference fails, and so does one more open than the species is; the reference's own openness is the mark, in both directions | The whole and crown views against the reference's own openness, with the sky gap beside each |
| 7 | Bark curviness | Whether the trunk and the limbs run straight, bend or curve, and whether the bark's surface reads as its own species | The skeleton view, and the trunk and limb close views |
| 8 | Bark color and texture | Whether the bark's color and figure match the species, or whether it is generic tinted bark | The trunk at close range: base, mid-trunk and limb |
| 9 | Proportions | Height against width, the crown's share of the height, and the trunk's diameter against its height | The whole view, measured rather than eyeballed |
| 10 | Color and season | Whether the foliage's color is the species' own, and whether a season variant is a variant of that color rather than a different hue pretending to be one | The whole view |
| 11 | Distinctness | Whether the species can be told from its nearest neighbor in the catalogue by silhouette alone | The two whole views side by side |
| 12 | Plausibility, neatness and pattern | Whether what is drawn is a plant that could exist: every part joined to the wood it grows from, every order dividing into the next, no stray twigs, no parts crossing where no plant crosses, no scatter of loose shapes, and a branch pattern the eye can follow through the crown | Every view, and the whole view at close range |

Row 11 is judged against a built neighbor, named in the verdict. A species with no built neighbor
states that instead of passing.

Row 6 is read from the sky gap: the share of the crown's own box that shows background, measured on
both pictures at each whole view. A plant with no bare stem below its foliage, such as a sedge or a
hosta, runs as wide at its foot as through its mound, so its crown's box is its whole box. A
photograph whose lowest boughs sweep beside the stem can read as such a plant. Where the row's outer
span hides the stem, the tool reads the stem's own central run and puts the crown's foot above it. The
reviewer writes the render's figure beside the reference's for
every whole view. The row passes when the render's sky gap is no more than five hundredths above its
reference's and no more than two hundredths below it. The small allowance below covers the measure:
a reference outline comes from color against a plain background and can lose its thinnest foliage.
Anything more closed than that fails, and so does anything more open than the species. A crown
denser than its reference is as much a fail as a thin one. The eye is the judge and the figure is
the check: when the two disagree the reviewer says so and names which it followed. The figure
measures the share of sky, not where it sits: a crown whose openings gather in a few large holes
fails under the branch structure section, whatever the share reads.

Row 12 carries a checklist, and one entry on it fails the row. The reviewer writes the entry's
picture beside it:

- **Connectivity.** Every limb, twig, leaf, bud, fruit and root meets the wood it grows from, with
  nothing between them. A part that hangs from nothing is the clearest case; a twig that springs
  from the middle of another without a join is the same fault.
- **Subdivision.** A branch of one order divides into smaller orders. Those divide again, down to
  the twigs that carry the leaves. A limb that ends in a stub fails. So does a twig that carries
  nothing, or a jump from a thick limb straight to a leaf cluster. A branch that ends bare fails
  wherever it shows, inside the crown as well as outside it.
- **Neatness.** The wood runs as limbs, then branches, then twigs, each clearing the last. A tangle
  of parts crossing at odd angles is not a plant. It is the meshes laid over each other. It fails
  however well the silhouette scores.
- **Readable pattern.** A viewer traces the branch pattern through the crown: the limbs into their
  branches, and the branches into the twigs that carry the leaves. The pattern is the species' own,
  alternate, opposite, whorled or tiered, and it repeats in a way the eye can follow. A crown that
  reads as an even green mass, with no branch pattern to find, fails. So does a crown whose pattern
  is visible but irregular, one limb to the next with no order.
- **No strays.** Nothing thin and bare stands outside the foliage at a whole view. A viewer at
  twenty meters sees a crown, not whiskers. The reference photographs show none, so a render that
  shows them has drawn something the plant does not have.
- **No scatter.** The parts read as one plant. A picture that looks like a pile of loose shapes,
  however correct each shape is, fails on this row.
- **Plausibility of the whole.** Set the render beside its reference. Ask whether a person who knows
  the species would accept it as that species grown, not as a model of it. If not, name the first
  thing that gives it away, in the owner's own terms.


## Coverage

A plant's appendages are spread around its three dimensions in equal proportion, so that turning
around it never shows a lopsided tree. Its branches are spread the same way: branching and
subbranching run through 360 degrees around the trunk, so the tree reads balanced from above and
from the side, not only in outline. A crown that is full from the front and thin from the side, or
a set of limbs that all leave in one plane, fails even when every other row passes, because a viewer
walks round it.

The exception is a plant that is normally lopsided. It is named per species and never assumed: a
wind-sculpted tree, a willow leaning over water, a plant grown against a wall. A species claiming the
exception says so in its record and says why.

The same species is drawn at eight equal angles, and two figures are measured at each.

- **The crown's box is the rule.** Its width and height are the widest and tallest run of foliage in
  the picture, measured per angle. The largest and smallest of each must fall inside a tolerance that
  the growth form sets: 15 per cent either way for a conifer, 25 per cent either way for a broad dome
  or an open crown. A species of another form takes the broader band unless its reference shows a
  regular outline.
- **When the reference is less regular than the band, the reference sets the band.** A render more
  regular than its own reference is not a fault. The reviewer states the reference's spread beside the
  render's whenever it uses this.
- **The foliage area is a note, not a pass mark.** It says how solid the crown reads from each side.
  It moves with the orientation of the cards rather than with the plant's balance, so an open crown's
  area swings widely while its outline does not.

Every reference file must be compared, at its own angle for a video. A run that leaves a file
undrawn fails the species for coverage, whatever the rows say.

## Light and framing

A comparison is fair only when the render stands in its photograph's light and framing. The
[review tool's guide](../tools/lib/plant-review/README.md) lists the page's fields. These are the
rules that set them.

- Each daylit picture is lit as its photograph is lit. The sun stands where the photograph's shadows
  put it (`sunAzimuth` and `sunRise`).
- The sky's strength comes from the photograph's own sky: pi times the luminance of the sky pixels in
  its upper half. This calibrates the light to the picture, since a photograph's tone curve squeezes
  a bright sky more than the plant.
- The sun's strength is a chosen prior from the photograph's shadows, as a multiple of the sky's
  light on a level face. Hard sun takes 5, haze 1.8, and shade or overcast 0.5. The photographs'
  trunks stand in crown or wood shade, so their lit and shaded bark cannot measure the sun. A prior
  stands in for that measurement.
- A picture whose upper half shows under 5 % sky and no clear shadows keeps the page's own light.
  Studio, copy-stand and silhouette pictures keep their own lights.
- A view up the stem stands its camera at a person's eye height. A plant shorter than a person
  stands under that height, so the camera drops to a third of the plant's height, and the crown
  still stands above the lens. Without the drop the view looks over the whole plant at the sky.
- The turning videos and the wind clip keep the light beside the camera, as the reference videos
  keep it. The oak's turntable holds its light about 9 degrees right of the camera and 41 degrees up
  in every frame. A sun fixed in the world would light half of each turn from behind.
- A video's frames are drawn at a still's size, with the sun's shadows, and measured at a still's
  work width. A turn frame and a still from the same camera then agree within 0.0014 in sky gap.
  Frames 480 pixels wide draw a farther detail level, and read the oak's crown about 0.025 more
  open.
- The slot file holds each picture's own page fields, keyed by the reference file's name. They are
  its light, and any framing or backdrop that its photograph needs. Pass it with
  `--slot-query <file>`, and draw both sides of a comparison with the same file. The oak's is
  [`slots/pedunculate-oak.json`](../tools/lib/plant-review/slots/pedunculate-oak.json), so its
  review runs as
  `bun run plants:review pedunculate-oak --refs <the oak's reference folder> --slot-query tools/lib/plant-review/slots/pedunculate-oak.json`.

The light moves the color figures, not the outlines, which come from a matte. Under the page's soft
daylight the oak's distant leaves read 8.9 color steps from their photograph. Under the photograph's
own light they read 1.9, and the head's oak reads 2.2, so the light makes most of that gain.

## Judging rules where the standard is silent

- A cut branch's density is judged against a picture of the same piece at the same scale, by four
  figures. The wood per tip and the tips per area must fall within a quarter of the reference's. The
  share of fan joints, where four or more twigs leave one point, may stand at most a tenth above it.
  The kinks must reach at least half of the reference's.
- The oak's winter branch is judged on the cut branch of the winter oak's own set. Still 20's outline
  is void. It shows a limb end about 35 cm across, and a limb that enters the frame's side reads as a
  horizon.
- The trunk's width is judged on the reference pictures, not on a fact sheet that disagrees with
  them. The oak's photographs stand its bole 0.116 to 0.178 of the height across at breast height.
  The fact sheet's 1.5 to 2 m is the width at the flare.
- Where the standard gives no band, the judge takes working bands. A color difference passes at 3
  or less, where about 2 is one visible step. A view with no outline passes when its sky share lies
  within 0.05 of the reference's.
- A video is judged on frames drawn at a still's size, lit beside the camera, as the light rules
  above say.
- A close view of one kind of wood is judged only once its frame holds that wood. A camera that
  picks its own subject can draw a great limb where the photograph shows a young branch, and the
  color figure then measures the wrong material whatever its value. The alder's young-bark picture
  read 16.13 while it drew a great limb's old plates; setting the slot's `thin` to the photograph's
  own branch size and its `span` to the photograph's width took it to 3.7 before any material
  changed, and a tint measured against that frame took it to 2.3. Framing first, material second:
  a tint chosen before the frame is right measures the camera, not the plant. A ground plant's
  flowering heads are drawn as one stem's hanging spikes, seen close and level, because a twig view
  has no woody stem to frame and falls back to the whole plant. A picture that lifts the plant from
  the ground grows its soil and stands the plant on its lowest root, so a lifted whole plant shows
  the root ball its photograph shows; a lifted whole picture may also look up from below, where the
  crown's arch would otherwise hide the roots.
  sheath, collar or ligule picture is drawn as one tiller's sheath column at the photograph's span,
  or as the species' own tiller cutting where the photograph shows a cut stalk, because a bark view
  has no stem to frame and falls back to the crown's foot culms. A plant that flowers at its crown,
  such as a cactus, is framed on the ring of flower sites at its stem's top, not on a single shoot
  tip and not on the plant's middle.

## What a reviewer must see for the picture-judged rows

Seven rows are judged on a picture, not only on a band: 1 structure, 2 branch density, 3 branch
length and taper, 5 leaf cluster density, 7 bark curviness, 11 distinctness, and 12 plausibility,
neatness and pattern. Rows 4, 6, 8, 9 and 10 carry a numeric band, and their picture check is named
beside the band.

For each picture row the reviewer writes three things: what must be seen, which reference picture it
is set beside, and what makes it fail. The same three apply in the same way at every round. The
standard picture map:

| View | Reference pictures |
| --- | --- |
| Whole plant | `01` distant, `02` profile, `03` from below, `18` silhouette, and any other whole view in the set |
| Wood and joins | `07` limb leaving the trunk, `08` limb fork, `09` secondary branching, `10` fine twigs, `17` trunk taper |
| Leaf cluster | `11` field cluster, `23` studio cluster |
| Cut piece | `21` branch, `22` sub-branch, and `09` and `10` where the species uses them |
| Single leaf | `12` upper, `13` underside, `24` and `25` texture sources |
| Bark | `14` base, `15` mid-trunk, `16` limb, `26` and `28` texture sources |
| Season and marks | `19` fruit, cones or keys; `20` the species' own mark, such as roots, a skirt, thorns or a scar |

| Row | Must see | Beside | Fails if |
| --- | --- | --- | --- |
| 1 Structure | The species' stem count and habit, where the first limbs leave and at what angle, the crown base, and one solid silhouette or the reference's own piece count | `01`, `02`, `18`, and `03` where it exists; the skeleton view for the wood alone | The habit differs, the limb angle or arrangement differs, the crown base leaves the reference's, or the silhouette breaks into more pieces than the reference's |
| 2 Branch density | The count of visible first-order limbs and their spacing: whorled, opposite, alternate, spiral or a fan | The skeleton view; count on `03` and the whole views at a matched framing | The count leaves the reference's visible count by more than a quarter, or the spacing is the wrong pattern |
| 3 Branch length and taper | A branch reaching far enough before it forks and thinning along its length; a cut piece with the photograph's side shoots and scale | `07`, `08`, `09`, `17`; the cut pieces `21` and `22` | The branch forks too early or late, the taper is wrong, the piece is one leafy stem where the photograph has side shoots, or the piece is at the wrong scale |
| 5 Leaf cluster density | The photograph's leaf count, the cluster's spread and tightness, the terminal bud where the species has one, and one joined piece | `11`, `23`, and `04` for the crown close-up | The count differs beyond the photograph's own spread, the gap leaves its band, or the cluster breaks into pieces |
| 7 Bark curviness | The stem plumb or bending as the species does; the surface's own figure, such as plates, strips, lenticels, a sheath or fibres; the collar and the fork | `03`, `05`, `07`, `08`, `14`, `15`, `16`, `17`, as the species has them | The stem is kinked where the reference is straight, the limb angle is wrong, the surface reads as generic bark, or the join is hard |
| 11 Distinctness | A silhouette that differs from the named built neighbour in aspect, fork height, crown form or branching | The species' `01`, `02`, `18` beside the neighbour's whole view | The two share the neighbour's aspect, fork or crown, and only the leaf differs; or the row is passed with no neighbour named |
| 12 Plausibility, neatness and pattern | Every part joined to its wood; each order dividing into the next; no crossing; a readable species pattern; no bare strays; no scatter | Every view; the species' own review names the pictures where its fault shows | Any one entry of the checklist fails |

**A picture that cannot show the subject decides nothing.** A bark view with no bark, a cut turn
whose crown box is void, a silhouette with no recorded angle, or a piece at the wrong subject is
stated as a slot limit. It is not used to pass or fail the row. A row fails when a picture that can
show the subject shows the fault.

**A same-angle conflict is a reference conflict; a cross-angle comparison is not.** When two
reference pictures disagree, read the turn each is drawn at. Compare only figures at the same turn,
and intersect their bands. A figure at turn 0 and a figure at turn 90 do not bind one projection.
The meadow grass's row 6 is a true same-angle conflict: both pictures draw at turn 0 and their bands
do not intersect. The alder's row 6 compared a turn-90 profile with a turn-0 silhouette; the bands at
one turn do intersect, and the silhouette was the outlier against the species' own turntable.

**A per-still choice may pick a different subject; it may not rotate the tree.** A slot may draw a
different shoot for a still whose photograph shows a different shoot, as the hawthorn's second
prototype did. It may not move one tree to a view its photographs never show: the camera turn is the
comparison's basis, not a species input.

## What a fail looks like

Each of these is a fail on its own, and each is a fault an earlier standard let through.

- A crown whose silhouette is a different shape from the reference's, whatever the foliage does.
- Limbs that bend or fork differently from the reference's.
- Cards visible as cards at close range, or a branch that reads as a bundle rather than a limb.
- A trunk of the wrong proportion or taper, or a bark figure that is a pattern rather than bark.
- A leaf, a bud or a shoot twice the size the species has. A record value moved to win an outline
  or color figure can leave a plant that scores well and is not the plant. Check the value against
  the species' own size in the reference's leaf picture, not against the figure it improved.
- A part that hangs from nothing. A fruit, a flower or a catkin must meet the wood it grows from, in
  the record and in the picture. A part that floats has a sound outline, color and edge mixture, so
  no single figure catches it: the reviewer looks at what it is attached to and says so.
- **A thin bare twig or branch standing outside the foliage at a whole view.** The reference
  photographs show a crown; a render that shows whiskers around it has drawn something the plant
  does not have. This fails row 1 and row 3, whatever the silhouette figure says.
- **A crown thinner than its reference.** Foliage density is a band, not a floor: a crown that shows
  more sky than its reference fails row 6 even when every other figure passes. A viewer reads a thin
  crown as a sick tree, and the species' own density is the mark.
- **A crown that hides more background than its reference.** The other side of the same row. At the
  default whole view the reference lets the background show through it: sky between the limbs, and
  light between the leaf masses. A render whose crown closes into a solid dome shows less of the
  background than the reference does, and fails row 6, however well its outline scores. Being denser
  than the reference is not a pass by itself.
- **A crown with no pattern to follow.** The reference's own branch pattern is visible through the
  foliage: a viewer sees limbs, then branches, then twigs, in an order that repeats. A render that
  reads as an even green mass fails row 12 on the pattern, even when every limb is joined and every
  order divides: the plant is orderly, and the order cannot be seen.
- **A tangle where the reference has a structure.** The winter branch is the test that catches it:
  the reference is one limb dividing into smaller branches, those into twigs, and the twigs carrying
  buds, each part clearing the last. A picture of parts laid over one another at odd angles fails
  row 12 on neatness, however plausible each part is alone.
- **A picture that looks like a pile of loose shapes.** Set it beside the reference and ask whether
  a person who knows the species would take it for that species grown. If not, it fails row 12, and
  the reviewer names the first thing that gives it away.

## What a rebuilt leaf changes

A leaf texture built upside down can pass by accident. The reviewers' proportions and a half turn of
the still can line up with the picture. A leaf still then reads well without the leaf being right.
When a species rebuilds its leaf upright, expect its leaf stills to move in both directions. Read
that movement as the measure catching up, not the plant changing.

The silver birch rebuilt its leaf upright and stays at 8 of 12. Row 6 passes with the sky lever at
0.4. Its three whole views read 0.18/0.21, 0.17/0.17 and 0.20/0.19 against their photographs. Its
pictures 12 and 13 rose from 0.48 and 0.15 shape overlap to 0.72 and 0.64. Pictures 24 and 25 fell
from 0.88 and 0.79 to 0.72 and 0.54. The two that fell had been measured through the inverted leaf and a
half turn that happened to match. Row 4, the row those four stills carry, still passes at the new
figures. The fall costs no row, and the species stays at 8 of 12.

## What a crown fill costs

A rebuilt leaf can leave a crown too open, and a fuller crown is the obvious answer. It carries a
price, and the picture guard measures it.

The willow rebuilt its leaf upright, then three fills were tried. Their near bands read 2,138,953,
1,818,093 and 1,442,596 triangles at densities 5.6, 4.4 and 2.9. They read about 700,000 before
the rebuild. The fills at 5.6 and 4.4 were dropped once the software guard was at risk. Neither was
given a quiet run. The 2.9 fill is the one kept, because it is the one proved inside the guard.
Three software tiers drew in 1.8, 1.8 and 1.0 minutes.

Row 6 is a stated limit at every fill. Two measured attempts at the rebuilt leaf leave picture 01
above every reference, and picture 18 four hundredths past its band. The fuller fills were never
proved inside the guard. No fill wins a row, so the guard alone decides.

The guard was nearly blamed for stale pictures. Three software tiers reported "no result within
120 s" while the machine carried other work. The same tiers drew inside two minutes once it was
quiet. Each failure had been a comparison against a stale reference, which reads alike in a
summary line. A timeout is not evidence of a plant's cost until the run has a quiet machine and its
own failure line is read.

## When a lever fails its own row

The hosta's last attempt is a clean case of a lever that fails the row it aims at and costs another.

Its from-above view read 0.0049 against a floor of 0.0496. That floor is its photograph's own
reading, 0.0996, less half a tenth, which is the allowance row 6 gives every view. The three side
views sat inside their bands. Cutting the leaves from nine to seven per eye raised the
from-above view to 0.0204. The sides stayed inside at 0.1445, 0.1543 and 0.1419 against 0.1098,
0.1262 and 0.1171. The top still needed 0.0292, and the sides had only 0.0153, 0.0219 and 0.0252 of
ceiling left.

The same cut dropped three shape overlaps, from 0.7391 to 0.6835, 0.5848 to 0.5384 and 0.8017 to
0.6988. It also returned a second piece to the whole-with-landmark view. So it was reverted, and nine leaves
stand. Row 6 is a stated limit carrying those figures, the lever and the cost. The species stays
at 5 of 12.

A species' result lands with its own range. A record that trails its pictures by a range leaves the
next reader unable to tell what those pictures show.

## When a figure is void

Some figures cannot decide a row. The reviewer says so and quotes the figure that survives, rather
than turning a fault of the measure into a pass or a fail.

- **A cutting view's gap when the crown box covers a leaf patch.** The crown box starts where the
  crown starts. The tool finds that row in `crownStartRow` in `tools/lib/plant-review/references.ts`,
  by looking for a bare stem under the foliage. A cut piece has foliage down to its foot, so the box
  can land on a dense leaf patch. The gap is then read inside that patch. Three cases so far: the
  common alder's two cluster stills, the hawthorn's studio cluster, and the silver birch's
  branch-studio piece 21. On the birch the box fell from 186 by 284 pixels to 25 by 46. The piece's
  own box and rows did not move, on a mask change of eleven per cent. The outline overlap and the
  piece count survive such a move, and they are what to quote. The fix is tool work in that file,
  not species data. M3-V4 carries the debt, because the review rows are its evidence, while the code
  lives under `tools/`.

## The central-run crown start's reach

A row's central run is the stem where its boughs stand apart from it. The crown start reads that run where the row's outer span is wider than half the plant's widest row. A reference whose boughs sweep beside the stem moves; a reference whose outer span is the stem does not. The change is `3972fd3cc`.

The mound guard is `36fe37843`. A species the record grows as a tuft or a rosette keeps the outer span, and its crown starts at its foot. The sedge's 25 in-use stills, the hosta's 26 and the meadow grass's 25 are byte-identical before and after the guard. The oak's 30 are byte-identical too.

The in-use references that still move, by species, their number and the start before and after. The figures follow the review's reference path: each picture is flattened onto white before its mask:

| Species | References that move |
| --- | --- |
| agave | 02 0 to 0.0345, 09 0 to 0.019 |
| apple-tree | 02 0 to 0.2607 |
| bamboo | 17 0 to 0.0266, 26 0 to 0.0566 |
| banyan | 02 0.0042 to 0.2881, 08 0 to 0.2857, 18 0.0041 to 0.0248 |
| bracken | 01 0 to 0.1084, 18 0 to 0.033 |
| cedar-of-lebanon | 14 0 to 0.0338 |
| clipped-box-hedge | 17 0 to 0.0938, 19 0.0031 to 0.0453 |
| coconut-palm | 09 0 to 0.0696, 14 0.0057 to 0.0324 |
| common-alder | 01 0 to 0.0493, 09 0.0042 to 0.0063 |
| common-ash | 10 0 to 0.1135, 14 0 to 0.0269, 15 0 to 0.0203 |
| common-juniper | 04 0 to 0.0073, 10 0 to 0.0449, 18 0.0106 to 0.2624 |
| douglas-fir | 10 0 to 0.0178, 14 0 to 0.0136, 17 0 to 0.0356 |
| english-elm | 10 0 to 0.0247, 19 0 to 0.0456 |
| english-yew | 18 0 to 0.0544 |
| eucalyptus | 14 0 to 0.1024, 19 0 to 0.163 |
| european-beech | 02 0 to 0.1086, 15 0 to 0.0266, 18 0.0028 to 0.1567 |
| european-larch | 03 0 to 0.0769, 05 0 to 0.0191, 19 0 to 0.1212 |
| fan-palm | 11 0.0102 to 0.0969 |
| flowering-cherry | 04 0 to 0.0267, 17 0.0016 to 0.0125 |
| giant-sequoia | 11 0.005 to 0.2137, 14 0.0029 to 0.0172 |
| hawthorn-shrub | 04 0 to 0.1096 |
| holm-oak | 20 0 to 0.0254 |
| horse-chestnut | 04 0 to 0.0179, 08 0 to 0.0537, 14 0 to 0.0027, 15 0 to 0.0078, 17 0 to 0.0224, 19 0 to 0.0153, 28 0.0769 to 0.1538 |
| italian-cypress | 09 0 to 0.0141 |
| japanese-maple | 04 0 to 0.008, 15 0 to 0.0094 |
| lavender | 10 0 to 0.0575 |
| live-oak | 01 0 to 0.1524, 06 0 to 0.0068, 16 0 to 0.0103, 18 0 to 0.1481 |
| lombardy-poplar | 04 0 to 0.0357, 07 0 to 0.0109, 14 0 to 0.0076, 15 0 to 0.0187, 16 0 to 0.0203, 17 0 to 0.0109, 19 0 to 0.25 |
| london-plane | 20 0 to 0.0266 |
| norway-maple | 14 0 to 0.0054, 15 0 to 0.0797 |
| norway-spruce | 02 0 to 0.0673, 03 0 to 0.0782, 31 0 to 0.0459 |
| oleander | 03 0 to 0.0043, 19 0 to 0.0607 |
| olive | 14 0 to 0.0081 |
| quaking-aspen | 16 0 to 0.0259, 30 0.0034 to 0.0952, 31 0 to 0.3284 |
| rush | 05 0 to 0.2984 |
| saguaro | 25 0 to 0.0382 |
| scots-pine | 04 0 to 0.0506, 17 0 to 0.0352 |
| silver-birch | 14 0 to 0.0216, 34 0 to 0.0453 |
| small-leaved-lime | 15 0 to 0.0187 |
| stone-pine | 14 0 to 0.0128 |
| tree-fern | 07 0 to 0.0175 |
| weeping-willow | 01 0.0034 to 0.055, 09 0 to 0.0156, 18 0.0033 to 0.32, 31 0 to 0.0289 |
| winter-oak-bare | 14 0 to 0.0918 |

A cut piece's subject crop sets its crown bottom. The crown-start move does not reach such a picture: the sequoia's `11` keeps its box 506×596 and its figures, and the raw reading above is not its row figure.

The affected owners are told. The beech and the alder were told first; the oak keeps its figures.
## The rows a species still owes

**M3-V4 is ticked, and it carries 67 of the 78 owed rows: the 17 engine items and 50 of the limits.
Its tick does not cover them.** A reader who meets that task in a list sees a tick; this section is
the only place that says most of the batch's remaining work sits behind it.

A batch leaves 78 of its 144 look rows unpassed. Classed by what would move each one: **17 engine
items, 5 recorded reference conflicts, 54 measured limits and 2 void by ruling**.

The 17 engine rows are named to their work and to the task that carries the fix. All seventeen are
M3-V4's: ten in the package's own code, and seven in the review tool, which M3-V4 carries because the
review rows are its evidence.

- **The shared crown shade**, four rows: the birch's, holm oak's, hosta's and sedge's whole views.
  The term lives in the package's crown model.
- **The joint surface the engine does not draw**, three rows: the birch's and beech's winter wood
  and the willow's cut pieces. The wood geometry is the package's.
- **The cut-piece crown box**, five rows, in `crownStartRow` in
  `tools/lib/plant-review/references.ts`: the hawthorn's rows 3 and 12, the willow's row 3 and the
  hosta's rows 3 and 12. The code is the review tool's; the debt is M3-V4's.
- **The flower fix**, one row: the hawthorn's row 10, where its blossom draws nothing. The extras
  builder is the package's.
- **The matte tool change**, two rows: the alder's rows 3 and 12, where a cut piece's groups and
  pieces are read from the matte. The code is the review tool's; the debt is M3-V4's.
- **The coupled stem**, two rows: the sedge's rows 9 and 10. The generator couples the stem to the
  leaf.

A row with both a record lever and an engine blocker is classed by its next available lever. That is
why the limit count is large and the engine count small. Four of the 54 limits also name an engine
work as their next lever. All four are the bark color: the birch's, the holm oak's, the alder's
plain pair and the bracken's. That next lever is the bark's shared shading, which belongs to the
materials task M3-V7. So those four are the only owed rows outside M3-V4's debt. The other 50 name a
record value already spent, which is what makes them limits.

The per-row list, with each figure, sits in the maintainers' batch handoff, which is not kept in the
repository. This section is a summary of that record, not a second copy of it.

## What the reviewer reports

For each species: pass or fail, row by row, with the picture that shows it and the figure where a
number exists. Then one sentence for the species as a whole. Faults are listed in the order the owner
would notice them, not the order they are cheapest to fix.

A reviewer does not accept an argument about what a species should look like without a reference
picture or a measurement that shows it. A claim without evidence is a row left unjudged, and unjudged
is not passed.

Limits are reported singly, each with its figure, its reason and the alternative that was tried. A
limit is never a reason to stop work on the pictures it names.

## The process

1. **Draw a clean run.** The working tree must be clean, because the manifest names the commit it was
   drawn at and a reference holds only for the tree that drew it. Name every part: stills, every
   turning video and the wind clip.
2. **Record the run** in the species review file: run name, manifest commit, seed, variant and preset.
3. **Look before you measure.** Open the whole view and its reference at the same size and say, in one
   sentence, what a person would take the drawing for. Then walk row 12's checklist over the same
   picture. A figure does not answer this step and never stands in for it.
4. **Judge** row by row, against the run's own figures and the reference pictures. Where a figure and
   the eye disagree, the eye wins and the figure is explained.
5. **Write the verdict** to the species review file, with the pass list for the next round in priority
   order. Name every stray part, crossing and loose shape you saw, with the picture it appears in.
6. **Hand back.** A species is done when every row passes, or when each limit it misses is stated with
   its measured reason. The reviewer accepts a limit; it does not accept a limit as a reason to stop,
   and it never accepts one for row 12: a picture that is a tangle or a pile of shapes is a fault to
   fix, not a limit to state.

The reviewer is independent: it wrote none of the species' work. The figures it quotes name the commit
they were measured at, and a figure from another base is a note, not evidence.

## A batch re-read reads each species at its own branch

A species' record lives on its own branch, so the land head draws a stale plant for every species that
has not merged it. The beech, the hosta and the hawthorn read there with crowns and gaps far from
their photographs. Those figures say nothing about the species. Read each species at its own tip.
Check that the tip reaches the land head before you quote it. Name both commits beside every figure:
the branch tip it was drawn at, and the land commit the branch includes. A figure from a branch
without that merge is void, not wrong. The land commit names the measure; the branch tip names the
plant.

## Tune a crown against its pictures

Move one record field at a time. After each move, draw stills 01, 02 and 18 and the whole-plant
turning video, and read the sky gap and the crown measures. Then run the vegetation tests and the
byte budgets on all six variants at every tier, not only on the drawn plant. The figures are the
pedunculate oak's ([D-330](decisions/D-330-oak-crown-by-its-own-light.md)).

| Fault | Move first | What it does on the oak |
| --- | --- | --- |
| Crown too open | `shoots.placement.density` up 0.05 to 0.1, or `skyPrune` down 0.02 | Each 0.1 of density closes the sky gap by 0.004 to 0.007, and each 0.01 of sky prune by about 0.002 |
| Crown too closed, with still 18 first to go | `skyPrune` up 0.02 to 0.04 | 0.34 to 0.42 opens 18 by 0.019 |
| An even shell round a closed core | `skyPrune` up, with `skyPruneLayer` kept | 0.34 to 0.42 raises the inner sky share by 0.06 to 0.08 |
| Loose specks at the edge | The spray's tight rosette, then longer `bend` pieces | Together they take 01's specks from 32 to 15 |
| Loose leaf groups hanging off the crown's edge | `growth.pipe.tipRadius` up | The groups were foliage on twigs too thin to draw. 02's loose pieces fall from 11 to 7, at a small cost in the young bark's color |
| Too much sky in the top third | `growth.light.surface` on | 01's top-third share falls from 0.233 to 0.188 |
| Trunk hidden under the crown | `growth.floor` up 0.005 | 0.165 loses the clear trunk, and 0.175 keeps it |
| Leaves hanging under the limbs | `shoots.placement.lift` up | At 30 degrees the hanging leaf area falls from 0.156 to 0.055, but 02's gap leaves its band |
| Limbs too steep | `growth.divide.angle` up 4 degrees at a time | The bole-and-crown test counts the great limbs over the variants. 68 degrees costs 02's outline 0.08, and 72 costs every whole view |
| Twigs fan from one point | `laterals` with a `lateralGap` of 0.3 | The winter branch's fan share falls from 0.42 to 0.09 |
| Twigs read as straight rods | `bend` at 34 degrees | 26 degrees fails the kink band |
| Kit over its cap | Longer `bend` pieces, `leafYears` 1, or fewer rosette leaves | Fuller rosettes cost 18 to 33 % of the kit |
| A rosette that reads as a heap of blades | `shoots.placement.rosette` 'fan' | The tip stops spreading its leaves round the stem and stands them in one face, as the close photographs show. Outlines rise 0.02 to 0.05 at the cut views: 10 to 0.39, 22 to 0.39, 23 to 0.55 |
| Blades drawn smaller than the record's leaf | The shoot class's `leafScale` to 1.0 | Every blade at the record's own length. Raise the scale, never the leaf: a longer leaf takes row 4 past the species' own size |
| A cut piece that reads as one bare stem | The cutting class's `laterals`, with `lateralGap` at its most | The sub-branch forks into shoots with a rosette at each end, as its photograph shows. Its sky gap opens from 0.14 to 0.21 against the photograph's 0.26 |
| A fruit's cup that reads as a smooth cone | The cup's lathe profile, its `scales`, then `scaleShade` and `scaleJitter` | The cup stands wider and deeper than the nut, its rows read as scales, and no two scales take the same shade. A flat cup still fails row 12: a viewer close enough to see it sees its surface before its outline |
| A leaf group or a limb standing in the air | The join it should make, then the pruning that left it | A piece the reference does not have fails row 12 whatever its size. The piece counts in the review name it, and the builders' test walks every axis back to a stem |

Each floor value grows a different tree, so read all six variants after a floor change. Do not bring
back the clump field for the specks: its holes fall at random through the wood.

## A shader's cell counts are computed, not written

The plant shader draws a fruit's scales from its own coordinates. A cell count written as a literal
(`vec2f(1, 2)`) has failed to compile in the browser while the same count computed
(`vec2f(max(2.0, floor(rows * 0.5)), ...)`) compiles. The local shader check compares the modules
with their sources rather than compiling them, so it passes either way and the page fails instead.
Until the compiler is pinned down, keep the cell counts computed and read the page after any shader
change, not only the check.
