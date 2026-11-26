# D-402: Docs screenshots redraw with the change that moves them

Status: decided and built. Hard rule 44 states the rule. `docs/images/shots.json` lists every shot. `tools/docs-screenshots.ts` draws the shots that the image test manifest can draw. The docs check, the pre-commit hook and the trailer check keep pages and pictures in step. A shot that joins several pictures, or that a person takes with the developer tools, still waits for a person.

Summary: The docs show 166 pictures on 235 placements across 95 pages. A change that moves what a demo, scene or docs page draws updates the pictures that show it, in the same change. This works as rule 34 does for picture references. Every picture is drawn at about 1,600 pixels wide, because the image test references are only 320 x 180 and look soft on a page.

## Question

How do the docs keep a picture in step with the thing it shows?

## Rule

The owner's ruling: a change that moves what a demo, scene or docs page draws updates the screenshots that show it, in the same change. A picture that a page shows has one entry in `docs/images/shots.json` and one file at `docs/images/<id>.webp`. A change that moves a shot's sources redraws its picture, or carries a `Screenshots-Checked:` trailer that says why the picture still holds.

The owner also ruled the capture width. The image test references are 320 x 180 pixels, which a page shows as a soft picture. Each shot is therefore drawn again from the same sketch at about 1,600 pixels wide, the demo's default view included. A reference that changes marks its shot for a redraw, so the reference image sits in the shot's `files`.

## Data

| Measure | Figure |
| --- | --- |
| Shots the review kept | 166 |
| Placements on pages | 235 |
| Pages that show at least one shot | 95 |
| Shots whose reference names one image test | 86: 59 demos and 27 test sketches |
| Shots that join two or more pictures | 26 |
| Shots with no reference image | 54: 10 taken with the developer tools, 44 scripted with no reference |
| Size of an image test reference | 320 x 180 pixels |
| Size of a docs picture | 1,600 x 900 pixels at the usual 16:9 shape |

How the figures were produced: a parse of section 7 of the docs review, and of the reference images under `tests/image/references/chrome-real-gpu/`. The 86 single-image shots each name a test in `tests/image/manifest.ts`, so the tool reuses that test's sketch, hold time and switches.

The rule also needs a number that no other rule holds. Hard rules keep their number for good, and records, guides and code cite them, so the new rule takes the next free number, 44. Its text points to rule 34, which holds the picture-reference rule for tests.

## Look

The larger picture looks better. At 320 pixels wide the fine work of a demo looks soft on a page. A shadow's edge or a row of instanced columns shows it. At 1,600 pixels wide the same frame shows the feature that the page describes. The larger picture costs more bytes. A WebP file keeps each picture near a few hundred kilobytes.

## Decision

- Hard rule 44 states the screenshot rule beside rule 34.
- `docs/images/shots.json` holds the review's entries. Each shot keeps `id`, `pages`, `source`, `images`, `steps`, `alt`, `caption`, `files` and `verdict`, and an optional `note`. Its `files` adds the reference image path, so a reference change flags the shot.
- `tools/docs-screenshots.ts` draws each shot whose reference names one image test. It opens the image page at the test's sketch, hold time and switches, at 1,600 pixels wide. It waits for the held frame through the engine, and writes a WebP picture. It keeps a digest of each shot's sources in `target/docs-screenshots.json`, and skips a shot whose sources have not changed.
- `bun run docs:check` refuses a page that shows a picture without an entry, and a shown entry without its picture. It also refuses a reference image that the list names and the tree lacks.
- The pre-commit hook runs the same check. The trailer check refuses a range that changes a shot's sources without redrawing its picture, unless a `Screenshots-Checked:` trailer gives the reason.
- An entry that no page shows yet may wait for its picture, because the pictures land page by page.

Options rejected:

- Use the 320 x 180 references as they are. They are the test references, not page pictures, and a page shows them soft.
- Keep the pictures only in the test reference sets. The sets carry one environment and tier each, use the reference preset, and a page cannot point into them.
- Capture each page with the browser's own screenshot. Rule 16 keeps page pictures behind the engine's frame reader, and a browser screenshot leaves the page's own elements in the picture.
- Draw all 166 shots with one command. A shot that joins pictures has no single page to open. One that shows the developer tools has none either. The tool reports both, and a person finishes them.
- Renumber the hard rules so the new rule sits at 35. Every later rule is cited by number in records, guides and code, so a renumber breaks those citations.

## Consequences

- A demo, scene, sketch or reference change now moves a picture in the same change. The branch that places a picture redraws it with the tool.
- The tool needs `bun run build`, `bun run shaders` and `bun run chrome:install` before its first run. It uses the repository's own Chrome for Testing and the engine's frame reader, never the installed Google Chrome.
- The 26 joined shots and the 54 shots without a reference still need a person. [Screenshots](../screenshots.md) says how to take one and where to write it.
- The guide [Screenshots](../screenshots.md) holds the capture, review, placement and redraw steps, and the checks that guard them.
