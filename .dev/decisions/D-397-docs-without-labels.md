# D-397: Docs pages carry no status or version labels

Status: decided and built. No docs page carries a status or a version label, and the docs check accepts a page without them. The owner may still label a page on purpose.

Summary: The website shows a page's `status` and `since` front matter as tags, such as EXPERIMENTAL and SINCE 0.3, and every written page carried both. By the owner's ruling, pages carry neither. The note under each title loses its release and status sentences, and the page list loses its Status and Step columns. Only the owner adds a label to a page.

## Question

Which labels does a docs page show about its maturity and its version?

## Rule

The owner decides. The website renders the docs from this repository and turns the front matter's `status` and `since` into tags at the top of each page. A label appears only where the owner chooses one.

## Data

| Measure | Before |
| --- | --- |
| Written pages with `status` and `since` | 103: 102 `experimental`, 1 `stable` |
| Notes under a title that opened with "Roadmap step 0.x, first released in null3D 0.1.0." | 102 |
| Of those, notes with no other text after the release and status sentences | 71 |
| Error codes with a `since` field | 79 |
| Columns that showed the labels | Status and Step in the page list; Since in the three.js mapping |

How the data was produced: a search of the front matter and the first quoted line of every page under `docs/`, and of `packages/engine/src/errors/codes.ts` and `docs/data/threejs-mapping.json`.

## Look

The options look the same. The change is text only.

## Decision

Pages carry no labels by default.

- The front matter of a written page holds `id`, `title` and `summary`. A page that a generator writes also holds `generated: true`, which replaces the status `generated`. The docs check uses it to find a generated page that nothing writes any more.
- `status` (`experimental` or `stable`) and `since` (a release, such as `"1.2"`) stay valid fields. Only the owner adds one, to a page that needs the tag.
- The note under a title loses its release and status sentences. A note that held only those is gone. A note that also stated limits keeps them. The baked light data page keeps "The format is stable", which describes its file format.
- The page list, the three.js mapping and its skill copy lose their Status, Step and Since columns. The mapping keeps its own status column (direct, changed, manual, unsupported), which says how each three.js API ports.
- The docs home loses its table of status labels. Four package READMEs lose the sentence that their API is experimental.
- The release script no longer checks pages that are still planned against the version, because pages carry no version. The docs check already refuses a planned page (hard rule 19).

Options rejected:

- Keep the labels and hide them on the website. Two sources would then disagree about what a page shows, and agents that read the raw pages would still see them.
- Keep `since` with real release numbers. Every built page ships in the first release, so the tag would say the same thing on every page.

## Consequences

- `tools/lib/steps.ts` is gone, with the note check and the check that refused a roadmap step named as a release.
- [D-395](D-395-limits-without-promises.md) no longer keeps a notice on each page that the API can change.
- The develop skill no longer tells agents to read a page's status.
- The website shows no tags until the owner adds a label to a page.
