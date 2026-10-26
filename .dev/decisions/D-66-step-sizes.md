# D-66: The generated room and HDR prefilters made at load, in one go

Status: decided by the owner, and built with M2-E9. Task: M2-N1.

Summary: On the cloud phones one whole map takes 39 to 116 ms of GPU time, and steps over frames cost 368 to 651 ms. So the room's generator and the HDR prefilters make each map at load, in one go. WebGL2 writes the packed format through the spare texture, with half floats only as a fallback.

## Question

The built-in room is made on the GPU at first use, and M2-E4 prefilters HDR files the same way. Does the engine make a whole map at once, at load, or spread the work over frames during play? And if it spreads it, how large is each step, so that no step holds up a frame?

## Rule

These are prototype L1's pass rules. No step during play takes more than 8 ms of GPU time, on any device. The whole room takes under 200 ms on the slowest cloud phone.

## Data

### On the Mac

Prototype L1 timed the room's generator on the Mac (Apple M5 Max, Chrome), on WebGPU, in compatibility mode and on WebGL2. A step's time is the GPU's own.

| Sizing | Steps per room | Longest step on the Mac | Risk on slower GPUs |
| --- | --- | --- | --- |
| A fixed 32 slices, M2-E2's design | 32 | 2.0 to 3.4 ms | The longest slice is 4 to 7 times the average, so it passes 8 ms on a GPU about 5 times slower than the Mac |
| Sized from the first step's rate alone | Not recorded | 7.7 to 10.7 ms | Already over 8 ms on the Mac |
| A timed first step for each kind of draw, then steps at that kind's measured rate | 19 to 27 | 1.4 to 5.1 ms | One row is the smallest step, about 0.13 ms on the Mac. A GPU must be about 45 times slower than the Mac before one row takes 6 ms |

### On the cloud phones

Prototype L1 timed the same work on the cloud phones: the Galaxy S25 and the Pixel 9, 10 and 11.

- One whole map in one go takes 39 to 106 ms of GPU time on WebGPU, and 43 to 116 ms on WebGL2.
- Split into steps, the same map costs 368 to 651 ms. The three smallest blurred levels run 2,048 to 8,192 samples per texel. A step cannot be smaller than one texel's loop. So each of those steps lasts that loop, whatever the step's size.

## Options

| Option | What it does | Cost on the cloud phones | Verdict |
| --- | --- | --- | --- |
| A: make each map at load, in one go | The room or the HDR prefilter runs whole while the scene loads, before it draws | 39 to 116 ms per map | Chosen |
| B: split the sample loop | Each texel's loop runs over several steps, so a step lasts about 6 ms | 87 to 250 ms in all | Rejected: it takes more GPU time in all than A |
| C: cap the samples at 1,024, in the tool and in the engine | The smallest levels take fewer samples, so steps stay small | Not timed | Rejected: it changes the tool's output |
| D: steps sized by the kind of draw | The first step of each kind holds a sixteenth of that kind's modelled work, at least one row. Its time sets that kind's rate, and later steps fill a target of 6 ms | 368 to 651 ms in all | Rejected: one go costs at most 116 ms |

Option D keeps every step on the Mac at 1.4 to 5.1 ms. On the cloud phones its steps cost more GPU time in all than one go, as the table shows.

## Decision

Decided by the owner: the room's generator and the HDR prefilters make each map at load, in one go (option A). They take no steps during play.

- M2-E9 builds it, for the room and for HDR files. The engine uses no fixed slices and no step sizing.
- On WebGL2 the generator writes the packed format through the spare texture. Half floats are only the fallback for a device that cannot. The generator does not draw in the 11-11-10 format, and does not draw straight into the cube.

## Consequences

- The engine makes each map whole at load, for the room and for HDR files.
- [D-19](D-19-environment-maps.md) gives the load rule and the cloud phones' figures.
