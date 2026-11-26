# Shot and demo-link verdicts: api/lights

Reference folder: tests/image/references/chrome-real-gpu/

## Shots

- lights-kinds: KEEP, source corrected. All four pictures already exist as references, so nothing needs a script. Use webgpu/lights-spot.png, webgpu/lights-rect.png, webgpu/lights-tube.png and webgpu/lights-hemisphere.png (each 480 x 270, the same floor of shapes under each kind of light), joined in a row. Each panel needs a label (Spot, Rectangle, Tube, Hemisphere).
- area-lights-street: KEEP. webgpu/demo-area-lights.png exists and shows window and neon shapes stretched on the wet street. Note: the reference is only 320 x 180; the site may want a larger capture of the same view.
- spot-cookies: KEEP, caption corrected. webgpu/demo-spot-cookies.png exists and shows the rose window on the wall over spheres on plinths. The window frame on the floor does not show in this view, so the caption must not promise it.
- real-units: REJECT. The "scripted" source is wrong: webgpu/real-units.png already exists. But the picture is a black 320 x 180 frame with a mirrored sun glow, a box and a sphere. It says nothing about lux, lumens or exposure that the code does not say better.
- hero-shadow: KEEP, alt corrected. webgpu/demo-hero-shadow.png exists, but it shows a red car, not a rocket (the demo is a car on a launch pad). Alt: "A red car on a launch yard at sunset, with stone blocks and long shadows".
- contact-shadows-on-off: KEEP, source corrected. Both pictures exist as references in webgpu/ only: webgpu/contact-shadows.png and webgpu/contact-shadows-off.png. The test scene is pebbles, a tyre, a pole and a crate on a plain ground, not sand. The two frames differ in only about 0.4% of pixels, so at full size the reader sees no change. Crop both to the pebbles (left middle of the frame) and enlarge them before placing them side by side. Alt: "Pebbles on the ground, with and without contact shadows".

## Demo links

- area-lights/ (Area lights): KEEP. Code exists; the sketch makes rectangle lights and a tube light over a wet street.
- spot-cookies/ (Spot light maps): KEEP. Code exists; two spot lights with maps.
- hero-shadow/ (Shadows): KEEP. Code exists; the car's hero shadow turns off and on every few seconds.
- contact-shadows/ (Shadows): KEEP. Code exists; contact shadows turn off and on every few seconds.
- time-of-day/ (Light from the sky): KEEP. The demo has no code value, so "time-of-day/" is the right form. The sketch uses timeOfDay, assets.skyEnvironment() and setEnvironment, which is exactly this section.

## Concepts said to have no demo

- Hemisphere lights alone: CONFIRMED. Demos that use one (look-at, reflection-probes, sound, shader-inputs) always add other lights. Only the test page lights-hemisphere shows it alone.
- intensityUnit lumen on a spot light: CONFIRMED. No demo uses intensityUnit.
- Point light shadows on High: NOT CONFIRMED. particles/ (campfire glade) makes a point light with castShadows: true; its shadows show where the preset's pointLightShadows is on (High, Ultra). math/ also has a shadow-casting point light on its orb.
