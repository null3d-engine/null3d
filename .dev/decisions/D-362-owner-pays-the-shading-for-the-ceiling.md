# D-362: The owner pays the shading for the ceiling on a device that cannot afford both

Status: decided by the owner; the work is in its builders. Task: M3-V11, M3-V16.

Summary: The owner ruled, in their words: "ok do it all". A device whose frames run over its preset's
ceiling may lose the ambient-occlusion shading, which the owner accepts. The rule is by measurement
and not by device name: a device that holds its budget keeps the shading. The vegetation's fill is
also open to change, with its pictures reviewed.

## Question

Creek High reads 86.58 ms on the iPad Pro 13 against a ceiling of 67.1. The occlusion effect is
12.89 ms of that frame, and switching it off leaves 73.69, 6.59 ms over. The camera's opaque pass,
which is the vegetation's fill, is 72.1 ms of the frame. Neither is small, and both change the look
of a scene the owner has already judged.

## Rule

The ceiling is the owner's, and the look is his to trade for it. He accepts the occlusion shading
going on a device that cannot hold its preset's frame budget, and he accepts the crowns changing if
the fill work needs it and the pictures are reviewed.

The choice is a governor step and not a device list: the effect drops only after the cheaper steps
fail to hold the budget, and only a device that reaches that step loses it. A phone, a tablet that
settles or a desktop keeps the shading.

## Data

| Measure | Figure |
| --- | ---: |
| Creek High with the effect | 86.58 ms |
| Creek High with it switched off | 73.69 ms |
| Creek High with its target quartered | 83.68 ms |
| The effect's share of the frame | 12.89 ms |
| The camera's opaque pass at High | 72.1 ms |
| The ceiling it misses | 67.1 ms |

How the data was produced: the three rows come from the vegetation plan on the iPad Pro 13 in Safari
26.6.1 at `229501911`, at render scale 1. The pair is `.dev/tested-devices/ipad-pro-13-safari/20261116-024243-vegetation.md`
and its `-024454-` twin; the quartered row is a probe with the preset edited and reverted.

## Look

The occlusion shading goes on the device that reaches the step, and the pictures of that state are
not the approved ones. The owner accepted that cost in his ruling. The masking, the crowns and the
water do not otherwise change; the fill work carries its own pictures.

## Decision

The governor may drop the occlusion effect to hold a preset's frame budget, after its cheaper steps,
and the fill work may proceed. A device that holds its budget keeps the effect.

## Consequences

`packages/engine/src/quality/governor.ts` gains the step and its restoration. The vegetation's card
fill work changes the render path and carries its own picture review. The five open tasks gain a
route to their ceilings that the owner has priced.
