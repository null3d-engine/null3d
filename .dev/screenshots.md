# Documentation screenshots

`docs/images/shots.json` lists every docs picture, the pages that show it, and the source files that decide what it shows. The tool `tools/docs-screenshots.ts` draws the pictures that the image test manifest can draw, at about 1,600 pixels wide. A demo's default view, a held scene and a page of the browser's tools each have a place. A shot that joins several pictures, or that a person takes by hand, waits for a person.

## A shot's entry

Each entry has these fields:

| Field | Contents |
| --- | --- |
| `id` | The path under `docs/images`, without `.webp`. The picture is `docs/images/<id>.webp` |
| `pages` | Each page that shows the shot, with the place on the page after `#` |
| `source` | `reference`, `scripted` or `manual` |
| `images` | The reference images under `tests/image/references/chrome-real-gpu/` that the shot uses |
| `steps` | The steps that made the picture, for a person who redraws it |
| `alt` | The picture's alt text, which describes what it shows |
| `caption` | The line under the picture |
| `files` | The source files that decide what the picture shows, and its reference image |
| `verdict` | The review that kept the shot |

The `files` list holds the demo's folder and its reference image. A change to either one marks the shot for a redraw. The demo's `<name>/sketch.ts` and a folder such as `examples/showcase/island/` both work.

## Capture the pictures

Run these commands once per computer and checkout:

```sh
bun install
bun run build
bun run shaders
bun run chrome:install
```

Then draw every shot whose sources changed:

```sh
bun tools/docs-screenshots.ts
```

The tool reads the shot's reference image and finds the image test with that name. It opens the same sketch at the same hold time, with the same switches that made the reference. It sets the picture to about 1,600 pixels wide and keeps the reference's shape, so a 320 x 180 reference draws at 1,600 x 900. It waits for the held frame through the engine, as the image tests do, and writes `docs/images/<id>.webp`.

The tool keeps the digest of each shot's sources in `target/docs-screenshots.json`, which git ignores. It skips a shot whose digest and picture have not changed. These options change what it does:

- `--list` prints each shot's plan, or why the tool leaves it out.
- `--force` draws every shot again.
- `--only <text>` draws the shots whose ID holds the text, such as `--only instances`.
- `--width <pixels>` sets another width, which stays 1,600 unless a page needs more.

The tool prints each picture it writes, with its size and its file size. It exits with an error when a shot fails, after it tries the others.

## Review a picture

A shot is right when a reader sees the feature that the page describes.

1. Open the WebP picture and read the page's alt text and caption beside it.
2. Check that the frame is the first full frame, with every model, texture and shadow in place.
3. Check that the view is the demo's default view, unless the entry names another.
4. Check the caption against the picture. The caption says what the picture shows, not what the demo does.
5. Check that no text from the page, such as a label or the stats overlay, is missing from a picture whose caption promises it.

A shot of the developer tools shows the panel, the columns that the entry names, and numbers that match the alt text. Take it by hand and write the WebP file.

## Place a picture

Show a shot with a Markdown image and its caption:

```md
![A field of about 100,000 columns in one instance batch.](../images/concepts/instances/instances.webp)

One dynamic batch: the sketch writes every column's height in every frame.
```

The image path is relative to the page. A page in an area folder uses `../images/`, and the home page uses `images/`. A page that shows a picture must have its entry, and the entry's picture must exist. An entry that no page shows yet may wait for its picture, because the pictures land page by page.

## Redraw a shot

A change to a demo, a scene, a sketch, a reference image or the engine moves the pictures that show it.

1. Run `bun tools/docs-screenshots.ts`. The tool draws the shots whose sources changed.
2. Open each new picture and review it.
3. Commit the picture with the change that moved it.

When the picture still holds, a commit of the range carries a trailer that says why:

```text
Screenshots-Checked: the sun moves behind the camera; the demo's first frame does not change
```

The trailer value says what you checked. A bare value such as "done" is refused.

## The checks

- `bun run docs:check` refuses a page that shows a picture without an entry, and a shown entry without its picture. It also refuses a reference image that the list names and the tree lacks.
- The pre-commit hook runs the same check, so a commit cannot leave the pages and the pictures out of step.
- The trailer check refuses a range that changes a shot's `files` without redrawing its picture, unless a `Screenshots-Checked:` trailer gives the reason.

Unit tests cover each check: `tools/lib/screenshots.test.ts`, `tools/hooks/check-screenshots.test.ts` and `tools/hooks/check-screenshots-ack.test.ts`.

## The shots that wait

The tool draws every shot whose reference names one image test. Some entries wait for a person:

- A shot with several `images` joins them. Compose it from the reference images or from fresh captures, and match the labels that its steps name.
- A `manual` shot shows the browser's developer tools. Take it by hand and keep the panel and columns that its steps name.
- A `scripted` shot with no reference image opens a page that the tool cannot derive, such as a new project from a template. Capture it once and write its WebP file.

Record the redraw in the pull request that places the picture.
