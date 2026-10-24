# Example add-ons

The content add-ons are example add-ons, not npm packages ([D-173](../../.dev/decisions/D-173-addon-hooks.md),
ruling 5). Each one shows how a feature is built above the engine's public API, and each is small
enough to copy into a project.

## The shape

Each add-on is a folder named after it, and it is shaped like a package:

- `index.ts`: the add-on's code and its types, with a TSDoc summary on every export.
- A `.wgsl` file for its shaders, imported by `index.ts` (the Vite plugin compiles it), with the
  `.wgsl.d.ts` declaration that the plugin writes beside it.
- `README.md`: what it draws, its calls, its costs and its limits.
- The engine's licences: MIT OR Apache-2.0, the two files at the repository root. An add-on's README
  says so; it does not copy the licence texts.

## The rules

- It reaches the engine only through `@null3d/engine` and `@null3d/engine/stats`. `bun run check`
  refuses any other import, as it does in the examples ([rule 12](../../AGENTS.md)).
- It loads on first use in a shipped add-on. An example add-on is imported by its demo, so it costs
  that page alone.
- It draws on both GPU paths, or its README states its fallback.
- Its demo lives in `examples/`, and the demo's image test draws it on every GPU tier.
- No package imports an example add-on. An example is never published, so a package that took one
  would not pack.

## The check

`bun run check` holds the shape. It refuses a folder without the entry, the shader and its
declaration, or the README's licence section. It also refuses a package that imports a file under
`examples/`. A test reads the real folders, so an add-on joins the layout by existing in it.

The folders here are `traffic-lanes`, `lens-kit`, `aurora` and `car-paint`, and the ones that
later tasks add: facades, screens and weather.
