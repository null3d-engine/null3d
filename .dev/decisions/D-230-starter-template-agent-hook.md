# D-230: The starter template's agent hook

Status: decided. Date: 23 October 2026. Updated: 26 October 2026. Task: M3-R16.

Summary: A new project from `bunx @null3d/cli create` ships an `AGENTS.md` and one agent hook. Claude Code and Codex each run that hook. It refuses waiting with `sleep`, stopping a process by name and following a log. It flags an allocation in `onUpdate`, a DOM name in the sketch and an import that the installed engine does not export. Every rule lives in `@null3d/cli/agent-rules`, so the hook and any other null3D tool share one definition.

## Question

How does a new null3D project keep an AI agent inside the engine's rules, with no build step and no network call?

## Rule

A rule ships only when the hook can check it from the call itself, or from the packages that the project installs. The hook allows a call whose input it cannot read, so its own fault never stops work. A rule that needs a build, a browser or a measurement stays out of the hook.

## Decision

The template holds one hook and one settings file for each agent, and `.agent/agent-hook.mjs` holds the hook itself. Claude Code runs it through `.claude/settings.json`, before each Bash command and each file edit. Codex runs it through `.codex/hooks.json`, before each Bash command and each `apply_patch`. One hook file serves both agents, because two copies would drift. The hook finds the project from `CLAUDE_PROJECT_DIR`, from the call's `cwd`, or from the process's working directory. It reads no project file except the one an edit writes.

Codex documents two shapes that the hook reads. A `PreToolUse` hook answers with `hookSpecificOutput.additionalContext` for text that the model sees without a block. An `apply_patch` call carries the whole patch in `tool_input.command`. The hook reads `command` first and falls back to `patch`, `input` and `arguments`, so a build that moves the text does not turn the check off.

The rules live in `packages/cli/src/agent-rules.js`, which the package exports as `@null3d/cli/agent-rules`. The command-line tool is their home, because it ships the templates and the hook. The hook reads that module from the installed package, so a rule has one definition, one message and one test. A lint rule takes the same module when it is built.

The rules take two actions. The three command rules refuse the call, because the agent can choose another command at once. The three source rules flag it, because a text scan cannot prove an allocation, and a refusal would block sound code. A flag answers with `hookSpecificOutput.additionalContext`, which Claude Code and Codex both document as text that the model reads without a block. A refusal exits with code 2 and writes the reason to stderr, which both agents read as a block.

The command rules read the shell rather than the raw text. Quotes and heredoc bodies are data, so a message that talks about `sleep` is not a command. A `#` starts a comment. A redirection names a file, not a process. A shell run with `-c` is read as a command of its own, so `bash -c "sleep 1"` is refused too. A heredoc body is a command when the command before it is a shell, so `bash <<EOF` with `sleep 5` in the body is refused. A word is taken by its base name, so `/bin/sleep` is the same command as `sleep`.

The kill rule reads each target. A number names a process that the agent started. So does a job, a shell expansion such as `${PIDS[@]}` or `${PID:-0}`, or a command that reads a stored number. A bare name does not, and neither does a command substitution that runs `pgrep` or `pidof`. Both `pkill` and `killall` are refused in every form, including `pkill -P`. They match by pattern and by parent, so the hook cannot tell what they will stop. Refusing the family is the price of that. A negative process-group id after `--` is refused, because it can stop processes that the agent did not start. A target that `xargs` passes in from its input is out of sight. It passes unless the command before the pipe looks a name up.

An edit is checked as the whole file that it leaves behind, not as the edited text alone. So an allocation added inside an existing `onUpdate` is caught. An edit that the file no longer fits adds its own lines to the check, so the context around it still counts. A Codex patch is applied to the file on disk in the hook, and the check reads the result. A patch that does not fit the file falls back to the lines that its hunks carry, context included. Their numbers then count from the start of those lines.

A source file is read in one pass that tracks strings, template literals and comments together. A URL in a string therefore starts no comment, and the code after it still counts. The frame update is found in each form it takes. It may be a method, an arrow, a function expression, or a name that points at a function made above it.

The planned-API rule reads the installed engine's declarations. A planned API does not exist, so its name is absent from them. That follows the project's version with no list to maintain.

## Limits

A rule reads the file's text only, so an allocation inside a function that the frame update calls elsewhere goes unseen. Two separate edits in one turn are each checked against the file on disk. When the second one's starting text is not there yet, only its own lines are read. A job name as a kill target is taken on trust, because the hook cannot see the shell's job table.

## Consequences

`@null3d/cli` ships the templates and the rules module in its package. `create` fills in the version and the project's name. It refuses to overwrite an existing `.claude/settings.json` or `.codex/hooks.json`, so a project keeps hooks of its own.

The hook needs the installed packages. Before `bun install` it allows each call and tells the agent to install them, through the same context field that a flag uses. The agent therefore reads why no rule ran, instead of working on unseen. The hook never blocks on its own fault. Codex runs the hooks of a folder that the user trusts. The docs add `getting-started/project-structure` and a `create` section on `cli/null3d`. A future template carries the same three agent files.
