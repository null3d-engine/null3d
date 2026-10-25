# D-230: The starter template's agent hook

Status: decided. Date: 23 October 2026. Updated: 26 October 2026. Task: M3-R16.

Summary: A new project from `bunx @null3d/cli create` ships an `AGENTS.md` and one agent hook. Claude Code and Codex each run that hook. It refuses waiting with `sleep`, stopping a process by name and following a log. It flags an allocation in `onUpdate`, a DOM name in the sketch and an import that the installed engine does not export. Every rule lives in `@null3d/cli/agent-rules`, so the hook and any other null3D tool share one definition.

## Question

How does a new null3D project keep an AI agent inside the engine's rules, with no build step and no network call?

## Rule

A rule ships only when the hook can check it from the call itself, or from the packages that the project installs. The hook allows a call whose input it cannot read, so its own fault never stops work. A rule that needs a build, a browser or a measurement stays out of the hook.

## Decision

The template holds one hook and one settings file for each agent. `.agent/agent-hook.mjs` holds the hook. `.claude/settings.json` runs it before each Bash command and each file edit. `.codex/hooks.json` runs it before each Bash command and each `apply_patch`. One hook file serves both agents, because two copies would drift. The hook finds the project from `CLAUDE_PROJECT_DIR`, from the call's `cwd`, or from its own folder. It reads no project file except the one an edit writes.

The rules live in `packages/cli/src/agent-rules.js`, which the package exports as `@null3d/cli/agent-rules`. The command-line tool is their home, because it ships the templates and the hook. The hook reads that module from the installed package, so a rule has one definition, one message and one test. A lint rule takes the same module when it is built.

The rules take two actions. The three command rules refuse the call, because the agent can choose another command at once. The three source rules flag it, because a text scan cannot prove an allocation, and a refusal would block sound code. A flag answers with `hookSpecificOutput.additionalContext`, which Claude Code and Codex both show to the model without stopping the call. A refusal exits with code 2 and writes the reason to stderr, which both agents read as a block.

An edit is checked as the whole file that it leaves behind, not as the edited text alone. So an allocation added inside an existing `onUpdate` is caught. A Codex patch is applied to the file on disk in the hook, and the check reads the result. A patch that does not fit the file falls back to the lines that its hunks carry, context included. Their numbers then count from the start of those lines.

The planned-API rule reads the installed engine's declarations. A planned API does not exist, so its name is absent from them. That follows the project's version with no list to maintain.

## Consequences

`@null3d/cli` ships the templates and the rules module in its package. `create` fills in the version and the project's name. It refuses to overwrite an existing `.claude/settings.json` or `.codex/hooks.json`, so a project keeps hooks of its own.

The hook needs the installed packages. Before `bun install` it allows each call and writes one line to stderr, and it never blocks on its own fault. Codex runs the hooks of a folder that the user trusts. The docs add `getting-started/project-structure` and a `create` section on `cli/null3d`. A future template carries the same three agent files.
