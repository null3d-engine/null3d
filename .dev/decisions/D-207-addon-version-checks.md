# D-207: Add-on version checks and the upgrade command

Status: decided. Date: 2026-10-21. Task: M3-D2. This record gives the shape of the run-time version check that [D-173](D-173-addon-hooks.md) ruling 13 requires of each foundation add-on. It also gives the shape of the command that brings a project's null3D packages back to one version.

Summary: Each add-on calls one public engine function, `checkAddonVersion(name, version)`, as its module loads. The function compares the add-on's version with the engine's `VERSION` and throws E1432, which names the add-on and both versions, when they differ. The match is exact, because an add-on pins the engine version it was built for. `bunx @null3d/cli upgrade` reads the installed engine's version. It writes that version into every `@null3d` package that the project's manifest names, in each dependency section and in its overrides. It edits the manifest alone and leaves file, workspace and git specifiers as they are.

## Question

Two shapes answer the add-on rules, and they differ in what a project sees when versions mix:

1. Where does the check live, and what does it compare?
2. What does `bunx @null3d/cli upgrade` move, to which version, and how much does it touch?

## Rule

- An add-on and the engine ship in step, and each foundation add-on pins the engine version it was built for (AGENTS.md, parity rule 13; [D-173](D-173-addon-hooks.md)).
- A page that mixes versions fails at once. Its message names the add-on and both versions (AGENTS.md design principle 10: every error message says how to fix the problem).
- Add-ons reach the engine only through `@null3d/engine` (parity rule 12), so whatever the check needs must be public, with TSDoc, in the API reference.
- An upgrade edits no code, installs nothing, and can be undone by reverting one file.

## Data

- The engine exports `VERSION`, which the release writes with every package manifest, the Rust workspace version and the lockfile (`tools/lib/release.ts`). In the repository every package is at `0.0.0`, so the source path that tests and the dev server read always matches.
- Each foundation add-on's manifest names `@null3d/engine` as a peer dependency at `workspace:*`. A project that installs the tarballs gets the version that the release wrote.
- Before this record, no add-on checked anything at run time. A page that mixed an engine at one version with an add-on at another loaded both and failed later, inside a call, or drew wrong.
- `bunx @null3d/cli upgrade` is the fix that the plan of 15 October 2026 named: exact pins make a partial upgrade fail.

## Decision

**The check.** One function in the engine, in `shared/version.ts` beside `VERSION`:

```ts
checkAddonVersion(name: string, version: string): void
```

It throws `EngineError('E1432', ...)` when `version !== VERSION`. Each foundation add-on holds its own version in `src/version.ts`, which the release writes with the other copies. The add-on calls the function at the top of its entry point:

```ts
import { checkAddonVersion } from '@null3d/engine';
import { VERSION } from './version';

checkAddonVersion('@null3d/controls', VERSION);
```

The engine holds the comparison rather than each package, so the message, the code and the fix text have one source. The call sits at module scope, so the error comes when the sketch imports the add-on, before any frame draws. The match is exact: an add-on is built against one engine version, and a version that differs is not the version it was compiled with.

`tools/lib/addon-versions.ts` checks that every package beside the engine holds a version constant, calls the check with its own package name, and imports the function from `@null3d/engine`. A new foundation add-on is covered without an edit there.

**The command.** `bunx @null3d/cli upgrade [--to <version>] [--dry-run]`:

- It reads `package.json` in the current folder. The version it writes is, in order: `--to`, the installed `@null3d/engine`'s manifest version, the CLI's own version (which releases with the engine).
- It rewrites every `@null3d/*` specifier in `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` and `overrides` to that version, as an exact pin. A specifier that names a file, a link, a workspace or a git address stays as it is.
- It keeps the manifest's indentation and closing newline, writes the one file, and prints each change. It exits with 0 when it wrote or found nothing to do, and 1 when it has no manifest or the manifest is not JSON.

A self-built add-on takes the same command: its `peerDependencies` and `devDependencies` name `@null3d/engine`, and the command raises both to the version the project develops against.

## Consequences

- A mixed-version page stops at the add-on's import with E1432, whose fix names `bunx @null3d/cli upgrade`. The error has a docs page, generated with the other code pages.
- The engine's start code gains one exported function of a few hundred bytes. A sketch that imports no add-on reaches none of it after tree shaking.
- The release writes one more copy per add-on: `src/version.ts`. `tools/lib/release.ts` finds each such file by name, so a new add-on's constant needs no edit there either.
- `docs/api/engine.md` describes the check for add-on authors, `docs/cli/null3d.md` documents the command, and the develop skill's command table and troubleshooting table name both.
- The fresh-project run shows the packaged command moving a manifest's null3D package to the engine's version, and its dry run writing nothing. The check skips with a message when the checkout has no built asset tool.
- The marketplace after 1.0 needs ranges rather than exact pins for add-ons from other sellers ([D-173](D-173-addon-hooks.md)). That ruling changes this check's comparison, and only this function.
