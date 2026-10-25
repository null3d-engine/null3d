---
id: getting-started/project-structure
title: Project structure
status: experimental
since: "0.3"
summary: "Starting from the `empty` template with `bunx @null3d/cli create`; page.ts, sketch.ts, AGENTS.md and the agent hook; what runs where."
---

# Project structure

> Roadmap step 0.3, first released in null3D 0.1.0. The API is experimental, so it can still change between versions. The `empty` template is the only template today.

```mermaid
flowchart LR
    create["bunx @null3d/cli create"] --> project["my-game/"]
    project --> page["src/page.ts<br/>main thread"]
    project --> sketch["src/sketch.ts<br/>sketch worker"]
    project --> agents["AGENTS.md<br/>rules for AI agents"]
    page -- "starts" --> sketch
    sketch -- "scene data" --> draw["Render worker<br/>draws the canvas"]
```

`bunx @null3d/cli create` writes a new project from a template. Start with the `empty` template, then add the scene that your app needs.

## Make a project

```sh
bunx @null3d/cli create my-game
cd my-game
bun install
bunx vite
```

`create` writes the template's files, and it writes the version of the command into each package pin. It installs nothing, so run `bun install` in the new folder.

| Option | Effect | Without it |
| --- | --- | --- |
| `--template <name>` | The template to copy | `empty` |

The folder must not exist, or it must be empty. A folder with files stays as it is, and the command stops.

## The files

| File | What it holds |
| --- | --- |
| `src/page.ts` | The page module, on the main thread. It owns the HTML and calls `createEngine`. |
| `src/sketch.ts` | The sketch module, in the sketch worker. It builds the scene and runs its `onUpdate` in every frame. |
| `index.html` | The page and its canvas. |
| `vite.config.ts` | Vite with the null3D plugin, which sends the headers that the workers need. |
| `tsconfig.json` | The TypeScript settings that `bunx @null3d/cli test` checks the project with. |
| `package.json` | The project's name, scripts and packages. Every `@null3d/*` package takes one version. |
| `AGENTS.md` | The rules for an AI agent that works in the project. |
| `.claude/settings.json` | The Claude Code hook that checks the rules before each command and each edit. |
| `.claude/agent-hook.mjs` | The hook's code, which Claude Code and Codex both run. It needs no package. |
| `.codex/hooks.json` | The Codex hook that runs the same code on Codex's tool calls. |

[Your first scene](first-scene.md) explains the page module, the sketch module and the engine's calls.

## The agent files

`AGENTS.md` names the installed null3D version and the `null3d-develop` skill. The project does not hold a copy of the skill today. When the project has `.claude/skills/null3d-develop/SKILL.md`, an agent reads that file. Otherwise the agent reads the engine docs in `node_modules/@null3d/engine/docs/`, which match the installed version.

Claude Code runs the hook before each Bash command and each edit. The hook refuses a command that waits with `sleep`, stops a process by name or follows a log. It refuses an edit that makes an object in `onUpdate`, or that reaches the DOM from the sketch. It also refuses an import of a name that the installed engine does not export. A refused call stops with a message that gives the fix.

Codex runs the same hook before a shell command and before a file edit, through `.codex/hooks.json`. Codex sends a file edit as one patch, which the hook reads file by file. Codex asks you to trust a project's hooks, with `/hooks`, before it runs them.

Other agents read `AGENTS.md` and follow the same rules.
