# Shot and demo-link verdicts: api/cameras

## Shots

### dolly-zoom: DROP
- The reference file exists and matches the alt text. The demo holds for 3 s. At that time the focus is on the far king and the lens is about 50 mm.
- The frame shows depth of field, not focal length. One still frame cannot show what a focal length does. The lens-35-85 pair shows it, and it also shows the blur discs. Two pictures of the same demo under the short "Focal length" section is too much for an API page.
- A better home for this frame is the depth of field section of api/post.

### lens-35-85: KEEP, with exact steps
- This is the one picture that explains focal length: the board stays the same size, while the background narrows and the light discs grow.
- The demo (examples/camera-lens/sketch.ts) runs the dolly zoom on its own clock, over 16 s: 35 mm at 0 s, 16 s, 32 s and so on, and 85 mm at 8 s, 24 s and so on. The camera backs away by the same factor, so the board keeps its size.
- Corrected steps: draw the camera-lens demo in hold mode at hold 16 (35 mm) and at hold 8 (85 mm), at the same canvas size, with no pointer input. The demo's orbit controls take over the camera at the first gesture. Place the two frames side by side, labeled "35 mm" and "85 mm". At both times the focus is halfway between the pawn and the king.
- Caveat: the camera also sways slowly from side to side. The 85 mm frames always fall near the end of that sway, so the two frames differ by about 14 degrees of angle. The board size still matches.

### two-views: KEEP, move it
- The reference file exists. At hold 1 it shows the Split layout: the high, wide camera on the left and the low camera among the stones on the right. The alt text is right.
- Placement problem: the "Several cameras" section says the canvas shows one camera at a time. A split-screen picture under that sentence contradicts it. The demo draws two cameras through scene.createView, which the page describes only in the paragraph that starts "A view from scene.createView" (end of "Which frame a ray sees").
- Put the picture beside that paragraph, or add one sentence to "Several cameras" that says scene.createView draws more than one camera on the canvas. Use a caption that names scene.createView.

### layers-street: KEEP, fix the alt text
- The reference file exists. The demo holds for 5 s. The layers change every 2 s, so the frame shows the third set of layers: the street and the pins, with no roofs. The picture shows open rooms and red pins, with no roofs.
- The proposed alt text says "with roofs", which the picture does not show. Corrected alt: "A street of brick cottages with the roof layer hidden, so the rooms show, and red map pins on a layer of their own."

## Demo links

- layers: KEEP. The demo calls setLayers on its camera every 2 s and goes through three masks. This matches the page's point that a new mask needs no rebuild. The demo has no code value, so the link code is "layers/".
- multiple-views: KEEP, with the same move as the two-views shot. The demo uses scene.createView for two cameras at once, not setActiveCamera switching. Link it from the createView paragraph or from a sentence about views. The link code is "multiple-views/".
- picking/: DROP for "Points on the screen". The demo never calls screenToRay or worldToScreen. Its own header says it finds the piece with object.on and no raycast, and that ui.trackLabel moves the labels. A reader who opens it for screenToRay finds none. It belongs on api/raycast or api/input. Here it could only go in a sentence that names it as the simpler route (pointer events and tracked labels).

## Concepts said to have no demo

- Orthographic cameras: CONFIRMED. No demo calls createOrthographicCamera or setOrthoHeight. Only the shared orbit-control helper accepts one. An image test has a clear picture of the concept: tests/image/references/chrome-real-gpu/webgpu/ortho-camera.png (sketch tests/pages/sketches/ortho-camera-sketch.ts). It shows towers from above at an angle, with a row of cubes that keep their size at every distance and the near and far planes cutting the scene. It is a good reference shot for "Orthographic cameras".
- The frame history that rays use: CONFIRMED. No demo shows it. Only the shared orbit-control helper (examples/lib/interact.ts) calls screenToRay, to aim its zoom. The picking demo clicks moving pieces, but through object.on, not screenToRay.
