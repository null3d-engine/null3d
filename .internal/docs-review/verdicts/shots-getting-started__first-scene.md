# Shot and demo-link verdicts: getting-started/first-scene

## Shots

### turning-box: keep, with corrected steps and alt text

The picture helps. A newcomer sees what the four files should draw, so they can tell at once whether their first run worked. No reference image of this scene exists under tests/image/references/chrome-real-gpu/, so a scripted shot is the right source.

Two faults in the proposal:

1. The steps cannot run as written. The screenshot command starts the project's own Vite dev server, so the folder needs a package file and installed packages (the engine, Vite, the Vite plugin and the command-line tool). The page's four files do not include a package file. The starter template that the create command copies by default draws the same scene (same background, camera, lights, box, color and turn speed), and its package file lists every package the command needs.
2. The alt text is wrong. The directional light's direction is [-1, -2, -1], and the page says the direction is the way the light travels. The light therefore comes from the upper right, in front of the box (the camera side), not from the upper left. The lit faces are the top, the right side and the front.

Corrected steps:

    bunx @null3d/cli create first-scene
    cd first-scene && bun install
    bunx @null3d/cli shot --time 1 --size 1280x720 --out turning-box.png

Then convert turning-box.png to docs/images/getting-started/first-scene/turning-box.webp and link it under "## Run it".

Corrected alt text: "A blue box turned partway round on a dark gray background, lit from the upper right."

At 1 s the box has turned about 0.8 radians (about 46 degrees), so two side faces show. That matches "turned partway round".

## Demo links

### objects/ for "Objects and transforms": keep

The objects demo has no code value in examples/demos.ts, so the link uses its name, objects/, as the contract says. Its sketch shows parenting (setParent with keepWorld moves crates between a turntable and the stage) and turning (setRotationEuler on the table and each crate). It does not show hiding an object. The link fits the page's one-line summary well enough. A label such as "Objects and parents" (the demo's own title) would match what the reader finds.

### instances/ for "Instances and batching": keep

The code instances/ exists in examples/demos.ts. Its sketch draws 100,000 columns in one batch made with createInstances and writes every row's height each frame. That is the concept of the linked page.

## Concepts said to have no demo

- createEngine errors and their catch: confirmed. No demo folder catches the engine's start error. Only the shared demo runner (examples/lib/run.ts) does it, and that is not a demo with a link.
- The pixel ratio cap: confirmed. No demo passes maxPixelRatio. Only the shared comparison code (examples/lib/compare.ts) uses it.
- The page and sketch split: confirmed, with one partial match. Every demo ships only its sketch; the shared runner starts the engine. The replay demo (replay/) has its own page part beside its sketch, and the two talk through messages. But it plugs into the shared runner and does not call createEngine itself, so it does not show the split as this page teaches it.
