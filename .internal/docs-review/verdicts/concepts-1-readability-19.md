# concepts-1-readability-19

## Finding as given

- page: concepts/culling
- anchor: ### The check during play, lines 77-87
- category: technical-details-block
- severity: medium
- claim: Five bullets on the 120-frame trial, the 10% and 2% thresholds, the occluder groups and the still-view pause. A user needs only to know that the engine turns the passes off when they do not pay.
- evidence: culling.md:79-87
- proposedEdit: Keep: 'The extra passes cost GPU time. About every 120 frames the engine tries a few frames the other way and keeps the faster choice. engine.measure reports hidden objects as occludedEntries. ?occlusion-check=off keeps the passes on, for tests.' Move the five bullets into a block 'Technical details: how the engine checks that occlusion culling pays'.

Verdict: partly

## Evidence

- The page says what the finding says. Lines 79-85 hold one lead paragraph and five bullets. Line 87 covers `occludedEntries` and the `?occlusion-check=off` switch.
- The bullets match the code. `crates/null3d-render/src/gpu_driven/occlusion_check.rs:49` sets a trial every 120 frames. Line 63 sets the hidden share to at least 10%. Line 67 sets the time margin to 2%. The module comment (lines 23-36) covers the occluder buckets from recent readings and the pause while the view holds still. `packages/engine/src/page/switches.ts:481` and `sketch/runner.ts:786` show that `?occlusion-check=off` holds the passes on.
- Some of the detail is for implementers and suits a block: the readback of the counts a few frames late, how frame times are measured (submit to completion), and which buckets the occluders' pass draws. Another program's GPU work running in the gaps between passes also fits there.
- Two points matter to a plain user and must stay in the main text:
  1. The rule for "pays": the passes must hide at least a tenth of the objects that would draw, and must not make the frame slower. This tells a reader why the passes can turn off in their scene and why `occludedEntries` can read 0. The proposed text says only "keeps the faster choice". That is wrong as a summary, because the hidden-share rule also applies.
  2. The proposed text drops "and 0 while the check keeps the passes off" from line 87. Without it, a reader who sees `occludedEntries` at 0 can think culling is broken. Line 87 is not part of the bullets, so cutting it goes past what the finding argues for.
- The still-view pause (line 85) affects the still-camera accumulation that users see. One short main-text sentence about it is worth keeping. The mechanics can go in the block.
- The severity is high for this section. The five bullets total about 150 words and are already easy to scan. Low fits better than medium.

## Corrected claim

The section mixes user rules with mechanics an implementer needs. The readback timing, how frame times are measured and the occluder-bucket pruning can go into a technical-details block. The rule for "pays" (hides at least a tenth, no slower within 2%), the pause while the view holds still, and the note that `occludedEntries` reads 0 while the passes are off must stay in the main text. Severity: low.

## Corrected edit

Main text:

"The extra passes cost GPU time: a depth draw of the occluders, a depth pyramid and a second culling pass. So the engine checks during play whether they pay. About every 120 frames it runs a few frames the other way and compares. The passes stay on while they hide at least a tenth of the objects that would draw and the frame takes no longer with them, within 2%. Otherwise they stay off until a later check finds that they pay. While the view holds still, the check pauses, so the still-camera accumulation can finish.

`engine.measure` reports the objects that the culling hid as `occludedEntries`: the count of the newest frame whose counts came back, and 0 while the check keeps the passes off. The `?occlusion-check=off` switch keeps the passes on in every frame, for a test that compares the image with culling and without it."

Then a block:

<details>
<summary>Technical details: how the engine checks that occlusion culling pays</summary>

- Another program's work on the GPU can run in the gaps between the extra passes, so a frame with them can take longer although it draws less.
- The second phase counts the objects in view that would draw and those that the pyramid hid. A frame copies the counts, and the GPU sends them back a few frames later. Nothing waits for them.
- A trial runs without the passes while they run, or with them while they do not. It compares the GPU's frame times, from each frame's submit to its completion, with the frames just before.
- The occluders' pass draws only the groups of objects that held occluders in the last few checks, so it draws nothing for the rest.
- While the view holds still, nothing is copied and the passes stay as they are. The check starts again a little after the view moves.

</details>
