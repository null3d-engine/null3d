# D-194: The skinning route on the iPhone, and the probe's flapping answer

Status: decided. Date: 2026-10-19. Task: M2-C8.

Summary: The start-up probe chose the skinning pass on one iPhone page load and the vertex shaders on the next, with the same code. Warm Battle runs put the vertex shaders at 25.5 frames a second and 30.98 to 31.49 ms against the pass's 23.6 and 32.47, with 302 draws against 1,277. The vertex shaders stay the route on the iPhone until a warm re-measure after the sun filter lands.

## Question

Should the engine skin a crowd in the vertex shaders or in the skinning pass on an iPhone, when the start-up probe's own answer changes between page loads?

## Rule

The owner's ruling of 19 October 2026: the pass stays only where a start-up probe measures it cheaper than the vertex shaders. The probe picks the pass only when it measures at least 5% and at least 0.05 ms a frame faster (D-20, D-174).

## Data

The probe ran in the probe worker on a cloud iPhone 17 in Safari 26.6. The tree was the shared head `7c69473f9` plus the probe, on branch `m2-c8-skinning-probe-head` at `45e5e8cc4`. It times both arms from submit to GPU completion, over four alternating rounds of six frames, and keeps each arm's fastest round.

| Page load | Vertex shaders | Skinning pass | Probe's choice |
| --- | --- | --- | --- |
| capabilities.html | 0.657 ms | 0.560 ms | pass, 14.7% faster |
| Battle, minutes later | not recorded | not recorded | vertex |

Battle then measured, with 15 seconds of warm-up and 8 seconds of its own measure, into a 603 by 1009 canvas:

| Route | Frames a second | GPU ms | Draws |
| --- | --- | --- | --- |
| auto, where the probe kept the vertex shaders | 25.5 | 31.49 | 305 |
| vertex shaders, forced | 25.5 | 30.98 | 302 |
| skinning pass, forced | 23.6 | 32.47 | 1,277 |

The pass was 1.9 frames a second and 1.5 ms of GPU time worse when warm. The first comparison page of a session reads about 5 ms slower than later pages with the same settings ([D-20](D-20-webgpu-skinning.md) records the effect), so the 24.4 against 28.0 figures from a session's first pages do not hold.

## Decision

The vertex shaders stay the route on the iPhone on this head. The pass is measurably worse in the engine, and the probe's own answer lies too near its bar to decide reliably: the same code chose opposite routes on two page loads minutes apart.

A re-measure decides the phone after the sun filter lands as its own default. If the pass is then clearly cheaper warm, the probe may take it. The probe's sampling must also widen before it decides on a phone, so a near tie does not flip between pages.

## Consequences

- The engine keeps `SkinningMode::VERTEX` on the iPhone. `?skinning=compute` remains the switch for measurement.
- The probe's iPhone workload and sampling need review before the probe can choose there.
- [D-20](D-20-webgpu-skinning.md) records the probe and this result.
