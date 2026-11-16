# D-344: a species names its own leaf frame

Status: decided. Twelve species were checked against their own face pictures and six build their
leaves upside down. The texture tool already takes a frame from each species, so the fix is one
entry per species, not an engine change. Task: M3-V5 records the finder's weak default; no species
record gains a field.

Summary: the texture tool finds a leaf picture's stalk end and tip end by rule: the narrower end is
the stalk. That rule fails on any leaf whose tip tapers to a point finer than its stalk, which is
most pointed leaves. The tool's config already carries `frame` and `lowerFrame` for exactly this
case, and its own doc comment says so. Species that read inverted name their frames, rebuild their
leaf textures and redraw the pictures that draw the leaf.

## Question

The review found leaves built upside down, with the stalk at the picture's tip end. Is this an
engine fault that blocks the species, and what does each species owe?

## Rule

- The finder's default is a guess, and a species may overrule it. A leaf whose narrow end is its
  tip takes a named frame in the face's own texels.
- A species reads inverted when the finder's petiole end is the end its photograph shows as the
  tip. The check uses the tool's own cleaning and frame finder on pictures 24 and 25, so the
  finding names the points on both sides.
- An inverted species names both faces, rebuilds its leaf texture, redraws every picture that
  draws the leaf and re-measures the rows those pictures carry. A row measured on an upside-down
  leaf does not stand.
- No engine change is owed. The finder's default reads a pointed tip as a stalk. M3-V5 records
  that weakness and the shapes that defeat it. The tool's answer to it, though, is the named frame.

## Extent

Twelve species were checked. Six read inverted, which is half the batch. Every species whose
picture tapers to a point finer than its stalk read inverted. Those are the ash, birch, willow, holm
oak, hosta and bracken, and Scots pine outside the batch. No species with a stalk at least as wide
as its tip did. The finder's default therefore fails on every pointed leaf checked. That is why the
named frame is the answer, rather than a better guess.

| Species | Verdict | Note |
| --- | --- | --- |
| Pedunculate oak | clear | leaf ends round |
| European beech | clear | 20-texel stalk at the bottom center, apex at row 27 |
| Hawthorn | clear | names its frame, petiole 511, 1009 and tip 512, 6 |
| Common alder | clear | petiole at V 0.0229, tip at 0.9734 |
| Meadow grass | clear | blunt hood at the tip, pale sheath collar at the stalk |
| Sedge | clear | no leaf texture is built; no face picture feeds it |
| Common ash | inverted, fixed | named both faces; row 4 moved from 0.629, 0.714, 0.481, 0.434 to 0.635, 0.606, 0.412, 0.377 |
| Silver birch | inverted | picture 24: petiole 545, 1013 and tip 549, 8 against the finder's 548, 11 and 547, 1008; picture 25: petiole 486, 1012 and tip 533, 10 against 534, 13 and 482, 1006 |
| Weeping willow | inverted | petiole 38, 993 and tip 996, 26 against the finder's 996.5, 26.4 and 38, 993.2 |
| Holm oak | inverted | fixed; row 4 holds and its underside shape rises from 0.912 to 0.951 |
| Hosta | inverted | petiole the 55 to 58 texel stalk at the bottom center, tip the 3 texel point at the top center; a shape overlap of 0.83 hid it |
| Bracken | inverted | a frond's tip reads as its stalk |

Scots pine, outside the twelve, also reads inverted.

## Redraw scope

Every picture that draws the leaf texture changes when the frame changes, because the texture's
pattern turns with it. The picture references were accepted against the upside-down leaf, so each
species' redraw is named here rather than assumed. Bark, stipe and rhizome pictures sample other
materials and are not redrawn.

The numbers in this table are the review round's pictures and turns. The texture tool draws them
for each round, and they are not committed files. A reader who looks for them in the repository
finds nothing. What the repository holds is the picture tests' references. Each of the two sets,
the machine's own GPU and the software renderer, holds three tiers. A redraw replaces every tier
that shows the changed panel, and the software set carries a recorded reason.

| Species | Pictures redrawn | Pictures not redrawn |
| --- | --- | --- |
| Silver birch | 01, 02, 03, 12, 13, 18, 19, 20, 22, 24, 25, 30, 31, 33, and the turntable and wind videos | 15, 26, 27, 28, 32 and 34 (bark); 35 (catkins) |
| Weeping willow | 01, 02, 03, 04, 05, 06, 09, 10, 12, 13, 18, 19, 30, 31, and the turntable and wind videos | 08 (limb fork), 17 (trunk taper), 28 (young bark) |
| Holm oak | 01, 02, 12, 13, 18, 24, 25, the whole-clump turn and the three part turns | 14, 15 and 16 (bark) |
| Hosta | 01 to 07, 14, 15, 16, 17, 18, 20, 22, 23 and 30 | none |
| Bracken | 01 to 14, 18 to 25, and the three halfturn videos | 15 and 16 (stipe), 17 (rhizome) |

The sedge builds no leaf texture and the pedunculate oak reads clear, so neither redraws a picture.

## Ownership

The species' owed look rows are carried under M3-V4, the package and its species generator. That
task is ticked, and its tick covers its own four Done-when clauses. It does not cover these rows.

The debt is a separate item carried under the task: the rows this change does not reach, and the
stated limits beside them. The holm oak is the instance now: nine look rows still owed, and row 10
recorded as a limit with its figures and its levers. A limit is not a closed row. Named this way,
the debt stays visible in a task list that shows only the tick.

## Consequences

- Five species owe the entry: the silver birch, weeping willow, holm oak, hosta and bracken. Each
  costs one texture rebuild and the redraw of the pictures that draw its leaf.
- The birch's row 12, blades standing clear of their wood, is this same fault and not a second
  one. A blade joined at its tip leaves its hairline stalk in the air. Its fix and the birch's leaf rows
  move together.
- The pedunculate oak's twelve rows stand: its leaf ends round, so its frame was never wrong.
- The review's shape-overlap figures on inverted species hid the fault, because a near-symmetric
  blade overlaps its own picture closely either way up. The pair of points, not the overlap, is the
  evidence.
