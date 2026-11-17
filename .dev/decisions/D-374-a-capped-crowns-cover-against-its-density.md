# D-374: A capped crown's cover against its density

Status: proposed for the owner's review. Built: the dense row-place rule on the pull-request branch (fd1db3f7d) and
the root-of-count refinement on oak/levels-cap-walk (82692ca5a). The eye's ruling on the drawn pair decides between
them. Task: none.

Summary: A capped crown's cards must reach the leaf form's own covered area without overfilling the crown. The dense
rule places a card at each row place. It covers the outline best: the hawthorn at 250,000 reads 0.712 and the birch at
1,000,000 0.857. But it is denser than the leaf form. The root-of-count refinement stands fewer, larger cards and
matches the leaf form's cover at a far lighter count. It loses four to seven points of the outline: 0.647 and 0.820.
The hull bound clips the grown plate. The eye's ruling on Oak-L's pair settles which stays.

## Question

Where a capped crown cannot draw its shoot rows, how should it spend its allowance? One option is many small cards
that hold the outline. The other is fewer large cards that stand for several row places and match the leaf form's own
density.

## Rule

A capped crown's cards stand for the rows it cannot draw. Two measures bound them. The capped nearest level's outline
overlap against the uncapped plant must hold its floor at every maximum. The crown's fill must not exceed the leaf
form's own fill, the pair's boxes matching. A card that stands for several rows grows by the square root of that
count. The count is chosen so the covered area reaches the leaf form's own. The allowance left after that stays
unspent, as a maximum is a ceiling.

## Data

Both measured in the budget file's own state, seed 11, variant 0, detail low, on the tree named. Card counts are the
row-place cards beyond the clump cards; leaf triangles are the level's whole leaf draw against the crown's allowance.

| Measure | Dense rule, fd1db3f7d | Root-of-count, 82692ca5a |
| --- | --- | --- |
| hawthorn at 250,000, outline overlap | 0.712 | 0.647 |
| hawthorn at 250,000, row-place cards | 3,062 | 14 |
| hawthorn at 250,000, leaf triangles of 52,067 | 19,124 | 828 |
| birch at 1,000,000, outline overlap | 0.857 | 0.820 |
| birch at 1,000,000, row-place cards | 13,112 | 31 |
| birch at 1,000,000, leaf triangles of 674,353 | 88,592 | 10,052 |
| birch at 250,000, outline overlap | 0.857 | 0.819 |
| birch at 250,000 sparseness 1, outline overlap | 0.588 | 0.591 |
| budget file, whole | 25 pass, 7 fail, no over-cap | 25 pass, 7 fail, no over-cap |
| twelve-species guard, four caps | 54 of 96 rows moved toward their caps, none past | 54 of 96, none past |

How the data was produced: `bun test --conditions=null3d-source packages/vegetation/src/lod/budget.test.ts` on each
tree. The outline overlap is the suite's own matte of the capped nearest level against the uncapped plant. The fill
figures the eye reads come from Oak-L's level-branch pairs, build/crown/haw-*-sp0-l0 and haw-med-*. Those were
measured on the older price model: the hawthorn's allowance there 71,545 with 14,550 place-card triangles. So they
show the shape of the trade, not a figure for the landed records. The dense crown reads 0.8834 against the leaf
form's 0.6505 with the boxes matching, 7.8 points fuller. The refinement's lighter fill is the reply.

## Look

Pending: Oak-L draws the pair from 82692ca5a and Oak-A rules. The dense rule wins the outline rows by four to seven
points. It reads overfilled against the leaf form. The refinement reads lighter and loses those points. A look
question is the eye's, not the overlap figure's.

## Decision

The eye's ruling decides in one sentence. If the dense rule stays, the root-of-count refinement is rejected. It loses
the outline where the hull bound clips the grown plate; its figures above are the reason. If the refinement is taken,
it lands as written. The hull bound's interaction with the grown plate is then the next work item, since the two aims
meet there. Neither option is chosen on effort or schedule.

## Consequences

The coverage clause becomes its own recorded case in the budget suite. It names this record and the dense rule's
0.712 and 0.857 as its figures. The cap and allowance cases stay green while the coverage rail is open. The
refinement stays on oak/levels-cap-walk and does not enter the pull-request branch until the eye rules. Three levers
stay open for the density without the outline. They are fewer planes a card, a smaller cap on a card's growth, and
the card texture's own coverage. The saguaro's capped-body fault keeps its own recorded case, apart from the cap
assertions.
