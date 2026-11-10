# D-345: Rows the vegetation batch could not settle, and the items that block them

Status: proposed, and growing as each species' owner reports. Built: the record itself, with the rows
settled so far. The items it names are not built: each waits for the session that owns it. Task:
M3-V1.

Summary: This record lists the rows no species record can settle, against the item each one waits for.
It gives the figures on both sides, so taking an item shows every row it unblocks.

## Question

Which rows cannot be settled by a species record, and what must happen before each can be judged?

## Rule

A row takes one of three outcomes. It **passes** when a clean run at the species' own tip measures
inside its band. It takes a **stated limit** when two measured attempts stand behind it. Each attempt
names its run, commit and dirty flag, and every lever its own text names has been tried. Otherwise it
is **blocked**: the lever is an engine change, a tool change or an owner ruling that the batch is
forbidden to make. A blocked row is recorded here, with its figures on both sides.

Row 12 admits no limit at all under the rubric, so a row 12 that does not pass is always blocked.

## Data

| Species | Row | It waits on | The figures on both sides |
| --- | --- | --- | --- |
| Hawthorn shrub | 12 | An owner cap rise, or the engine change that joins the cards | The whole views draw 4, 3 and 4 pieces against the reference's 1. Card growth 1.35 joins them to 3, 2 and 2 but takes the profile view to 0.1784, 0.0136 under its floor; `perMetre` 9 of 11 joins to 2, 2 and 2 but takes it to 0.1873, 0.0047 under, and the card levels to 163,068 of 155,000 and 25,051 of 25,000. |
| Hosta | 12 | The landing session's one-stem view and flower colour measure, and the engine's pedicel | The silhouette reads 0.3930 against its 0.2225 ceiling, with 3 pieces against the reference's 1. A one-scape state reads 0.0435 and one piece only by giving the plant a scape count the record does not hold; the raceme cannot open without a pedicel. |
| Bracken | 4 | The landing session's leaf-texture rebuild | The row rests on the species' own photographs disagreeing: source 24 reads 0.2572 IoU and 0.2482 width error, against studio 12 at 0.3905 and 0.0939 and studio 21 at 0.4261 and 0.1241. The texture is built from the pinned photographs, so a repaint moves the six species pictures, as the earlier frame rebuild did at 6.23 to 6.47 per cent. |
| Bracken | 5 | The landing session's texture rebuild, or a reference set holding the same frond | The set holds no piece of the same frond: 22 is a frond tip and 23 a young blunt-lobed frond, while the cut draws the mature frond of source 24. The silhouettes read 0.4261, 0.3325 and 0.3243, with gaps of 0.2262 to 0.3152, 0.1462 to 0.3131 and 0.1762 to 0.3168, all against a floor 0.02 below the reference. |
| Common ash | 6, the look-up crown | The plant core's crown interior: the engine draws the crown's outer shell as cards and has no field for its inside | The look-up reads 0.1905 against 0.4637 at `ash-final1` (`dbd1877f1`, dirty false). The named lever lift 26 with skyward 0.85 reads 0.1958 and pushes `18` from 0.2478 to 0.2688 against 0.2147, 0.0041 past the +0.05 ceiling, at `ash-row6-lift26` (`dbd1877f1`, dirty true). The second pass's three settings are at `ash-21` (`3e89d8de3`, dirty false). |

How the data was produced: the runs named in each species' review file, at the commits recorded there,
with their dirty flags. The hawthorn's rows come from `hawthorn-cards2` and `hawthorn-pattern1` at
`14a7a56d2`; the hosta's from `hosta-flower-28` and `-29` at `7cc6e43f4`; the ash's from `ash-final1`
and `ash-row6-lift26` at `dbd1877f1`.

## Look

Not decided here. Each item is judged with the rows it unblocks, when the item is taken.

## Consequences

When an item is taken, its own decision record cites the rows in this table. Each of those rows then
moves to a pass or a limit. The species review files keep the working evidence for every row, blocked
or not. This record holds only the pointer between a row and the work it waits for.
