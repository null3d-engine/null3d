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

Claude Code checks rules 2 to 6 before each command and each edit, through the hook in
`.claude/settings.json`. Codex and other agents read this file and follow the same rules. The hook
is optional: delete its entries in `.claude/settings.json`, or the hook file, to remove these
checks.
