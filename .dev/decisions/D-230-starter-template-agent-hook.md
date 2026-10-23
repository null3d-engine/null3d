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

`@null3d/cli` ships the templates in its package, and `create` fills in the version and the project's name. The docs add `getting-started/project-structure` and a `create` section on `cli/null3d`. A future template, such as the character or product-viewer template, carries the same two agent files.
