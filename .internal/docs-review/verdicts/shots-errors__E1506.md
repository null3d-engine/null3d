# Verdicts: errors/E1506 (screenshots and demo links)

Shots proposed: none. Demo links proposed: none. Nothing to disprove there.

## Concepts said to have no demo

### Add-on instance draws (scene.addComputeInstances): NOT confirmed

A demo uses this, through an add-on. The grass add-on (packages/grass/src/grass.ts, createGrass)
awaits ctx.scene.addComputeInstances once per blade shape on WebGPU tiers. The demo
"vegetation-wind" (code `vegetation-wind/`, title "Plants in wind") awaits createGrass in the
sketch setup, before the first frame (examples/vegetation-wind/sketch.ts, around line 89). That is
the exact fix the page asks for.

Proposed link:
https://github.com/null3d-engine/null3d/tree/main/examples/vegetation-wind/

Caveat: the sketch does not call addComputeInstances itself; the call sits inside the grass
add-on. The link text should say "the grass add-on creates its GPU-counted draws in setup", so the
reader knows where to look. The demo "contact-shadows" (garden.ts) also awaits createGrass in
setup, but vegetation-wind is the clearer example.

### The direct draw path and ?direct=on: confirmed

No demo or comparison is about the draw path. ?direct=on is an engine page switch
(packages/engine/src/page/switches.ts) that works on any demo page, and the picture looks the
same on both paths, so a demo link or a screenshot would not help. Note: the page does not
mention ?direct=on at all today; that is a text finding, not a demo one.
