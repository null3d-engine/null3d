# Verdicts: porting/threejs-unsupported

## Shots

None proposed.

## Demo links

- KEEP `multiple-views/` (Split screens in place of ArrayCamera, "Rendering and output").
  The demo exists in examples/demos.ts with no `code` value, so `<name>/` is right. Its sketch makes
  two cameras and gives each a rectangle of the canvas with `scene.createView`. That is the page's
  workaround word for word.
- KEEP `css3d-labels/` (Text as HTML labels, "Objects and scenes").
  The demo exists with no `code` value, so `<name>/` is right. Its sketch places HTML cards with
  `ui.trackLabel` ('world' and 'billboard'), the call the page names for text that follows an object.
- REJECT `contact-shadows/` (React Three Fiber and drei).
  The code is valid (`code: 'contact-shadows/'`). But the demo shows the light's screen-space contact
  shadows (`shadow.contactDistance`), not the row's workaround, `materials.shadowCatcher`. In a table
  of features with no equivalent, the link tells a porter that this effect replaces drei's
  `<ContactShadows />`, which the page does not claim. No demo uses `materials.shadowCatcher`, so the
  row should stay without a link.

## Concepts said to have no demo

- WebXR: confirmed. No demo or comparison uses an XR session.
- Physics library in the sketch: confirmed. No demo or comparison uses cannon-es, Rapier or any physics.
- Toon shading: confirmed. No demo steps light into bands or writes a custom lobe function. The
  "bands" in shader-inputs are an emissive pattern, not lighting.
