# D-381: A planned sparser plant keeps its rows' places, not their facing

Status: decided; the test states it and the record keeps the limit. Task: none.

Summary: The planned grower grows each sparseness state directly. A sparser plant's rows nest at
the denser plant's places, scales and pieces. A kept row can turn a different way. The fill hangs
each state's own twigs, and a piece's facing follows its twig. The promise is the look. The plant is
as tall, joined and lighter, and every kept row stands at its place with its piece.

## Question

A sparser plant should read as the same tree with less on it. Does a planned sparser plant hold
every row the denser plant holds, to the bit, as the old grower's test demanded?

## Rule

The rows' places and scales must nest. A kept socket must keep its piece. A row's facing follows its
twig. It changes when the fill grows a state's twigs differently. A bit-exact subset that includes
the rotation is not promised. A test must measure places and pieces, not the whole row.

## Data

Measured on the planned pedunculate oak at seed 11. The states are sparseness 0 and 0.5. One kept
row reads the same place on both: x -1.9424638748168945, y 7.167673587799072, z 14.021219253540039
meters. Its scale is 0.9941864609718323 on both. Its piece is index 1 on both. Its rotation
quaternion differs. The denser state reads -0.2670147120952606, -0.06483520567417145,
-0.018008142709732056, 0.9613403677940369. The sparser reads -0.14126954972743988,
-0.09144438803195953, -0.013106362894177437, 0.9856516122817993. The oak, the silver birch and the
hawthorn read the same way. Every place, scale and piece nests, and some facing turns.

How the data was produced: the sparseness suite's row subset case. It was read at the pull request's
head before the frame model's removal. The sparse suite had not run after the nine species landed.

## Look

The owner's ruling is the look. A sparser plant is the same tree, as tall, joined and lighter. Every
row it keeps stands where the denser plant stood it. A leaf that faces another way on the same place
is the fill's own draw, not a moved row.

## Decision

The test holds the places, scales and pieces. The extras follow their sockets the same way: their
places nest and their vertices turn with the socket. The test holds the height, the join, the fall,
and the growth count that states the planned promise. Each state is its own growth, and two states add two
growths each. It does not hold the facing. A bit-exact facing across states would need the fill to
keep one twig heading per place across states. That is a change to the fill, not to this test.
