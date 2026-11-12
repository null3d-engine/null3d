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
- `turn-<video>/`: one render for every frame angle of each turning video, round a full circle, with a matte each. The renders are drawn as sheets of cells in one page and cut apart.
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
| `--cell <pixels>` | The width of a turn's or a wind clip's frame; a still's width by default, so a video's frame is drawn and measured as a still is and takes the same detail level. |
| `--views a,b` or `--views all` | Pictures of views with no reference. |
| `--seed`, `--variant`, `--preset`, `--gpu` | The plant, the mesh tier, and the GPU path of the image page. |
| `--slot-query <file>` | Page query fields per reference file, from a JSON object keyed by the file's name, laid over each still's or video's own query: for example a camera its picture needs, or the light it was taken in (`sunAzimuth`, `sunRise`, `skyShare`, the sky's share of a sunlit view's light, and `daylight`, that light's strength). A field given as `null` is dropped, so a still can trade the framing's `fill` for a `top` row and an `eye`. A video's entry goes over the framing and the light measured from its frames, so it can replace either. `barkMask` measures a close view or a texture source on the plant alone, so a backdrop does not dilute its colour. `leafyBark` measures a bark close view on the bark alone: leaf-green pixels leave the patches on both pictures, so foliage across a limb does not read as the bark's colour. `noOutline` declares a picture whose own background is the subject, such as a far scrub band that the fitted sky and ground admit: the picture carries no outline, so its shape, width, gap, crown box and pieces read null while its colour stays. The reserved key `_sheath` names a species' sheath target for the sheath figure: an Rgb read at both ends, or an object with `foot` and `collar` Rgb colours and a `reach` share of the surface's top, all from 0 to 1. A species' own file is `slots/<species>.json` beside this guide, such as `slots/pedunculate-oak.json`. The run reads no file unless this flag names one, and it warns when a species' file exists and the flag is absent. Draw both sides of a comparison with it. |
| `--no-matte` | Skip the mattes; outlines then come from colour. |
| `--compare <run folder>` | Compare an existing run again, without drawing. |

The command ends with status 1 when a frame failed or when the coverage is not complete.

## The references

`references.ts` reads the folder's `INDEX.md`. A row whose "what it shows" cell says the file is superseded takes the file out of use, and so does a row whose later cell says "Superseded by" a file. Every other picture and video is in use, listed or not, apart from videos' contact sheets.

- Numbered stills go to the review view that shows the same thing, by the words in their names first and their numbers second. A still of another habit or a young form goes to the nearest view.
- A still whose name names one of the species' other forms, such as `young` or `woodland`, is drawn in that form: the tool reads the forms from the species' record and gives the still's query the `form` field. An index row's words never pick a form, since a row can name another form in passing, and a texture source never takes one. Where the record has no such form, the still is drawn beside the grown plant, with a note.
- A still is drawn in the season its name gives: flowers in blossom, fruit in autumn, a bare plant in winter. A still of fruit whose picture shows more green than autumn colours is drawn in summer, since its leaves have not turned.
- Texture sources (24 to 28) go beside the render's own surface: the leaf faces, the bark at mid-trunk, and young bark far out on a limb. The bark close-ups stand in the copy-stand light, which follows the camera, so a turned view still shows the surface as its albedo. The bark views frame the metres that the species' texture manifest gives, or the metres that the slot's own query names.
- `*-turntable*.mp4` is a turning video of the whole plant, or of the branch, sub-branch or leaf cluster that its name gives; `-halfturn` covers 180 degrees.
- `*wind*.mp4` is a wind video.
- A video's renders are framed and lit as its frames are: the framing, the colours and the light are measured from eight of its frames. The light is read against each frame's camera, and the median is kept. The reference videos keep their light where their camera is while the piece turns, so each sheet of a turn stands its one sun as that light stands to the sheet's middle turn. A sheet with a measured light spans at most 30 degrees of the turn, so every cell's camera stands within 15 degrees of where the light was read from.

## The page's query

`plantReviewQuery` in `tests/pages/lib/plant-review/query.ts` builds the query and `readPlantReviewQuery` reads it. Shares count from the frame's left edge and down from its top edge, from 0 to 1.

| Field | Meaning |
| --- | --- |
| `species` | A species id. |
| `form` | One of the species' other forms, such as `young`; the record as it stands by default. A record without that form grows as it stands, and the page notes it. |
| `variant`, `seed` | The plant's variant and seed; 0 and 11 by default. |
| `view` | The view; `whole` by default. `views.ts` lists them with their reference slots and defaults. |
| `turn`, `elevation` | Degrees round the plant (0 looks from +Z) and above the view's target. |
| `distance` | Metres from the camera to the view's target, in place of the fitted distance. |
| `fov`, `size` | The vertical field of view, and the frame's size, which gives its aspect. |
| `background`, `sky`, `ground` | `sky-meadow`, `studio-grey` or `white`, and sRGB colours in place of its own. |
| `sun` | `default`, `low`, `back`, `overhead`, `flat` or `albedo`. |
| `sunAzimuth`, `sunRise`, `skyShare`, `daylight` | A sunlit view's light as its reference was lit: the sun's degrees to the camera's right and above the horizon, the sky's share of the light, and the light's strength, sky, sun and ground bounce together, as a multiple of the page's soft daylight (1 by default, up to 8). A clear sky lights a plant more brightly than the soft daylight does against the same sky colour. A review measures the strength from each photograph's own sky: a calibration to the picture, not a derivation from physics, since a photograph's tone curve squeezes a bright sky more than the plant. |
| `wind`, `time` | The wind's strength from 0 to 3, and the wind clock's time, at which the tool holds the frame. |
| `season`, `lod`, `preset` | The season, a level forced at every distance (0 to 3), and the mesh tier. |
| `pick`, `cut` | The cutting candidate and its length in metres. |
| `measure`, `scale`, `matte` | Post the measures; draw a 1 m bar; draw the plant black on white. |
| `placeholders` | Grow stand-ins; on by default for an id that is not registered. |
| `horizon`, `fill`, `targetY`, `targetX`, `top`, `eye` | A whole-plant framing in screen shares, which stands the camera on the ground as a reference's camera stood. |
| `along`, `span` | How far along a limb a limb view looks, and the metres of bark a bark view frames. |
| `thin` | Metres of radius that a limb view frames: it picks the exposed limb that carries that thickness, so young bark shows. A fork view takes the fork whose limb is nearest that radius. |
| `surface` | A limb view of the crown's outer rim, seen from under it looking up past its edge, rather than of one branch against a plain ground. |
| `forkRow`, `aside` | A view up the stem: the row on which the bark where the stem divides lands, and the degrees the look turns to the right of the stem. |
| `footRow`, `crownRow` | A view up the stem from a few steps back: the rows on which the ground at the bark and the crown's base land, the crown's at least a tenth of the frame above the foot's. A crown's base under twice a person's eye height takes the plain view up the stem, with a warning. |
| `girth` | A bark view of a great limb that shows the limb itself: the share of the frame's height that the limb's thickness fills, above 0 and up to 1. |
| `leaves`, `roll` | A cut piece framed at its photograph's scale: the leaf lengths that the frame's height covers, with the piece standing on its cut at the lower edge. Then the degrees the camera turns about its line of sight: a quarter turn lays the piece across the frame. |
| `turns`, `step`, `columns` | A sheet of turns, each in a cell of its own camera. |

The page posts a `plant-review` message with the form it grew, the plant's drawn height and width (the filled silhouette of the level the view draws, so a part outside that level cannot inflate them), crown base, trunk radius and triangles, each cell's camera, the cutting's size (the piece's own drawn box, on the same rule), and, with `measure`, each cell's measures: the crown box in metres, the plant's filled box, the foliage share, the silhouette, the trunk diameter at 1.3 m, the crown base and the first fork's height.

## How the measures work

- **The outline.** `plantMask` fits a smooth colour surface to the frame's border, above and below the horizon apart, and calls a pixel background when it lies near the surface. A border that is not plain can still separate a plant when the surface models it closely: a sky with no horizon whose fit is at least 0.99 with a residual of at most 24, or a soil below a horizon whose ground fit and residual meet the same bounds. The fit and residual are printed beside the figure, and a ground region outside a soil band's usual share of the frame is flagged, so a bad model is refused or named rather than masked on a guess. A band that the surfaces miss, such as a river or a far bank along the horizon, is cleared where it reaches both sides of the frame, or one side in a thin strip. Below the horizon a pixel is plant only when it hangs down from the plant above and is not a darker copy of the meadow. A render's outline comes from its matte, so it is exact.
- **The turn's pairing.** Each outline is scaled so the plant's height fills a fixed canvas, with the trunk on its middle column. The overlap of every reference frame with every render fills a table, and the pairing tries every start and both directions, at the video's own step against the renders' step, and keeps the best mean overlap. A frame is covered when its render lies within half a frame's turn of the frame's own angle.
- **The measures of a pair.** Shape and frame overlap, the width profile's error, the gap inside the crown's box with the whole frame's gap beside it, the crown box, and the CIEDE2000 colour difference of foliage and bark (about 2 is a visible step). The crown-box gap is the share of the crown's box that shows background; the frame's gap is the share of the whole picture, which widens with the empty sky a photograph keeps around its plant. The enclosed gap is the crown's own: the background between the crown's outermost plant pixels in each row, which is the sky seen through the foliage. **A crown-box gap is an envelope figure and cannot judge foliage density**: most of its background is the hollow between the outline and its box, so a row that asks see-through quotes the enclosed gap, and the box figure is printed beside it so the two are never read as one. A bark texture gives the colour difference of the middle of each picture.
- **The sheath surface's figure.** A junction or crown-foot still of a species whose review data names its sheath target reads both pictures' foot and collar patches at the two ends of the surface's non-green rows, and prints the render's step against the photograph as the row's figure, with the render's step against the authored target beside it as the material check, and the patch areas. A target is an albedo and the render is lit, so a shaded sheath cannot pass it; the photograph is the same lit surface the render draws. Where the photograph's sheath cannot be isolated — its outline is refused — the figure says so as the carrier's limit and leaves the row unjudged. Those views draw their outline as a matte, so the patches stand on the plant alone even where a photograph does not separate from its soil. Only a still at one of those views, with a sheath target in the review data, takes the figure, and no other view or measure changes.
- **The two-dial sweep.** A full round also draws the whole view six times — sparseness 0, 0.5 and 1 by the record's preset and a coarse one — and reads each in order: its connectedness, its height against the record's band, and its crown-box gap. A sparse picture that scatters clumps fails as a generator fault whatever its figures; a coarse picture that thins the plant has mixed the two dials and fails. `--sweeps` draws them alone. The gaps and heights of the sweep are read across the settings and against the record, not as a species verdict; a species whose height calibration lands later moves its heights.
- **The connectivity gate.** The owner's rule is that no piece hangs free at any level or sparseness setting: every leaf, twig, card or bough that loses its parent is joined to its piece or removed. The review reads each still's matte as components, names each piece that meets nothing inside the frame with its area and box, and fails the picture as a **generator fault** whatever the piece count says. A component the frame's border carries may run on outside the picture, so it is not counted as floating. The figure prints the component count beside it, and the sparseness the picture was drawn at where its query names one, so a row read above the record's density is checked at the sparse setting too.
- **The mask check's gate.** A turning video's matte is checked against a colour outline read from each frame: the two outlines' overlap, averaged over the frames the outline can read. A colour outline covering under the plant mask's own 2 per cent subject floor cannot see the plant — a plant that fills the frame leaves the fitted background nothing to find — so those frames are reported as unreadable, and a turn with no readable frame is neither passed nor failed on the check. The gate is 0.6 for a turn on a natural background and 0.9 for a plain-background cut piece, each set from the corpus of 856 turn checks read on 12 November 2026: natural-background turns read 0.717 to 0.978 a frame and sound turns as low as 0.750, so their gate sits 0.15 under the lowest sound turn; plain-background cut pieces read 0.941 to 0.978 a frame, so their gate sits 0.045 under. A turn below its gate fails coverage, and the summary names the turn. A plain-background subject filling under 5 per cent of the frame reports rather than fails, since at that size the overlap is dominated by the boundary band: the holm oak's subbranch turn reads 0.846 with its colour outline at 2.7 to 4.0 per cent and its matte at 2 to 3, where a one-pixel edge costs about 0.15 of the overlap. Where the figure cannot see the subject it reports; it judges only where the subject is large enough and the outline a plant outline.
- **The crown box's spread** at the rubric's eight angles that the video covers, for the reference and the render, against the rubric's band, which the reference's own spread widens.
- **The close views' cameras.** Each close view first finds its subject in the plant. The subjects are the stem from its foot, the most level thick limb leaving the stem, and a limb dividing into two even arms. The others are the crown's lower rim, a branch with its side branches, and the ring of flower sites a plant carries at its crown, which a crown-flowering plant such as a cactus draws in place of a shoot tip. From inside the crown, the subject is the most level stretch of the most level great limb. A bark view of a limb takes a great limb. The trunk view draws the plant in leaf, as its photograph shows the crown above the bole, and takes the bole from the side that the fewest branches and leaves cross. It stands at a person's eye height and looks up, so the bole's foot stands on the frame's lower margin and its first fork a fifth of the frame below the top, with the limbs leaving the fork above it. The first fork is where a limb of a fifth of the stem's cross-section or more leaves, as the grower's tests count it. A camera at a person's eye height walks round the stem to a stand clear of low branches. A view frames its subject at the share of the picture that its photograph gives it. Then it weighs cameras round the subject on a coarse grid, as spheres for the wood and the shoots. It keeps the camera with the least of the rest of the plant in front of the subject. Where the photograph shows a plain ground, it also wants the least behind it. A fork view turns its picture until the limb comes up to the fork from the lower edge. The page posts the subject and that clutter with its facts. A view that finds no subject of its own draws a plain camera instead, and its facts then name what it drew and carry a warning that says why. A view up the stem whose walk finds no clear stand warns the same way. The summary lists each still's subject, its clutter and any warning.
- **The cut pieces of close stills.** A still of one branch or one twig on a plain ground is drawn as a cut piece, as the studio stills are. It is framed at the photograph's own scale in leaf lengths and stands on its cut at the frame's lower edge. A branch lies across the frame, as its photograph lays it.
- **The studio pieces.** A cut piece is fitted to the points it draws: its parts', and the vertices of its shoot rows, which draw the leaves of a piece cut from an instanced plant. A studio still or a cut piece's turning video also gives the rows its piece's top and foot stand on, measured from the picture. The page then puts the piece's highest point on the top row and its lowest on the base row, or on the frame's foot where the picture's piece runs off it.
- **The wind's motion.** In six height bands of the plant, base first, the share of the outline that changes from frame to frame, averaged over each clip.

## Limits

- A picture with neither a plain border nor a fitted sky or soil, such as bark or the inside of a crown, has no outline; its row shows the pictures and the colour figures alone.
- A turning video is taken to turn at a steady rate over its arc.
- A turn's renders are drawn as sheets of cells. Each cell draws at a still's size, and its outline is measured at the same work width as a still's and the video's frames, so a turn's frame and a still from the same camera give the same figures. Each cell draws the sun's shadows, which a development build places from the sheet's middle cell; a release build draws the cells without them. A sheet holds at most eight million pixels.
- A sheet draws a cut piece at the nearest level. A cut piece has no card levels, so a sheet's
  smaller cells would otherwise switch its foliage to cards that hold nothing, and the piece would
  vanish from the sheet.
- A stand-in's nearest level has no shoots: it shows its wood and its cards up close.
- A ground plant such as a sedge or a hosta draws its whole body as merged foliage, with no wood. A
  view that asks for the wood alone keeps that foliage, since the plant has nothing else to show,
  and a view up the stem stands low at the rim of the plant's spread instead of at a person's eye
  height, since the plant has no stem to look up.
