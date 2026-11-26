# Verdict: guides-2-substance-09

## The finding as given

- page: guides/loading-screens, guides/start-time, guides/performance
- anchor: loading-screens ## The preset check (157-176); start-time ## The preset check (242-248); performance lines 93, 364
- category: duplication, severity: medium
- claim: Three pages explain when the check runs, the stored result and presetCheck: 'before-play'. start-time gives 12 to 38 s (line 106) and 8 to 18 s (line 246) for the Tab A9 Plus, with no note that they measure different modes.
- evidence: loading-screens.md:159-176; start-time.md:106,244-248; performance.md:93,364; concepts/quality-presets.md 'The preset check'.
- proposedEdit: Keep the full explanation on loading-screens. On start-time keep two sentences (the check costs a slow tablet the most; before-play hides the change) and a link, and label each tablet figure with its mode. Move start-time line 248's rules (target from the display's rate, 4-second first round, a quarter of the target goes straight to Low) into a <details> block or the concept page.

Verdict: partly

## Evidence

- The duplication between start-time and loading-screens holds. start-time.md:244 repeats loading-screens.md:161 and 175: the check runs in the first frames of play, the preset drops in front of the viewer, `engine.presetChecked`, the stored result on a repeat visit, and phones at Low with no check. start-time.md:246 repeats the `presetCheck: 'before-play'` option and the three-quarters-of-a-second cost, which loading-screens.md:163-171 and concepts/quality-presets.md:97-105 and 123 already give.
- start-time.md:248 repeats rules that concepts/quality-presets.md already holds in full: the 4-second first round (line 93, step 3), a rate under a quarter of the target goes straight to Low (line 94, step 4), and the target from the display's rate that never falls under the check's own load (line 121). The stored rounds after each lowered preset are on loading-screens.md:175. So this text is not unique detail that needs a details block. It is a copy, and a link is enough.
- The claim that the tablet figures have "no note that they measure different modes" is wrong. start-time.md:106 says "the check runs during play for 12 to 38 seconds after the first frame". start-time.md:246 says "A check before play ... held the loading screen 8 to 18 seconds after the first frame". Each figure names its mode in the same sentence. A reader may still wonder why the before-play figure is the smaller one, but the modes are labeled.
- performance.md:93 and 364 are not real duplication. Line 93 gives the check in two sentences as part of how presets are picked. Line 364 is one bullet that tells a reader to start a steady-play measurement after `engine.presetChecked`, with a link to the concept page. Both are short, fit their page's task, and link out. Cutting them would cost the reader on the performance page.

## Corrected claim

start-time's "The preset check" section (lines 244-248) repeats what loading-screens.md:159-176 and concepts/quality-presets.md "The preset check" already say. Line 248 copies the concept page's rules almost word for word. Each tablet figure on start-time already names its mode (during play at line 106, before play at line 246). The short mentions on performance.md:93 and 364 are fitting and need no change.

## Corrected edit

On start-time, cut the section to what matters for start time: the check can lower the preset in front of the viewer on a first visit; on a Galaxy Tab A9 Plus a check before play held the loading screen 8 to 18 seconds after the first frame, while during play it ran 12 to 38 seconds after the first frame (keep both modes named, and say the before-play check holds the loading screen while the during-play check runs while the viewer plays); `presetCheck: 'before-play'` hides the change; link to loading-screens.md#the-preset-check. Delete line 248 and the repeated parts of line 244 rather than moving them into a details block, because concepts/quality-presets.md#the-preset-check and #the-target-frame-rate already hold those rules. Keep loading-screens as is. Leave performance.md:93 and 364 unchanged.
