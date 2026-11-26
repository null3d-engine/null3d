# D-395: Published text states limits and makes no promises

Status: decided and written. The docs and the skills state each limit as a present fact. No published text promises a later feature, and the docs check refuses a planned page. The 8 placeholder pages are written.

Summary: The owner ruled that users must know what null3D can and cannot do, and that published text holds no "coming soon" content. Each limit stays, as a present fact with its workaround. Promises, roadmap steps of built features and placeholder pages are gone, and the [gaps guide](../gaps.md) tracks the work that is not done.

## Question

How does published text tell a reader what null3D lacks?

## Rule

The owner decides. The ruling has two parts. Published text holds no "coming soon" content. Users still learn what the engine can and cannot do.

## Data

| Measure | Before |
| --- | --- |
| Placeholder pages with the status `planned` | 8 |
| Lines in the docs and the skills that named a missing, planned or later feature | about 130, in 63 files |
| Step markers such as "(0.2)" in the skills | about 550 |

How the data was produced: a search of `docs/`, `skills/`, the README files and the project template for "not built yet", "planned", "comes in step" and like words.

## Look

The options look the same. The change is text only.

## Decision

A limit is a present fact: "Terrain has no collision." It gives the workaround where one exists. A promise is gone: no "not built yet", "comes in step 0.3", "Coming later" or "after 1.0".

- The 8 placeholder pages are written, and the docs check refuses a page whose status is `planned`.
- The sentences on what a roadmap step adds are gone, because those features are built and the sentences read as future work. Pages carry no status or version labels ([D-397](D-397-docs-without-labels.md)).
- Tools that do not exist, such as a `doctor` command, get no mention. They are not limits of a built feature.
- The skills tell an agent to use only the calls that the installed engine's docs and type declarations show, and to tell the user about a limit that affects the task. That rule replaces the rule against planned APIs.
- The mapping's `post-1.0` status joins `unsupported`.
- The README has no experimental badge and no line about one developer. Docs pages carry no notice that the API can change ([D-397](D-397-docs-without-labels.md)).
- The command line tool's source rule is now `no-unknown-api`, in place of `no-planned-api`.

Options rejected:

- Removing every gap, with no statement of limits. The owner first chose it, then reversed it: users must know what the engine cannot do.
- Keeping the "not built yet" notes. They promise features, which the owner ruled out.

## Consequences

A branch that finds a limit states it on the feature's page and adds it to the [gaps guide](../gaps.md). A branch that removes a limit removes its sentence and its line in the guide ([AGENTS.md](../../AGENTS.md#hard-rules), rule 19).
