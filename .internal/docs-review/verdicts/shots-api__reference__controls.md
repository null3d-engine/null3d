# Shot and demo-link verdicts: api/reference/controls

Generated page. Its text comes from the TSDoc comments in packages/controls/src (category api/controls).

## Shots

### gizmo-handles: KEEP
- The reference file exists: tests/image/references/chrome-real-gpu/webgpu/demo-gizmos.png (also in compat and webgl2).
- The default view of the gizmos demo selects the jade sphere (the sketch calls select(1)), outlines it, and attaches the gizmo in translate mode. A close crop shows red, green and blue axis arrows, the square plane handles and the center handle. The alt text is true to the picture.
- It fits under `GizmoAxis`, because it shows the axis, plane and center handles that the type names. It does not show the outer `E` ring, which only rotate mode draws. That is fine for this shot.
- Weak point: the image is 320 x 180 pixels, so the gizmo is about 25 pixels wide. Crop it to the gizmo and the sphere, or show it small. A larger capture would need a new image test entry with its own size.

## Demo links

### walk-and-fly/ (First-person and fly controls): KEEP
- The demo has no code field, so "walk-and-fly/" is the right form.
- The sketch imports and calls createFirstPersonControls and createFlyControls, and Space switches between them. It shows both sections well. The link could sit under both `createFirstPersonControls` and `createFlyControls`.

### gizmos/ (TransformControls): KEEP
- The demo has no code field, so "gizmos/" is the right form.
- The sketch calls createTransformControls, attach and setMode, and checks gizmo.dragging before it updates the camera. This matches the text of `createTransformControls` exactly.

### generators/ (Orbit controls): DROP
- The demo exists, but its sketch never calls createOrbitControls. It calls a shared helper (examples/lib/interact.ts), which 58 demos use. A reader who opens the folder finds geometry code and no orbit controls code.
- The demo's subject is geometry shapes, not camera controls. Any demo would show orbit controls as well as this one does.
- No demo calls createOrbitControls in its own sketch, and the shared helper folder is not a demo code, so the website contract cannot link it. Drop the link, or leave orbit controls without a demo link.

## Concepts said to have no demo

- createMapControls: CONFIRMED. No file under examples/ (comparisons included) uses it.
- createDragControls: CONFIRMED. No file under examples/ (comparisons included) uses it.
- Added: createOrbitControls has no demo that shows it in its own sketch (see the generators/ verdict).
