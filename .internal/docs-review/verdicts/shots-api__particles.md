# Verdicts: api/particles shots and demo links

## Shots

### campfire: KEEP
- Source is right. tests/image/references/chrome-real-gpu/webgpu/demo-particles.png exists and shows the particles demo's default view: the fire, embers, fireflies and fallen leaves in the birch glade.
- The picture helps under the intro. It shows what one sketch of five particle systems looks like.
- Caveats: the reference image is 320x180, so the website copy will be small or soft. The smoke is very faint in it, so the alt text should not lead with smoke. Better alt: "A campfire in an autumn glade at dusk, with flames, embers, fireflies and fallen leaves".

### particles-wind: DROP as proposed
- Source type is wrong. The file already exists as a reference: tests/image/references/chrome-real-gpu/webgpu/particles-wind.png (also compat and webgl2). It is not a scripted shot.
- Alt text is wrong. The test page sets the field's air to a steady speed with no gusts and no swirl. Only a row of dust reads the field. The smoke uses the fixed wind option, not the field. Nothing is "bent by gusts".
- The picture alone does not make the point. It shows orange dust spread over a grey floor in a plain test scene. A reader cannot tell that the field moved it.
- If a picture is wanted, use the pair particles.png (field off) and particles-wind.png (field on), side by side, with alt "The same test scene without and with the wind field: with it, a row of dust drifts across the floor". The value is still low; a live demo link (see the creek link) shows the idea better.

### soft-particles-on-off: DROP as proposed
- The steps cannot run. The particles demo has no switch for softness and no switch for a camera pose. Its camera only moves with user input.
- The demo's smoke has no softness at all; only the flames use it. The smoke starts 0.9 m above the ground, so it never meets it.
- The concept is worth a picture: the section is about a hard line where a particle cuts into a surface. A working source: the particles test page (tests/pages/sketches/particles-sketch.ts). Its smoke starts 0.1 m above the floor with softness 0.3. Add a switch there in the way of the existing bounce switch (for example `?soft=off`, which sets the quality setting softParticles to false), add a manifest entry for it, and capture both pages. Crop on the base of the smoke.

## Demo links

### particles/ for "Emitters, flipbooks and look": KEEP
- The code exists in examples/demos.ts. The sketch uses cone, disc, sphere and box shapes, the flame, spark, smoke, leaves and glow textures made in code, and size, color and alpha over life, velocity and tumble facing, and softness on the flames.

### vegetation-wind/ for "Wind field shared with plants": DROP
- The code exists, but the demo has no particles. It shows only the plants' side of the wind. The Wind section is about particles that read the field.
- Use showcase/creek/ instead. Its sketch makes one wind field. The falling leaves (particles with windField, in air.ts) and the swaying plants (plants.ts) both read it. It is a large showcase, so say what to look for: the leaves that fall from the trees.

### showcase/creek/ for "Wind field shared with plants": ADD
- See above.

## Concepts said to have no demo

- Sub-emitters: confirmed. No demo uses them. Only the test page particle-emit-sketch.ts does.
- Follow trails: confirmed. No demo uses follow. Only the test page particle-emit-sketch.ts does.
- Ground bounce, stick and kill: not fully true. particles/ shows stick: its leaves fall from the birch and settle on the ground (groundMode 'stick'). showcase/creek/ uses kill for leaves at the water, which is hard to see. Bounce is only on the particles test page (the fountain with restitution).
