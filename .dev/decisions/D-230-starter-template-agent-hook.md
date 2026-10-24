# D-230: The starter template's agent hook

Status: decided. Date: 23 October 2026. Task: M3-R16.

Summary: A new project from `bunx @null3d/cli create` ships an `AGENTS.md` and a Claude Code hook. The hook refuses waiting with `sleep`, stopping a process by name, following a log, and allocating in `onUpdate`. It also refuses DOM access from the sketch and an import that the installed engine does not export. It reads the installed engine's declarations for the last rule, so the rule follows the project's real version.

## Question

How does a new null3D project keep an AI agent inside the engine's rules, with no build step, no extra package and no network call?

## Rule

A rule ships only when the hook can check it from the call itself, or from the packages that the project installs. The hook allows a call whose input it cannot read, so its own fault never stops work. A rule that needs a build, a browser or a measurement stays out of the hook.

## Decision

The template holds two agent files. The `empty` template's `AGENTS.md` gives the rules to every agent, and it names the installed null3D version and the `null3d-develop` skill. Claude Code reads `.claude/settings.json`, which runs `.claude/agent-hook.mjs` before each Bash command and each file edit. Codex and other agents read `AGENTS.md` and follow the same rules. Those agents have no hook of the same form.

The hook checks the installed engine's declarations for the planned-API rule. A planned API does not exist, so its name is absent from the installed declarations. This follows the project's version with no list to maintain. The other rules read the call alone.

The rules match the list that the ESLint plugin will share. When that plugin is built, it takes the same rules, and the two implementations stay in step through the list in `AGENTS.md`.

## Consequences

`@null3d/cli` ships the templates in its package, and `create` fills in the version and the project's name. It refuses to overwrite an existing `.claude/settings.json`, so a project keeps hooks of its own. The docs add `getting-started/project-structure` and a `create` section on `cli/null3d`. A future template, such as the character or product-viewer template, carries the same two agent files.

## Addendum, 25 October 2026: a Codex hook, and a hook that ran nowhere

Codex CLI now has `PreToolUse` hooks. The reason for leaving Codex out is no longer true. Codex
reads `.codex/hooks.json` or `.codex/config.toml` in a project. It matches a handler on
`tool_name`, and gives the handler the call as JSON on stdin. The handler refuses a call with exit
code 2 and a reason on stderr. Codex asks the user to trust a project's hooks, with `/hooks`,
before it runs them (OpenAI's Codex hook documentation).

The template now ships `.codex/hooks.json`, which runs the same `.claude/agent-hook.mjs` for `Bash`
and for a file edit. Codex sends a file edit as one `apply_patch` call. Its `tool_input.command`
holds the patch text. The hook reads each file's added lines and applies the same rules to them.
The two hosts share one implementation, not two copies.

The tests exposed a fault in the hook's entry check. It compared the file's import address with the
path in `argv`. A project under a linked path made the two differ. A temporary folder and a linked
home folder are such paths. The hook then exited 0 without reading the call, so every rule did
nothing, silently. The check now compares the real paths of both. The new test creates the project
in the temporary folder, which is such a path.

The test that runs a created project's hooks reads both configured files. It runs each command as
its host does. It checks that the project's own sketch and build command pass, while a forbidden
command and a DOM edit are refused. The project's own build does not run in that test, because a
unit test installs no packages. The fresh-project test builds and runs a packed project.
