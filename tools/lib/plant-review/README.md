# Plant review tools

`bun run plants:review` puts a species beside every reference file it has, view by view and frame by frame, and measures how far apart the two are. It writes contact sheets, the measures as JSON, a short summary and a coverage list. The coverage list names each reference file in use and the render it was compared with. The owner's rule is that a species passes only when every reference file in use has a comparison, so a file without one blocks a pass.

The tool reaches the plant core through one page: the plant review sketch, `tests/pages/sketches/plant-review-sketch.ts`. Its query contract and its views are in `tests/pages/lib/plant-review/`. The page grows the species through the plant core's public functions, so it draws what a scene would draw. The tool only builds queries and reads pixels.

## What you need

- Google Chrome, and ffmpeg with ffprobe.
- A dev server for this copy of the repository on its own port, for example `NULL3D_PORT=6361 bunx vite --port 6361 --strictPort`. The first start builds the shaders, which takes several minutes. The tool reads the port from `NULL3D_PORT`, starts a server when none answers there, and refuses a server that serves another copy.
- The species' reference folder. By default the tool looks for it under `.internal/coordination/tree-corpus/generated/<species>`, or under the folder that `NULL3D_PLANT_REFERENCES` names. `--refs` names another folder, or another slug.

## Worked example

This reviews the stub stand-in against the pedunculate oak's references and writes the run into a folder of your choice.

```sh
export NULL3D_PORT=6361
bun run plants:review stub --refs pedunculate-oak --out /tmp/plant-renders --run oak-1
```

The species is any registered species id, or any other id, which draws as a stand-in. A registered species draws through its real stages. Any other id draws the stand-in of every stage. `--views all` adds one picture of every view, with no reference beside it.

The run folder holds:

- `stills/`: one render of each still and texture source in use, with its camera, framing and background matched to the picture, and a matte for those whose outline is compared.
- `turn-<video>/`: one render for every frame angle of each turning video, round a full circle, with a matte each. The renders are drawn as sheets of up to 24 cells in one page and cut apart.
- `wind-<video>/`: the whole plant in the default wind, framed as the wind video frames it, eight frames a second by default.
- `views/`: the views that `--views` asked for.
- `manifest.json`: the commit, the species, the references, and each frame's query, hash, time and the facts the page posted, its measures among them.
- `sheet-*.png`: the contact sheets. The still sheets show each reference, its render and their outline overlay in a row. The turn and wind sheets show a grid of tiles: the reference frame over the render matched to it, then the outlines.
- `metrics.json`, `summary.md`, `coverage.json` and `coverage.md`.

Look at the sheets first. In an outline overlay, the reference is magenta and the render green, and grey is where both have plant.

## Options

| Option | Use |
| --- | --- |
| `--refs <folder or slug>` | The reference folder; the species' own slug by default. |
| `--out <folder>`, `--run <name>` | Where the run goes, `.internal/coordination/tree-renders/` and `<species>-<time>` by default. |
| `--only stills,turns,wind` | Draw only some kinds of reference. The coverage list then names the rest as not drawn. |
| `--step <degrees>` | Draw a turn's renders this far apart rather than at every frame's angle. A quick look; the frames between renders do not count as covered. |
| `--wind-fps <n>` | Frames a second of the wind clip; 8 by default. A clip counts as covered when it spans the video at this rate. |
| `--cell <pixels>` | The width of a turn's or a wind clip's frame; 480 by default. |
| `--views a,b` or `--views all` | Pictures of views with no reference. |
| `--seed`, `--variant`, `--preset`, `--gpu` | The plant, the mesh tier, and the GPU path of the image page. |
| `--no-matte` | Skip the mattes; outlines then come from colour. |
| `--compare <run folder>` | Compare an existing run again, without drawing. |

The command ends with status 1 when a frame failed or when the coverage is not complete.

## The references

`references.ts` reads the folder's `INDEX.md`. A row whose "what it shows" cell says the file is superseded takes the file out of use, and so does a row whose later cell says "Superseded by" a file. Every other picture and video is in use, listed or not, apart from videos' contact sheets.

- Numbered stills go to the review view that shows the same thing, by the words in their names first and their numbers second. A still of another habit or a young form goes to the nearest view, with a note.
- Texture sources (24 to 28) go beside the render's own surface: the leaf faces, the bark at mid-trunk, and young bark far out on a limb. The bark views frame the metres that the species' texture manifest gives.
- `*-turntable*.mp4` is a turning video of the whole plant, or of the branch, sub-branch or leaf cluster that its name gives; `-halfturn` covers 180 degrees.
- `*wind*.mp4` is a wind video.

## The page's query

`plantReviewQuery` in `tests/pages/lib/plant-review/query.ts` builds the query and `readPlantReviewQuery` reads it. Shares count from the frame's left edge and down from its top edge, from 0 to 1.

| Field | Meaning |
| --- | --- |
| `species` | A species id. |
| `variant`, `seed` | The plant's variant and seed; 0 and 11 by default. |
| `view` | The view; `whole` by default. `views.ts` lists them with their reference slots and defaults. |
| `turn`, `elevation` | Degrees round the plant (0 looks from +Z) and above the view's target. |
| `distance` | Metres from the camera to the view's target, in place of the fitted distance. |
| `fov`, `size` | The vertical field of view, and the frame's size, which gives its aspect. |
| `background`, `sky`, `ground` | `sky-meadow`, `studio-grey` or `white`, and sRGB colours in place of its own. |
| `sun` | `default`, `low`, `back`, `overhead` or `flat`. |
| `wind`, `time` | The wind's strength from 0 to 3, and the wind clock's time, at which the tool holds the frame. |
| `season`, `lod`, `preset` | The season, a level forced at every distance (0 to 3), and the mesh tier. |
| `pick`, `cut` | The cutting candidate and its length in metres. |
| `measure`, `scale`, `matte` | Post the measures; draw a 1 m bar; draw the plant black on white. |
| `placeholders` | Grow stand-ins; on by default for an id that is not registered. |
| `horizon`, `fill`, `targetY`, `targetX`, `top`, `eye` | A whole-plant framing in screen shares, which stands the camera on the ground as a reference's camera stood. |
| `along`, `span` | How far along a limb a limb view looks, and the metres of bark a bark view frames. |
| `turns`, `step`, `columns` | A sheet of turns, each in a cell of its own camera. |

The page posts a `plant-review` message with the plant's height, width, crown base, trunk radius and triangles, each cell's camera, the cutting's size, and, with `measure`, each cell's measures: the crown box in metres, the foliage share, the silhouette, the trunk diameter at 1.3 m, the crown base and the first fork's height.

## How the measures work

- **The outline.** `plantMask` fits a smooth colour surface to the frame's border, above and below the horizon apart, and calls a pixel background when it lies near the surface. A band that the surfaces miss, such as a river or a far bank along the horizon, is cleared where it reaches both sides of the frame, or one side in a thin strip. Below the horizon a pixel is plant only when it hangs down from the plant above and is not a darker copy of the meadow. A render's outline comes from its matte, so it is exact.
- **The turn's pairing.** Each outline is scaled so the plant's height fills a fixed canvas, with the trunk on its middle column. The overlap of every reference frame with every render fills a table, and the pairing tries every start and both directions, at the video's own step against the renders' step, and keeps the best mean overlap. A frame is covered when its render lies within half a frame's turn of the frame's own angle.
- **The measures of a pair.** Shape and frame overlap, the width profile's error, the gap fraction, the crown box, and the CIEDE2000 colour difference of foliage and bark (about 2 is a visible step). A bark texture gives the colour difference of the middle of each picture.
- **The crown box's spread** at the rubric's eight angles that the video covers, for the reference and the render, against the rubric's band, which the reference's own spread widens.
- **The wind's motion.** In six height bands of the plant, base first, the share of the outline that changes from frame to frame, averaged over each clip.

## Limits

- A picture with no plain border, such as bark or the inside of a crown, has no outline; its row shows the pictures and the colour figures alone.
- A turning video is taken to turn at a steady rate over its arc.
- A turn's renders are drawn as sheets of cells, which draw without the sun's shadows.
- A stand-in's nearest level has no shoots: it shows its wood and its cards up close.
