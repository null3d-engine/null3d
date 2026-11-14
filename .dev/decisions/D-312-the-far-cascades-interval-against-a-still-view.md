# D-312: A far cascade redraws on its interval, and the test that watches it needs a window that covers the cycles

Status: decided for the measurement, open for the schedule. The far cascade keeps redrawing on `farCascadeInterval`. The shadow-count page now reports the least draw calls of any frame, with the frames it held. Pending: whether a far cascade should ignore its interval while nothing in it moves. That changes every scene's far shadows and waits for its own figures. Task: none.

Summary: the far cascade draws on `frame % interval == (cascade - 1) % interval`, which is four at Low, so every fourth frame draws it whatever the grove is doing. The test took the median of a two-second window, and with a heavy scene that window holds few frames, so the median flipped between the held and the drawn value: seven of ten runs failed, with counts in whole steps of one cascade's draws (45, 53, 60, 67, 75). The page now reports the least counts instead, and the schedule is unchanged.

## Question

Whether the intermittent failure of the shadow-count test is a far cascade redrawing when nothing moves, and what to do about the interval if it is.

## Rule

- A test must not fail because of where its measurement window fell; it compares like with like or it measures a window that covers the thing it samples.
- A change to how often every far shadow redraws in every scene is a design change, and needs its own cost and its own record.

## Data

The test compares three pages: the grove with every row past the near cascades and a sway distance that stops every plant, the same grove with the air held still, and the same grove with no sway distance, where every plant moves. The first two must draw the same.

Ten runs of the WebGL2 case at `a2b0e6e81`, same machine, same command (`bun run test:browser -- vegetation-shadow-count -g "on webgl2" --repeat-each=10`): **seven failed and three passed**.

| Run | Stopped grove, calls a frame | Still air | Every distance | Outcome |
| --- | --- | --- | --- | --- |
| 1 | 67 | 60 | 83 | failed, 7 apart |
| 2 | 67 | 67 | 83 | passed |
| 3 | 75 | 60 | 83 | failed, 15 apart |
| 4 | 60 | 60 | 83 | passed |
| 5 | 67 | 53 | 61 | failed, 14 apart |
| 6 | 53 | 53 | 61 | passed |
| 7 | 45 | 53 | 61 | failed, 8 apart |

The figures are one family, 45 to 83, and every difference is a whole step of it: one to three cascades' worth of draw calls. The schedule is the only thing that changes between frames in a still scene, and its period is four frames at Low.

### What the least counts changed, and what they leave

After the change, ten runs of the same case failed once and passed nine. Most read 23 calls against 23, and two read 45 against 45, where every distance draws 39 or 61. The survivor read "the stopped grove draws 45 calls at least and the still one 23, where every distance draws 39": its window passed the four-frame guard and still held no held frame, so the cascade drew in every frame it saw.

A probe of the sway distance did not explain it. At 8 m the case failed six runs of ten, at 16 m one, so the distance changes the rate and does not remove the caster, and the scene's own settings are not the answer. What remains is a per-frame account, from inside the crate, of which caster the mover test finds and which box it touches. The wasm crate has no logging path, so that account is a piece of work with its own design rather than a run.

## Look

The two options look the same. The picture is unchanged either way: the question is what the test measures, not what the scene draws.

## Decision

Measure like with like, and leave the schedule. The page reports the least draw calls of any frame in its window, which a held frame always gives within one interval, and the frames it covered, so a reader sees that the window held a whole cycle. The test compares those least counts.

The schedule stays as it is. Whether a far cascade should ignore its interval when nothing inside it moved is a real question. The interval is what keeps a still grove's far layers cheap, and holding them harder would make every scene's far shadows cheaper. Against that, a moving caster's shadow would lag behind it. Either way the choice decides the cost of every scene's far shadows, so it waits for its own figures rather than a change made in the same hour the test was fixed.

## Consequences

The shadow-count page's result carries `drawCallsLeast`, `frames` and the window's length; the test compares the least counts and names the window when it presents no frame. The engine is unchanged. If a later record decides that a still far cascade should hold regardless of its interval, this record's decision on the measurement stands and only the schedule changes.
