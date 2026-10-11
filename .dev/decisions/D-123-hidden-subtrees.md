# D-123: Objects under a hidden object skip their transform update

Status: proposed by the helper of the hidden objects work on 10 October 2026, for the owner's review. Figures added on 11 October 2026. Date: 2026-10-10. Task: none (found by the Factory comparison).

Summary: An object under a hidden object, dynamic or static, is left alone by the transform update once both world buffers hold it hidden. It uploads nothing, and the frame that shows its ancestor recomputes it. Cameras and their ancestors keep updating, and the world getters work an object's matrix out from the local transforms. With room for 200,000 parts and 2,000 shown, the Factory comparison's busiest thread drops from 5.08 to 0.87 ms per frame on WebGPU. On WebGL2 it drops from 5.00 to 1.25 ms.

## Question

The engine recomputed and uploaded every dynamic object in every frame, shown or not. The Factory comparison made room for 200,000 arm parts and hid all but those shown. With 2,000 shown, the hidden moving parts cost about 5.5 ms per frame on the Mac. How should the engine treat objects that a hidden ancestor hides?

## Rule

- Hiding stays cheap: no rebuild of the draw tables, as before.
- An object under a hidden ancestor costs no recompute and no upload once hidden.
- In the frame that shows the ancestor, every object under it draws in its right place, with the right bounds, cell and lights.
- What reads a hidden object's world transform still gets it right: cameras, the world getters, labels and lights.

## Data

Before the change, from the Factory comparison (production builds, quiet Mac, 120 Hz, 1280x720, all effects; figures from the Factory notes):

| Case | Busiest thread at 2,000 shown parts |
| --- | --- |
| Room for 200,000 parts, arm parts and crates dynamic | 5.55 ms |
| The same, arm parts and crates static | 0.72 ms |

After the change, busiest thread per frame in ms, with the upload per frame. Room for 200,000 parts, arm parts and crates dynamic:

| Shown parts | WebGPU before | WebGPU after | WebGL2 before | WebGL2 after | Upload before | Upload after (WebGPU) |
| --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 5.08 | 0.87 | 5.00 | 1.25 | 13.75 MiB | 0.11 MiB |
| 17,832 | 5.56 | 2.15 | 6.16 | 2.33 | 13.75 MiB | 0.84 MiB |
| 21,399 | 5.49 | 4.77 | 7.11 | 4.42 | 13.75 MiB | 13.75 MiB |
| 50,000 | 6.65 | 5.49 | 7.61 | 5.99 | 13.75 MiB | 13.75 MiB |

From 21,399 shown parts, the frame's list of changed rows overflows, so every row still uploads. The change to the upload list fixes that part. With room for exactly 50,000 parts and all of them shown, no object is hidden. The figures then stay the same: 2.51 ms before and 2.59 ms after on WebGPU, 2.71 and 2.68 ms on WebGL2.

How the data was produced: two production builds of the Factory comparison page. One is main with the Factory page merged in, and the other adds this change. The page ran in Chrome 155 with a window, on an Apple M5 Max at 120 Hz, at 1280x720 with all effects. The machine's load was below 8 at the start. Each figure is one run of 20 seconds of warm-up and 10 seconds of measurement, at a fixed count of shown parts.

## Options

1. Skip a row when its parent's row in this frame is hidden, both of its own rows are hidden, and it is not tracked. The check costs three loads per object below a hidden parent, and one more load for each shown child.
2. Leave hidden subtrees out of the hierarchy order, so the loops never reach them. Rejected: a visibility change would rebuild the order, and the Factory page shows and hides cells during its ramp. The order rebuild walks every object.
3. Skip only objects with a mesh. Rejected: a skipped mesh with a camera under it would give the camera an old parent matrix. Groups, such as the nodes of a glTF model, would still update.

## Decision

Option 1. The hidden radius in both buffers is the signal. The renderer has then seen the row hidden in both frame parities, so the row needs no more uploads. The object that is hidden itself has a shown parent, so it keeps updating, and its children read its fresh hidden row.

A new flag, `TRACKED`, marks the objects whose world transform the frame reads while hidden. The views read their camera's, and so do the shadow fit and the mirror pass. TypeScript sets it on every camera. The hierarchy order's rebuild marks each tracked object and its ancestors in a bitset, which costs one bit per object. The create command now carries 16 bits of flags, since the 8 it carried were all in use.

The world getters, the label projection and the debug drawing read `absolute_world_matrix`. When a parent's row is hidden, it composes an untracked object's matrix from the local transforms. The row can be old there. It reads the local transforms as they are when the call comes, not as the last frame left them. For a shown object nothing changes.

## Consequences

- Core: `flags::TRACKED`, `flags::CREATE`, the tracked bitset, the skip in both loops of the transform update, and the getter's fallback. Unit tests in `scene.rs` check the skip, the frame that shows, tracked cameras and the getter.
- TypeScript: cameras pass the flag. A unit test checks their create commands.
- Browser test: `tests/image/hidden-subtree.spec.ts` hides a rig that moves, with a light on it, and a body that carries the camera. On every GPU path, every frame after the show matches an engine that never hid them.
- Docs: `concepts/static-dynamic` (hidden objects), `api/objects` (`setVisible`), the three.js mapping entry for `visible`, and the develop skill's performance reference.
