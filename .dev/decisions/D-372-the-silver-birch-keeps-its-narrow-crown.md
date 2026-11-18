# D-372: The silver birch keeps its narrow crown

Status: decided; the reach does not land. Task: none.

Summary: The silver birch's crown stands 36 pixels narrower than picture 01. The low limb's
reach was tried as the value that would close it. The value widens the crown and opens its sky
toward the picture, but it also moves four of the frame's pinned figures. A value that moves the
species' pinned structure is a change of that structure, not a shape candidate. The judged head
ships unchanged and the width shortfall is a stated limit of the frame.

## Question

Can the silver birch's crown reach be extended to close its 36-pixel width shortfall without
changing the species' stated structure?

## Data

The pair was drawn at one head lineage, one value apart. Both use view 01 at the default camera,
seed 11, cell 768. The control is head 486a097ea in run birch-base2-1155. The candidate is head
320f120a6 in run birch-reach-1530. The one value is the low limb's reach share in its frame rule, 0.88 to 1.

| field | control | candidate | picture 01 |
| --- | --- | --- | --- |
| crown box | 143 by 250 px | 162 by 219 px | 179 by 250 px |
| sky gap, color rule | 0.0971 | 0.1303 | 0.1772 |
| sky gap, matte | 0.0905 | 0.1146 | not comparable |
| outline overlap | 0.709 | 0.7071 | one plant |

So the reach wins 19 of the 36 missing pixels of width. It opens the crown toward the picture's sky.
It loses 31 pixels of crown height that the control matches exactly. A second, context-free pair on
the level branch's own head repeated the trade on the frame tree: 133 by 251 pixels to 156 by 223.

The candidate at 320f120a6 also moves four pinned figures of the species' directed frame, checked in
`packages/vegetation/src/species/frames.test.ts`:

- the through pairs read 4 against 5 (line 867);
- the known crossings move by 2 on each side (line 878);
- the axes per socket read 0.356 against 0.372 (line 890);
- the twig count reads 1,600 against a band of at most 1,450 (line 599).

## Decision

The reach does not land. The judged head 17e8786ac ships unchanged. The four figures above are the
species' stated structure, and a shape candidate cannot redraw them to buy 19 pixels of width.

The limit, stated for the record: the silver birch's crown is 36 pixels narrower than its picture
at still 01, 143 against 179. This is a limit of the directed frame. The pairs that show the
trade are run birch-base2-1155 at head 486a097ea against run birch-reach-1530 at head 320f120a6.
Both draw the default camera, seed 11, cell 768. The level branch's own pair is run birch-clean at
head d4470d066 against run birch-reachlvl-1525 at head 8cb3ca1c3.
