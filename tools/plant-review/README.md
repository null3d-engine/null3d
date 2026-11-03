# Plant review tools

These tools put a rendered plant beside its reference pictures and videos, frame by frame and view by view. They also measure how far apart the two are.

The tools reach the plant generator through one page: the plant review sketch, `tests/pages/sketches/plant-review-sketch.ts`. Its query contract lives in `tests/pages/lib/plant-review.ts`. The tools build their queries with that file and never import the generator. When the generator changes, the page changes and the tools stay as they are.

## The parts

| File | What it does |
| --- | --- |
| `render.ts` | Draws a species' views through the review page on this computer's GPU. It writes the pictures and a `manifest.json` into a run folder. |
| `references.ts` | Reads a species' reference folder. It takes frames from the turning videos, finds the plant's outline and measures it. |
| `compare.ts` | Pairs a run with its references and lines up the turns. It measures each pair and writes contact sheets, `metrics.json` and `summary.md`. |
| `image.ts` | Reads pictures through ffmpeg, resizes them, converts colours to CIELAB and draws the sheets with a built-in font. |

## What you need

- Google Chrome, and ffmpeg with ffprobe.
- A dev server for this copy of the repository. Give each copy its own port, for example `NULL3D_PORT=6273 bunx vite --port 6273 --strictPort`. The first start builds the shaders, which takes several minutes. When a page reports E1402, run `bun run build` once. `render.ts` reads the port from `NULL3D_PORT`. It starts a server itself when none answers there, and stops it at the end. It refuses a server that serves another copy.
- The species' reference folder, laid out as the reference brief says. Stills are named `NN-<slot>.png`. The whole plant turns in `<name>-turntable.mp4`. The cut pieces turn in `branch-turntable.mp4`, `subbranch-turntable.mp4` and `leaf-cluster-turntable.mp4`. A folder can lack any of them.

## Worked example

This compares the review oak with the live oak's references. `REFS` is the live oak's folder in the reference corpus, and `OUT` is the folder that keeps the runs.

```sh
export NULL3D_PORT=6273
REFS=/path/to/tree-corpus/generated/live-oak
OUT=/path/to/plant-renders
bun tools/plant-review/render.ts --species review-oak --refs "$REFS" \
  --turntable 16 --slots --close --out "$OUT" --run live-oak-1
bun tools/plant-review/compare.ts --run "$OUT/review-oak/live-oak-1"
```

The first command draws about 90 frames into `$OUT/review-oak/live-oak-1/`, the live oak's 27 stills among them. It takes about four minutes once the server is warm:

- `turntable/`: 16 frames round the oak, framed as the live oak's turning video frames its tree, each with a matte.
- `slots/`: one frame for each reference still, with the camera chosen for the still's view.
- `close-branch/`, `close-subbranch/`, `close-cluster/`: 16 frames round each cut piece, against the studio grey, each with a matte.
- `manifest.json`: the commit, the species, the framing taken from the video, and each frame's query, SHA-256, time and the facts the page posted.

The second command reads the run's manifest, finds the references through it, and writes these files into the run folder:

- `sheet-turntable-01.png` and on: one row for each video frame, with the reference, the render frame it was matched to, and their outlines laid over each other.
- `sheet-slots-01.png` and on, and `sheet-close-<piece>-01.png` and on, laid out the same way.
- `metrics.json`: every measure of every pair, and the turn's alignment.
- `summary.md`: the alignment, the means and the spreads, in a few lines for each group.

Look at the sheets first. They are 1,600 pixels wide, so a reviewer can read one at once. Each row's label column gives the angles and the measures. In the outline column, the reference's outline is magenta and the render's is green. Grey is where both have plant.

## The render command

```text
bun tools/plant-review/render.ts --species <id> [--refs <folder>] [--out <folder>] [--run <name>]
  [--turntable N] [--views a,b,c] [--slots] [--close] [--size WxH] [--turn 0]
  [--seed 11] [--variant 0] [--no-matte]
```

| Option | Use |
| --- | --- |
| `--turntable N` | N frames at even angles round the plant. With `--refs`, the frames take the framing of the reference's turning video. |
| `--views a,b,c` | One frame of each view, at `--turn` degrees, 768 by 1024 unless `--size` says otherwise. |
| `--slots` | One frame for each reference still. A still of the whole plant gives its own framing. Needs `--refs`. |
| `--close` | The branch, sub-branch and leaf-cluster turns, of `--turntable N` frames or 8. |
| `--size WxH` | The size of every frame. Without it, a turn takes its video's shape at 960 pixels wide. |
| `--no-matte` | Skips the mattes. Without them, `compare.ts` finds the render's outline by colour. |

The run folder is `<out>/<species>/<run>`. Without `--run`, the name is the commit, a dirty mark and the time. Each frame draws on a page of its own in one browser. A frame that fails is written to the manifest with its error, the run carries on, and the command ends with status 1.

## The review page's query

The page is `tests/pages/image.html?sketch=/tests/pages/sketches/plant-review-sketch.ts?<query>`. `plantReviewQuery` in `tests/pages/lib/plant-review.ts` builds the query and `readPlantReviewQuery` reads it. Shares count from the frame's left edge and down from its top edge, from 0 to 1.

| Field | Meaning |
| --- | --- |
| `species` | A review species' id, such as `review-oak`, or its index in the review list. |
| `variant`, `seed` | The plant's variant and seed. The defaults are 0 and 11. |
| `view` | The view. The default is `whole`. |
| `turn` | Degrees the camera walks round the plant. At 0 it stands on the +Z side. |
| `elevation` | Degrees the camera stands above the view's target. Negative looks up. For a whole-plant view it gives an orbit in place of the standing camera. |
| `distance` | A multiple of the view's fitted distance. |
| `fov` | The vertical field of view in degrees. |
| `aspect` | The output's width over its height, so the page frames for the picture it draws. |
| `background` | `sky-meadow`, `studio-grey` or `white`. |
| `sky`, `ground` | sRGB hex colours that replace the background's own. |
| `wind` | `1` sways the plant in the wind. Stills leave it off. |
| `matte` | `1` draws the plant black on white with no light and no ground, for an exact outline. |
| `horizon` | The horizon's row share, which sets the camera's pitch. |
| `fill`, `targetY` | The share of the frame's height that the plant fills, and the row share of its middle. |
| `top`, `eye` | The plant top's row share and the camera's height in metres, for a frame whose plant base is cut off. |
| `targetX` | The column share of the plant's trunk. |
| `along` | How far along a limb the limb view looks, as a share of the limb's length. |

The framing fields stand the camera on the ground and solve for its distance and height, so the plant lands on the rows asked for (`standCamera`). Without them, a whole-plant view fills most of the frame's height, or less when the plant is too broad.

The page posts a `plant-review` message, which the image page returns with the frame. It holds the plant's height, width, crown start and trunk radius, and where the camera stood. It also names the limb or the cut piece the view chose, and anything the view could not do.

## The views

| View | What it shows | Background |
| --- | --- | --- |
| `whole` | The whole plant from a standing camera. | sky and meadow |
| `crown` | The crown's outer surface, from a little below its middle. | sky and meadow |
| `below` | The crown from under it, looking up. | sky and meadow |
| `inside` | The trunk and limbs from under the crown, beside the trunk. | sky and meadow |
| `skeleton` | The whole plant's wood alone, framed as `whole`. | sky and meadow |
| `silhouette` | The whole plant black on white. | white |
| `trunk` | The bole from the ground to the crown's start, wood alone. | sky and meadow |
| `bark-base`, `bark-mid` | The bark at the root flare and at mid-trunk, wood alone. | sky and meadow |
| `bark-limb` | A major limb running across the frame, near the trunk unless `along` says further. | sky and meadow |
| `leaf-upper`, `leaf-under` | One leaf card alone, from its upper or lower face. | white |
| `branch`, `subbranch`, `cluster` | A cut piece stood upright from its cut end. | studio grey |

The background colours are the medians of the corpus's plain backgrounds, which `references.ts` measured. A run matched to a reference passes that reference's own colours as `sky` and `ground`.

## How the measures work

### The outline

`plantMask` fits a smooth colour surface to the frame's border, above and below the horizon separately. A pixel is background when its CIELAB distance to the surface is small next to the border's own noise. The plant is the largest connected part, with the small parts near it. The horizon is the strongest colour step down the frame's left and right edges. Below the horizon, a pixel is plant only when it hangs down from the plant above and is not a darker copy of the meadow's colour. That drops a ground shadow. A render's outline comes from its matte when the run drew one, so it is exact. `summary.md` reports how well the colour outline matches the matte on the render's own frames.

### The outline's limits

A picture with no plain border, such as bark or the inside of a crown, has no outline, and its row shows the pictures alone. Foliage that sweeps the ground below the horizon can be lost. Haze, or a bright leaf edge that blends with the sky, can open or close a gap in the crown.

### The framing

`estimateFraming` takes the median horizon row, plant top, plant base and trunk column over a video's frames. When the plant runs off the frame's foot, the render's camera stands at eye height and only the top row is matched. When no horizon shows, it is taken at the plant's base, or at the frame's foot.

### The alignment

Each outline is scaled so the plant's height fills a fixed canvas, with the trunk on the canvas's middle column. The shape overlap (IoU) of every reference frame with every render frame fills a table. `alignTurn` tries each start frame and both turning directions, and keeps the pairing with the best mean overlap. The video is taken to turn at a steady rate through one full turn.

### The measures of a pair

| Measure | Meaning |
| --- | --- |
| Shape IoU | The outlines' overlap after scaling to the same height on the trunk. |
| Frame IoU | The outlines' overlap as framed. |
| Width error | The mean difference of the width profiles: the plant's widest run in each of 24 height bands, over its height. |
| Gap | The share of the crown's outline that shows background, for the reference and the render. |
| Crown | The crown's widest run and its height down to the crown's start, in pixels of the work picture. |
| Leaf and bark colour difference | CIEDE2000 between the mean foliage colours and the mean trunk colours. About 2 is a visible step. |
| Crown box spread | Over the turn: the largest less the smallest crown width, and height, over the mean. The summary checks it against the rubric's band, which a reference's own spread widens. |

## What the generator must provide

The page uses only the generator's public output, and stands in for what that output lacks. The new core should provide these, and the page should then use them:

- A `cutting` API. The cut-piece views need one branch's subtree as its own parts, cut at a chosen order and length and stood upright from its cut end. Today the page picks a branch from the wind table and crops its subtree to the length it wants. The `TODO(cutting)` comment in the sketch marks the stand-in.
- Each vertex's own branch. A vertex names its branch in one byte. On a plant with more than 255 branches, wood past the wind table names an ancestor, and a leaf card's byte wraps past 255. So the page gives each vertex to the nearest branch its byte can name. The review spruce has 970 branches.
- The trunk's axis and radius. The page works them out from the wood near the ground whose vertices name the first trunk.
