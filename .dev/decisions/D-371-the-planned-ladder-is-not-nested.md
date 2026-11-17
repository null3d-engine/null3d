# D-371: The planned sparseness states are not nested

Status: decided; the limit is recorded and the fix is deferred. Task: none.

Summary: Each planned sparseness state is a cut of the full tree. Its rows and sockets are found in
the full plant at their places, scales and pieces. The states are not nested in each other. A
sparser state draws sockets at places a denser state does not have. Moving the slider can therefore
move foliage to new places as well as take some away. The fix is one stable order per socket and per
axis, with each state keeping a prefix. It changes the plan's thinning for all nine species, so it
is deferred to the next pass.

## Question

Does a sparser planned state hold only what a denser one holds?

## Data

Paired by exact socket place at seed 11 and the low tier, from the full plant down. The pedunculate
oak keeps 267, 215, 173, 132 and 103 sockets from sparseness 0 to 1. Of the 0.25 state's 215
sockets, 145 are the densest state's. Of the 0.5 state's 173, 58 are the 0.25 state's. The silver
birch keeps 1,644 down to 487; 926 of its 1,294 sockets at 0.25 are the densest state's, and 377 of
its 999 at 0.5 are the 0.25 state's. The hawthorn keeps 124 down to 71; 75 of its 108 at 0.25 are the
densest state's, and 35 of its 91 at 0.5 are the 0.25 state's. Against the full plant, every state's
rows and sockets pair completely by place, scale and piece.

## Decision

The sparseness suite states the promise the grower keeps. Every state is a cut of the full tree, and
its rows and sockets are the full plant's at their places, scales and pieces. The even-share clause
stays at its 0.12 slack and records the limit, since the states grow independently and cannot share
one even spread about the full crown.

The nested ladder is a feature for the next pass. It needs one stable order per socket and per axis,
with each sparseness value keeping a prefix, and it changes the sparse crown for all nine species.
The eye must judge each species before it lands.
