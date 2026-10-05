# D-66: GPU work spread over frames: steps sized by the kind of draw

Status: decided by the owner on 2026-10-05; built with M2-E4. Date: 2026-10-05. Task: M2-N1.

## Question

The built-in room is made on the GPU at first use, in steps over several frames, and M2-E4 prefilters HDR files the same way. How large is each step, so that no step holds up a frame?

## Rule

No step takes more than 8 ms of GPU time, on any device. The whole room takes under 200 ms on the slowest cloud phone. These are prototype L1's pass rules.

## Data

Prototype L1 timed the room's generator on the Mac (Apple M5 Max, Chrome) on 5 October 2026, on WebGPU, in compatibility mode and on WebGL2. A step's time is the GPU's own.

| Sizing | Steps per room | Longest step on the Mac | Risk on slower GPUs |
| --- | --- | --- | --- |
| A fixed 32 slices, as M2-E2 builds | 32 | 2.0 to 3.4 ms | The longest slice is 4 to 7 times the average, so it passes 8 ms on a GPU about 5 times slower than the Mac |
| Sized from the first step's rate alone | Not recorded | 7.7 to 10.7 ms | Already over 8 ms on the Mac |
| A timed first step for each kind of draw, then steps at that kind's measured rate | 19 to 27 | 1.4 to 5.1 ms | One row is the smallest step, about 0.13 ms on the Mac. A GPU must be about 45 times slower than the Mac before one row takes 6 ms |

- The kinds of draw in the room's generator differ in cost per row, so equal slices take unequal times. One fixed slice count, or one rate for all kinds, cannot keep every step near a target.
- Without a GPU timer, each step's time less an empty step's still kept the steps at 2.2 to 4.5 ms.
- The cloud phones' figures come with M2-E4.

## Decision

The owner decided on 5 October 2026: M2-E4 and the room's generator size each step by the kind of draw. They use no fixed slice count.

- The first step of each kind holds a sixteenth of that kind's modelled work, at least one row, and nothing else. Its time sets that kind's rate.
- Later steps fill a target of 6 ms at each kind's rate, and each step's time corrects the rates of the kinds in it.
- The time comes from the GPU's timer where the device has one: `timestamp-query` on WebGPU, `EXT_disjoint_timer_query_webgl2` on WebGL2. Elsewhere it is the time from the step's call until the GPU finished it, less the same wait for an empty step.

## Consequences

- M2-E4 replaces M2-E2's fixed 32 slices for both the room and HDR files. The pass rule stays: no step over 8 ms, and under 200 ms in all on the slowest cloud phone.
- [D-19](D-19-environment-maps.md) takes the step rule and the cloud phones' figures when M2-E4 lands.
