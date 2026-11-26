# guides-2-substance-27

## The finding as given

- Page: guides/ui-overlays
- Anchor: ## Labels that follow objects (lines 78-95); ### A page under the scene (143-149); ## GUI panels (159-174)
- Category: missing-content. Severity: low.
- Claim: The examples leave out what makes them work. The health bar sets --hp, but no CSS reads it, so the example shows an empty div. The page plane is 800 by 600 units, and the text does not say that the element must be 800 by 600 CSS pixels to match. The GUI sends 'bloom', and the sketch's handler ignores it.
- Evidence: ui-overlays.md:93,124,146,166,171-173.
- Proposed edit: Add a CSS rule such as .hp { width: 60px; height: 6px; background: linear-gradient(90deg, #4c4 var(--hp), #400 0) }. Add 'Size the page element to 800 by 600 CSS pixels, the plane's size.' Add if (type === 'bloom') post.set({ bloom: data as boolean });

Verdict: partly

## Evidence

- Health bar (holds). ui-overlays.md:93 sets the `--hp` custom property. No CSS on the page reads it, and no `.hp` rule exists anywhere in docs/ or examples/. The div that line 87 creates has no size and no style, so the example draws nothing.
- Page plane size (partly holds). ui-overlays.md:124 already states the rule: "An element's CSS pixels are the scene's units for these labels ... Size the scene around it to match." Line 140 says the plane must be "at the same place and size". So the text does say the sizes must match, in general terms. The example never sizes the page element, and never links the 800 by 600 plane to it. The depth-only demo (examples/depth-only/sketch.ts:46-63) does this step: it posts the plane's width and height to the page so the page can size the element. One sentence after the code block would make the link clear.
- GUI bloom (holds, but the proposed fix is wrong). ui-overlays.md:166 sends 'bloom' with a boolean. The handler at 171-173 reads only 'exposure'. The proposed line `post.set({ bloom: data as boolean })` is not valid: the `bloom` setting takes bloom settings or `false` (packages/engine/src/scene/post.ts:460, `bloom?: BloomSettings | false`). `true` is not accepted. docs/api/post.md:141 says `post.set({ bloom: {} })` turns bloom on with its kept values, and docs/concepts/post-processing.md:97 says `false` turns it off.

## Corrected claim

The health bar example sets a CSS value that no rule reads, so the bar has no size or color. The GUI example sends a bloom toggle that the sketch never handles. The page states that CSS pixels equal scene units and that the plane must match the page in size, but the page-under-the-scene example does not show the element sized to the plane's 800 by 600.

## Corrected edit

- After the page.ts code at line 95, add a CSS rule, for example:
  `.hp { width: 60px; height: 6px; background: linear-gradient(90deg, #4c4 var(--hp), #400 0); }`
- After the sketch.ts code at line 149, add: "Give the page element the plane's size, 800 by 600 CSS pixels, so that the two rectangles match."
- In the sketch.ts handler at lines 171-173, add:
  `if (type === 'bloom') post.set({ bloom: data ? {} : false });`
