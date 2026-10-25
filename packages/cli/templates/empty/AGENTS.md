# Rules for AI agents in this project

This project uses null3D {{null3dVersion}}. Every `@null3d/*` package uses that version.

Read the `null3d-develop` skill before you change the scene. If the project has
`.claude/skills/null3d-develop/SKILL.md`, read that file first. If it does not, read the engine docs
in `node_modules/@null3d/engine/docs/`. They match the installed version.

## Rules

1. Read the docs page before you call an API. A page whose status is `planned` describes an API
   that does not exist in this version.
2. Do not wait with `sleep`. Run a check that finishes on its own, such as
   `bunx @null3d/cli test`, or use the tool's own time limit.
3. Stop only a process that you started, by its PID. Do not stop a process by name.
4. Read a log file once, for example with `tail -n 200 <file>`. Do not follow a log.
5. `onUpdate` runs every frame. Make no object, array or string there. Make each one once outside
   `onUpdate`, and reuse it.
6. The sketch runs in a worker and has no DOM. Keep HTML, `document` and `window` in `page.ts`, and
   send messages between the two. A sketch on the main thread may use the DOM, but it shares the
   page thread.
7. Run `bunx @null3d/cli test` before you report the work as done.

## What the hook checks

The hook holds one rule for each command and each edit. A rule with the action `refuse` blocks the
call, and the agent must find another way. A rule with the action `flag` tells the agent, and the
call goes on.

| Rule | Action | What it checks |
| --- | --- | --- |
| `no-sleep` | refuse | A command that waits with `sleep`. |
| `no-kill-by-name` | refuse | `pkill`, `killall`, or `kill` with a process name. |
| `no-log-follow` | refuse | `tail -f`, `journalctl -f`, `docker logs -f` and their like. |
| `no-planned-api` | flag | An import that the installed engine does not export. |
| `no-allocation-in-onupdate` | flag | An object, array or string made inside `onUpdate`. |
| `no-dom-in-sketch` | flag | A DOM name in `sketch.ts`. |

Claude Code runs the hook through `.claude/settings.json`, and Codex runs it through
`.codex/hooks.json`. Both run `.agent/agent-hook.mjs`, which takes its rules from
`@null3d/cli/agent-rules` in the installed packages. The hook needs `bun install` to find the rules.

The hook is optional: delete its entries in `.claude/settings.json` and `.codex/hooks.json`, or the
hook file, to stop the checks.
