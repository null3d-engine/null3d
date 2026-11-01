# D-260: Open-source readiness before the API freeze

Status: decided by the owner. Built: the built WebAssembly modules hold no folder of the builder's
machine. Tasks: M4-O1 to M4-O6.

Summary: M4 makes the repository ready for outside contributors. Decision records are simplified,
and user docs do not link to them. Dated history becomes the key points a reader needs. The user
docs cover everything a user of the engine needs. The build and CI tooling serve one pull request
per feature. No text or script refers to the owner's machine, and every script works for any
developer.

## Question

What must change before other developers read and contribute to the repository?

## Rule

The repository is open source, and other developers will read it and contribute to it. It must be
clean and reusable. It holds no comments, code or scripts that are specific to the owner's MacBook,
and its build process and scripts work for any developer.

## Decision

M4 holds six tasks:

- M4-O1: refactor the decision records. Remove redundant and superseded text, and update every
  reference to the records. User-facing docs do not link to them.
- M4-O2: rewrite the dated, changelog-like text in code comments, `.dev`, `docs/` and AGENTS.md
  into the key points that a reader needs.
- M4-O3: refactor the user docs to cover every feature of the engine and the add-ons, the
  development process, distribution, and everything else a user needs.
- M4-O4: refactor and clean up the build and CI tooling. Remove what serves only the milestone pull
  requests, since after the first release each feature goes in its own pull request again.
- M4-O5: replace references to the owner's MacBook with generic terms.
- M4-O6: make the build process and scripts reusable by any developer.

## Consequences

- `tools/hooks/task-ids.txt` lists M4-O1 to M4-O6, so commits can name them.
- The compiler writes the Rust toolchain's folder and cargo's home into a WebAssembly module's
  panic locations, and with them the builder's user name. Left as they are, the shader compiler
  module that `@null3d/vite-plugin` publishes holds 183 such paths. Of those, 22 come from the
  toolchain and 161 from 21 crates, such as naga and regex. The asset tool's module, which `@null3d/cli` publishes,
  holds 27, from the toolchain and 3 crates. The engine's two cores hold 9 and 20. The build gives
  these folders fixed paths, and it refuses a module that still holds a folder of the machine. So no
  built file names the builder's machine, as M4-O5 asks of the text
  ([Benchmarks](../benchmarks.md#download-size)).
