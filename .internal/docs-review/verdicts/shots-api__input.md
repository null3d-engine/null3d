# Shot and demo-link verdicts: api/input

The page already links two demos: the input demo (under the first example) and the picking demo (in "Pointer events on objects"). Two of the five proposed links repeat these.

## Shots

### input-robot: reject
- The file exists: tests/image/references/chrome-real-gpu/webgpu/demo-input.png. It shows the robot on a checkered floor in the demo's default view.
- A still frame cannot show input. It shows a robot standing still, and it adds nothing that the sentence under the example does not already say.
- The reference is only 320 x 180 pixels. The robot fills a few dozen pixels, so it would look poor at page width.

### picking-hover: keep, with corrected steps
- The picture shows what the section's handlers do: the hover glow comes from the demo's `pointerenter` and `pointerleave` handlers, and the outline and the hit dot come from its `click` handler (examples/picking/sketch.ts). This helps the reader.
- Playwright can do the steps. The image tests already move and click the mouse (tests/image/controls.spec.ts, tests/image/raycast-rows.spec.ts).
- The proposed steps miss three things:
  1. Hold mode gives the sketch no input. The demo must run live.
  2. The table turns slowly, so the pieces move across the screen. A pointer put on a piece stays over it for only a few seconds. Find each piece's screen place just before each move, and capture soon after the last move.
  3. At start, the demo already outlines the Box. Click a different piece, or the click changes nothing.
- Corrected steps: open the picking demo live, not in hold mode. Wait until it draws. Click the centre of the Sphere. The Sphere is now outlined and shows the hit dot. Move the pointer, with no button down, onto the centre of the Torus. Wait two or three frames so that the hover handler runs, then capture within a second. Capture the canvas together with the HTML labels.

## Demo links

### input/ at "## Actions": reject (duplicate)
- The code exists: the input demo has no code value, so "input/" is right. Its sketch defines an action map of keys and gamepad sticks and buttons.
- The page already links this demo, and the sentence with that link already says that it uses an action map. A second link to it is not needed.
- A better change: in "## Gamepads", add one clause that says the same demo turns its camera with the right stick through `input.value`.

### picking/ at "## Pointer events on objects": reject (duplicate)
- The code exists, and the demo shows the concept.
- The same section already links the picking demo, in the same words.

### walk-and-fly/ at "## The pointer": keep
- The demo has no code value, so "walk-and-fly/" is right. Its entry turns on the pointer lock, and its sketch reads `pointer.locked` and the mouse's movement to look around.
- Note for the link text: the call that asks for the lock is in the shared demo runner (examples/lib/run.ts), not in the demo's folder. Write "a click locks the pointer", not "its sketch asks for the lock".

### gizmos/ at "### Which object gets the event": reject as framed
- The code is right ("gizmos/").
- The concept is wrong. The handles do not take the pointer through the engine's routing of pointer events. They cast their own ray, with `camera.screenToRay`, on a layer that the camera never draws (packages/controls/src/transform-controls.ts). The camera stays still during a drag only because the sketch skips the camera controls while a handle drags. "Which object gets the event" never mentions handles, so the link would mislead.
- A link that fits: on the bullet "To pick through it, cast your own ray with `camera.screenToRay` and `scene.raycast` on the layers you choose", the gizmo handles are a real example of this.

### replay/ at "## Input off": keep
- The code exists ("replay/"). The demo runner starts this demo with input turned off, and the demo's page part takes the keys, the mouse, touch and the pointer lock itself (examples/replay/page.ts). That matches the section, including the note that the page, not the engine, must lock the pointer.
- The section ends with a link to the deterministic-simulation guide, and that guide links the same demo. A direct link on this page is still useful.

## Concepts said to have no demo

- Multi-touch with `input.touches`: confirmed. No demo sketch reads the finger positions in the way the section's example does. The walk-and-fly demo only counts fingers. The input demo's camera takes two fingers through the orbit controls, which hide the touches. The showcase scenes' manual camera reads two-finger spread, but in a shared helper (examples/lib/cinematic.ts) that is not a good teaching link.
- Trackpad pinch: not confirmed. The input demo's orbit controls zoom on a trackpad pinch, and the page's first demo sentence already says so ("the wheel and trackpad pinches zoom").
- Gamepad dead zone and stick directions: partly wrong. The input demo binds all four directions of the left stick in its action map, and it turns the camera with the right stick through `input.value`. A user cannot see the dead zone in any demo, but the input demo applies it.
