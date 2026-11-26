# start-substance-08

## Finding as given

- page: getting-started/project-structure
- anchor: ## The agent files, line 70 "The project does not hold a copy of the skill today."
- category: missing-content
- severity: medium
- claim: The page says that an agent reads .claude/skills/null3d-develop/SKILL.md when it exists, but it never says how to add the skill. "Today" suggests a later change. The For AI agents guide, which gives the install steps, is not linked.
- evidence: docs/guides/agents.md:29-40 (the plugin, the release zips, `bunx skills add .../null3d-develop`).
- proposedEdit: "The template holds no copy of the skill. [For AI agents](../guides/agents.md) shows how to add it, as a Claude Code plugin or with `bunx skills add`. When the project has `.claude/skills/null3d-develop/SKILL.md`, an agent reads that file. Otherwise it reads the engine docs in `node_modules/@null3d/engine/docs/`."
- generatedSource: (none, hand-written page)

Verdict: survives

## Evidence

- docs/getting-started/project-structure.md:70 says "The project does not hold a copy of the skill today." The page ends at line 78. Its only links are to first-scene.md (line 66). A search for "agents.md" and "skill" finds no link to guides/agents.md and no install step anywhere on the page.
- "today" is a time word that suggests the template will change. It gives the reader nothing to act on.
- packages/cli/templates/empty/ holds `.claude/settings.json` only, no `skills/` folder, so "the template holds no copy" is correct. The template AGENTS.md (lines 5-7) gives the same read order as the page.
- docs/guides/agents.md:22-46 gives the install steps: the Claude Code plugin, the release zips, `bunx skills add`, and a copy by hand.

## Correction to the proposed edit

The claim holds. The proposed edit needs one fix. A Claude Code plugin install (agents.md:24-29) does not write `.claude/skills/null3d-develop/SKILL.md` into the project. The skill then loads as `null3d:null3d-develop` from the plugin. The proposed text puts the plugin and the project file side by side, so a reader can think the plugin makes that file. The guide's page title is "Working with AI agents", so the link text should match it.

Corrected edit:

"The template holds no copy of the skill. [Working with AI agents](../guides/agents.md) shows how to install it: as a Claude Code plugin, with `bunx skills add`, or by a copy of its folder. When the project has `.claude/skills/null3d-develop/SKILL.md`, an agent reads that file. Otherwise the agent reads the engine docs in `node_modules/@null3d/engine/docs/`, which match the installed version."
