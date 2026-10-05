# D-66: The generated room and HDR prefilters made at load, in one go

Status: decided by the owner on 2026-10-05, the same day's earlier ruling replaced; built with M2-E9. Date: 2026-10-05. Task: M2-N1.

## Question

The built-in room is made on the GPU at first use, and M2-E4 prefilters HDR files the same way. Does the engine make a whole map at once, at load, or spread the work over frames during play? And if it spreads it, how large is each step, so that no step holds up a frame?

## Rule

These are prototype L1's pass rules. No step during play takes more than 8 ms of GPU time, on any device. The whole room takes under 200 ms on the slowest cloud phone.

## Data

### On the Mac

Prototype L1 timed the room's generator on the Mac (Apple M5 Max, Chrome) on 5 October 2026, on WebGPU, in compatibility mode and on WebGL2. A step's time is the GPU's own.

| Sizing | Steps per room | Longest step on the Mac | Risk on slower GPUs |
| --- | --- | --- | --- |
| A fixed 32 slices, as M2-E2 builds | 32 | 2.0 to 3.4 ms | The longest slice is 4 to 7 times the average, so it passes 8 ms on a GPU about 5 times slower than the Mac |
| Sized from the first step's rate alone | Not recorded | 7.7 to 10.7 ms | Already over 8 ms on the Mac |
| A timed first step for each kind of draw, then steps at that kind's measured rate | 19 to 27 | 1.4 to 5.1 ms | One row is the smallest step, about 0.13 ms on the Mac. A GPU must be about 45 times slower than the Mac before one row takes 6 ms |

### On the cloud phones

Prototype L1 then timed the same work on the cloud phones: the Galaxy S25 and the Pixel 9, 10 and 11.

- One whole map in one go takes 39 to 106 ms of GPU time on WebGPU, and 43 to 116 ms on WebGL2.
- Split into steps, the same map costs 368 to 651 ms. The three smallest blurred levels run 2,048 to 8,192 samples per texel. A step cannot be smaller than one texel's loop. So each of those steps lasts that loop, whatever the step's size.

## Options

| Option | What it does | Cost on the cloud phones | Verdict |
| --- | --- | --- | --- |
| A: make each map at load, in one go | The room or the HDR prefilter runs whole while the scene loads, before it draws | 39 to 116 ms per map | Chosen |
| B: split the sample loop | Each texel's loop runs over several steps, so a step lasts about 6 ms | 87 to 250 ms in all | Rejected: it takes more GPU time in all than A |
| C: cap the samples at 1,024, in the tool and in the engine | The smallest levels take fewer samples, so steps stay small | Not timed | Rejected: it changes the tool's output |

## Decision

The owner decided on 5 October 2026: the room's generator and the HDR prefilters make each map at load, in one go (option A). They take no steps during play.

- M2-E9 makes the change. M2-E2's fixed 32 slices go, and so does the step sizing below.
- On WebGL2 the generator writes the packed format through the spare texture. Half floats are only the fallback for a device that cannot. Drawing in the 11-11-10 format and drawing straight into the cube are dropped.

### The earlier ruling, replaced the same day

Earlier on 5 October 2026, the owner had ruled from the Mac's figures alone. M2-E4 and the room's generator were to size each step by the kind of draw, with no fixed slice count. The first step of each kind held a sixteenth of that kind's modelled work, at least one row. Its time set that kind's rate, and later steps filled a target of 6 ms. The cloud phones' figures then showed that steps cost 368 to 651 ms, where one go costs at most 116 ms. So the owner replaced that ruling with option A.

## Consequences

- M2-E9 replaces M2-E2's fixed 32 slices for both the room and HDR files. The engine makes each map whole at load.
- [D-19](D-19-environment-maps.md) takes the load rule and the cloud phones' figures when M2-E9 lands.
