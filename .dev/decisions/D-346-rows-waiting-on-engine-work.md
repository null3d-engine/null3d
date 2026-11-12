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
| Silver birch | 6 | The landing session's card-size constant (`lod.cardGrow`), against the summer and autumn photographs' own conflict | `20` reads 0.1828 against 0.0978 and `33` 0.1742 against 0.0568 at `birch-r16` (`a155adb9a`, dirty true). The retune at 1.5 reads `01` 0.1518, `02` 0.1236 and `18` 0.1366, under their floors, `20` 0.1479 against 0.1478 and `33` 0.1489 against 0.1068, at `birch-audit-r6-card15` (`0c88420c8`, dirty true). |
| Silver birch | 12 | The matte's resolution at the studio scale, and the landing session's card-stalk constant (`lod.cardStalk`) | The cut pieces draw 8, 6, 12 and 2 pieces against 1 each (`11`, `23`, `22`, `21`) at `birch-r16` (`a155adb9a`, dirty true). The cut stem (`birch-audit-r12-stem`, `0c88420c8`, dirty true) and catkin (`birch-audit-r12-catkin`, `a429bef5a`, dirty true) probes leave the count unchanged. |

How the data was produced: the runs named in each species' review file, at the commits recorded there,
with their dirty flags. The hawthorn's rows come from `hawthorn-cards2` and `hawthorn-pattern1` at
`14a7a56d2`; the hosta's from `hosta-flower-28` and `-29` at `7cc6e43f4`; the birch's from `birch-r16`,
`birch-audit-r6-card15`, `birch-audit-r12-stem` and `birch-audit-r12-catkin`, at `a155adb9a`,
`0c88420c8`, `0c88420c8` and `a429bef5a`.

## Look

Not decided here. Each item is judged with the rows it unblocks, when the item is taken.

## Consequences

When an item is taken, its own decision record cites the rows in this table. Each of those rows then
moves to a pass or a limit. The species review files keep the working evidence for every row, blocked
or not. This record holds only the pointer between a row and the work it waits for.
