# Verdicts: getting-started/install (shots and demo links)

## Shot: shader-compile-line (manual) - REJECT

- Wrong source type. A "manual" shot is only for the browser's own developer tools. This is terminal output from the build.
- A picture is the wrong form for one line of terminal text. A reader cannot copy or search it, and it goes stale when the message changes.
- The line is real. The shader cache prints it once per build when a compile starts (packages/vite-plugin/src/shader-cache.ts, the method that announces a compile):
  `null3D: compiling the shaders of <file>. A compile takes up to a second, and the results are kept in <cache folder>, so later builds do not compile again.`
- Better: quote the line as a text code block under "## Builds", in the paragraph about the first build. If the page quotes it, it must stay in sync with that source file.
- Wrong source file in the proposal: the line comes from shader-cache.ts, not from index.ts.

## Demo link: generators/ for "A first project to run" - REJECT

- The code is valid: the demo `generators` exists in examples/demos.ts and has no code value, so "generators/" fits the contract.
- It does not show the concept. The folder holds only one sketch file. It has no page file, no Vite config and no package file. It imports a helper from the examples' shared folder (../lib/interact). A reader cannot run it as a project of their own.
- The sketch is a gallery of nine geometry shapes with sky, fog, bloom and a texture made in code. It teaches geometry generators, not install or a first run.
- The real "first project to run" is the `empty` template that `bunx @null3d/cli create` writes (packages/cli/templates/empty). It is not a demo, so link it in text through Project structure (project-structure.md), not as a demo link.

## Concepts said to have no demo - all CONFIRMED

- The Vite plugin's jobs: every demo is built with the plugin, but no demo shows its jobs (headers, compression, worker format, notices, file list).
- The shader cache: no demo shows it. It is build-time behavior.
- Version pinning: package metadata only. No demo.
- Installing the CLI: a terminal step. No demo.
