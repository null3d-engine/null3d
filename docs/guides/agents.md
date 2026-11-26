---
id: guides/agents
title: Working with AI agents
status: experimental
since: "0.1"
summary: "Installing the null3D skills in Claude Code, claude.ai and other agent tools; docs by ID; the test loop; the MCP server and the in-page inspector."
---

# Working with AI agents

> Roadmap step 0.1, first released in null3D 0.1.0. The API is experimental, so it can still change between versions.

null3D comes with two agent skills. A skill is a folder of instructions that a coding agent loads when a task needs it.

| Skill | What it does |
| --- | --- |
| `null3d-develop` | Builds, debugs and speeds up null3D projects, including product and marketing pages |
| `null3d-port-threejs` | Ports three.js and React Three Fiber projects to null3D |

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

Every docs page has an ID, such as `concepts/architecture`: its path under `docs/` without `.md`. The skills name pages by ID.

## The test loop

An agent checks its work with the `null3d` command, which prints short lines of text and saves images ([The `null3d` command](../cli/null3d.md)):

1. Change the code.
2. Run `bunx @null3d/cli test`. It type checks the project, runs its lint script, and compares each image test that `null3d.json` lists with its reference image.
3. Read the lines that it prints: pass or fail for each check, the reason, and the image files.
4. When an image test fails, open the image and its diff. Fix the code, or keep the new image with `bunx @null3d/cli test --update-references` when the change was on purpose.

`bunx @null3d/cli shot` draws one frame of a page, to look at a change that has no test yet.

## The MCP server

`bunx @null3d/cli mcp` starts a Model Context Protocol server for the project in the current folder. It runs over stdio, and an agent uses it to look inside the running scene and change it live. The server needs a development build, because a production build leaves the inspection channel out.

By default the server starts the project's own Vite dev server and a headless Chrome, as `shot` does. This works on a cloud agent with no window. With `--connect <endpoint>` it attaches to a Chrome that the developer already runs with a remote debugging port. It then drives the tab that shows the page, so the agent sees exactly what the developer sees. [Debugging](debugging.md#the-mcp-server) lists the options and the tools, and [the `mcp` command](../cli/null3d.md#mcp) is the full reference.

Register the server in Claude Code with:

```sh
claude mcp add null3d -- bunx @null3d/cli mcp
```

The tools list and read objects, and change a transform or a material. They capture a frame, and read the frame figures, the errors and the render graph. They also switch the quality preset or the GPU path. Live changes are for exploring: the agent writes the final values into the sketch and its tests, and checks them with `bunx @null3d/cli test`.

The page also shows a panel of its own with `?inspect`, which lists the scene, selects an object and edits it. [The in-page inspector](debugging.md#the-in-page-inspector) describes it.
