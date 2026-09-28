---
id: guides/agents
title: Working with AI agents
status: planned
since: "0.1"
summary: "Installing the null3d skills in Claude Code, claude.ai and other agent tools; docs by ID; the MCP server and AGENTS.md in templates (0.3)."
---

# Working with AI agents

> Planned for null3d 0.1. No release has these APIs yet, so coding agents must not use them.

null3d comes with two agent skills. A skill is a folder of instructions that a coding agent loads when a task needs it.

| Skill | What it does |
| --- | --- |
| `null3d-develop` | Builds, debugs and speeds up null3d projects, including product and marketing pages |
| `null3d-port-threejs` | Ports three.js and React Three Fiber projects to null3d |

Install the skills that match the engine version your project uses. Each release of the engine has its own skills.

## Claude Code

```sh
claude plugin marketplace add https://raw.githubusercontent.com/null3d-engine/null3d/main/.claude-plugin/marketplace.json
claude plugin install null3d@null3d
```

The plugin holds the skills of the latest release, and Claude Code downloads only the skills, not the engine's source. They appear as `null3d:null3d-develop` and `null3d:null3d-port-threejs`. After a new release, `claude plugin marketplace update null3d` fetches its skills.

## claude.ai and the Claude desktop app

Each release's page on GitHub has `null3d-develop.zip` and `null3d-port-threejs.zip` attached. Upload each zip where the app lets you add skills.

## Other agent tools

The [`skills` command](https://github.com/vercel-labs/skills) installs a skill into many agent tools, including Claude Code, Cursor and OpenCode. Give it the folder of each skill in the release that your project uses:

```sh
bunx skills add https://github.com/null3d-engine/null3d/tree/0.1.0/.claude/skills/null3d-develop
bunx skills add https://github.com/null3d-engine/null3d/tree/0.1.0/.claude/skills/null3d-port-threejs
```

Replace `0.1.0` with your engine version. The command asks which agents to install into, and `-a` names them.

To install by hand, copy each skill's folder from `.claude/skills/` in the release into your agent's skills folder, and keep the folder's name. Use those copies: the repository's `skills/` folder also holds test material for the skills.

## Docs by ID

Every docs page has an ID, such as `concepts/architecture`: its path under `docs/` without `.md`. The skills name pages by ID, and each page's status says whether its API exists yet. Agents never use an API whose page is `planned`.

## Coming later

- 0.3: `bunx @null3d/cli mcp`, a Model Context Protocol server connected to the running dev session. Agents list and adjust objects, capture frames, and read frame statistics and errors through it.
- 0.3: project templates from `bunx @null3d/cli create`, each with an `AGENTS.md` for agents without skills.
