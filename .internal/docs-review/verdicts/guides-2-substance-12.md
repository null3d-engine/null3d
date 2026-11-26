# guides-2-substance-12

## Finding as given

- page: guides/performance, guides/phones
- anchor: performance line 99 ('... and last the effect itself'), line 271; phones line 91
- category: unclear; severity: medium
- claim: The governor's steps are incomplete and unclear. 'Last the effect itself' does not say that ambient occlusion turns off. The lists leave out levels of detail, screen-space reflections, contact shadows, far character updates and volumetric fog. phones says onChange runs 'after each step that follows the render scale'. The concept page says 'after each shadow step'.
- evidence: docs/concepts/quality-presets.md 'The frame-budget governor'; packages/engine/src/quality/governor.ts.
- proposedEdit: Replace both lists with: 'When frames take too long during play, the governor lowers the render scale first, then detail and effect settings one step at a time ([the frame-budget governor](../concepts/quality-presets.md#the-frame-budget-governor)).' Check which steps call onChange and make phones match.

Verdict: partly

## Evidence

- performance.md:99 lists budgets, render scale, shadow settings, bloom's base, the size of ambient occlusion, "and last the effect itself". The list is incomplete. "The effect itself" is unclear. It is also wrong: turning ambient occlusion off is not the last step. concepts/quality-presets.md:302-311 gives ten steps. Turning ambient occlusion off is step 6. Reflections, contact shadows, far characters and fog come after it. governor.ts:1-7 gives the same order: ambient occlusion's removal comes before contact shadows, far characters and fog.
- phones.md:91 stops at "the size of ambient occlusion". It leaves out the same steps. That part holds.
- performance.md:271 is in the Shadows section. It names only the two shadow steps because the section is about shadows, and it links to the full list. Leaving out the effects steps there is correct, so this part of the finding does not hold.
- The onChange claim is reversed. The code sends a change notice to the sketch after every governor step except a render-scale step. runner.ts:1588-1604 (applyGovernedSteps) applies the detail, shadow, bloom, ambient occlusion, reflection, contact shadow and fog settings, then calls quality.governed(). That queues the onChange handlers (sketch/quality.ts:598). The public TSDoc says the same (sketch/quality.ts:243-248: "The onChange handlers run after each of those steps, but not after a step of the render scale"). So phones.md:91 ("after each step that follows the render scale") is right. The concept page, quality-presets.md:317 ("after each shadow step"), is the stale one. Making phones match it would add an error.
- The proposed wording "lowers the render scale first" is wrong for a sketch that has registered budgets. A budget's step comes first and takes turns with the render scale (governor.ts:1-3, 16-19; quality-presets.md:300).

## Corrected claim

performance.md:99 and phones.md:91 list only some of the governor's steps, and stop at ambient occlusion. performance.md:99 ends with "and last the effect itself". That phrase is unclear, and it is wrong, because four more steps come after ambient occlusion turns off. performance.md:271 is fine as it stands. The onChange wording on phones.md:91 matches the code. The concept page is the one that is wrong: quality-presets.md:317 says "after each shadow step", but the handlers run after every step except a render-scale step.

## Corrected edit

- performance.md:99: "When frames take too long during play, the frame-budget governor lowers the render scale, together with any budgets that the sketch registers. Then it lowers the detail, shadow and effect settings one step at a time ([The frame-budget governor](../concepts/quality-presets.md#the-frame-budget-governor) lists the steps)." Keep the next two sentences, which tell the reader to turn the governor off for measurement.
- phones.md:91: change "Then it lowers the live shadow settings, bloom's base and the size of ambient occlusion." to "Then it lowers the detail, shadow and effect settings one step at a time." Keep the onChange sentence as it is.
- performance.md:271: no change.
- concepts/quality-presets.md:317 (outside this slice): change "the quality.onChange handlers run after each shadow step" to "the quality.onChange handlers run after each step except a step of the render scale", to match the code and the TSDoc.
