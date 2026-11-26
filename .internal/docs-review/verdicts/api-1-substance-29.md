# api-1-substance-29

## Finding as given

- Page: api/controls
- Anchor: ## First-person controls line 199; ## Pointer lock line 221
- Category: unclear. Severity: low.
- Claim: The drag limit uses the 85-degree cap with constrainVertical, verticalMin and verticalMax. The pointer lock uses minPolarAngle and maxPolarAngle. The page does not say why there are two sets, or which applies when.
- Evidence: docs/api/controls.md:199, 221.
- Proposed edit: Add: 'The drag limits follow three.js's FirstPersonControls, and the pointer-lock limits follow its PointerLockControls. Each applies only to its own input.'
- Generated source: none (hand-written page).

Verdict: partly

## Evidence

- "Which applies when" is already on the page. Line 199 is in the drag bullets ("A drag tips the view at most 85 degrees ..."). Line 221 sits in the list that starts "While the pointer is locked ... First-person controls then turn the view by the movement". A reader can tell which limit goes with which input.
- "Why" is missing. The page never says that the first-person controls join three.js's FirstPersonControls and PointerLockControls. The source says so (packages/controls/src/first-person-controls.ts:1-4), and the test compares against both three.js classes (first-person-controls.test.ts:1, 9-10). Line 128 of the page names three.js for the orbit controls, so a note here fits the page.
- The proposed edit has a false claim. "Each applies only to its own input" is wrong for constrainVertical:
  - update() clamps to the polar limits only when locked, and to the 85-degree cap only when not locked (first-person-controls.ts:267-270). That part is true.
  - But turnToView() runs every frame in both states, and it maps the view angle into verticalMin..verticalMax whenever constrainVertical is true (first-person-controls.ts:475-480). So with constrainVertical on, the vertical range also changes the view while the pointer is locked.
  - Only the drag's speed scaling by that range is drag-only (line 257).
- Line 199 also says constrainVertical "limits it further". The code maps (rescales) the angle into the range, it does not clamp (option TSDoc at first-person-controls.ts:51 says "maps"). That is a separate small inaccuracy on the same line.

## Corrected claim

The page already ties each limit to its input. What it lacks is the reason: the two sets of options come from three.js's two controls. Also, constrainVertical is not drag-only: its mapping applies while the pointer is locked too.

## Corrected edit

After the pointer-lock bullets, add:

"These options follow three.js's PointerLockControls, and the drag options follow its FirstPersonControls. The 85-degree cap applies only to a drag, and `minPolarAngle` and `maxPolarAngle` apply only while the pointer is locked. `constrainVertical` maps the view's angle into `verticalMin` to `verticalMax` in both cases."

On line 199, change "limits it further" to "maps the view's angle into that range".

If the maintainers think constrainVertical should not act under the lock, that is a code fix in packages/controls/src/first-person-controls.ts (turnToView), not a docs edit.
