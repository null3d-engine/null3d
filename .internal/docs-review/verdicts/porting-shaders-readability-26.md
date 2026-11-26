# porting-shaders-readability-26

Finding as given:

- page: porting/react-three-fiber
- anchor: ## Step by step (line 221)
- category: scan-order
- severity: low
- claim: The seven steps are the plan of a port and point to sections above, but they come at the end, after the reader has read the details.
- evidence: react-three-fiber.md lines 221-229.
- proposedEdit: Move "Step by step" to right after the diagram and line 31, and link each step to its section (step 4 to A view component, step 2 to State between React and the sketch, and so on).

Verdict: partly

Evidence:

- docs/porting/react-three-fiber.md:221-229 holds the seven steps, after all the detail sections (33, 109, 144, 185). That part of the claim is true.
- The steps do not "point to sections above". They have no links, except step 7 to verification.md. The link idea is a real gain for a reader who uses the list as a checklist.
- The steps use words that the page defines only later: "the view component" (section at line 33), `page.onMessage` (line 109 section), "batch rows", "tracked label" (`ui.trackLabel`, table at line 144). At the top, before line 33, these words have no meaning yet. At the end, the list is a recap in terms the reader already knows.
- Line 13 already gives the short plan up front: "A port moves the component tree inside `<Canvas>` into sketch code, and connects React to the sketch with messages." The diagram at lines 15-29 shows the same split.
- The steps do not map one to one to sections. Step 1 has no section. Steps 3, 5 and 6 map to rows of the table at line 144, not to sections. Step order (2, 4) is opposite to section order (view component first, then state).
- A sibling page, threejs-overview.md, puts "The workflow" (line 101) after its explanation sections, so a recap list after the detail is the pattern in this area.
- Moving the list is a matter of taste with small cost either way. Adding links has a clear benefit.

Corrected claim: The step list at the end has no links back to the sections that explain each step, so a reader who uses it as a checklist must scroll to find them. Its place at the end is fine: it is a recap in terms the page defines above, and line 13 plus the diagram already give the plan up front.

Corrected edit: Keep "Step by step" where it is. Link the steps: step 2 to [State between React and the sketch](#state-between-react-and-the-sketch), steps 3 and 5 to [React Three Fiber and drei in null3D](#react-three-fiber-and-drei-in-null3d), step 4 to [A view component](#a-view-component), step 6 to [UI, HTML overlays and labels](../guides/ui-overlays.md). Optionally add one sentence after line 31: "[Step by step](#step-by-step) at the end lists the order of the work."
