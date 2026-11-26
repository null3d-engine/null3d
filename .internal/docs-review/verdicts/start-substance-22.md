# start-substance-22

## Finding as given

- page: getting-started/project-structure
- anchor: ## The agent files lines 72-78; ## Make a project line 39 `bunx vite`
- category: missing-content
- severity: low
- claim: The page does not say how to turn off the hook, although the template's own AGENTS.md does. The template has dev, build and preview scripts, but the page runs `bunx vite` and never names them.
- evidence: packages/cli/templates/empty/AGENTS.md ("The hook is optional: delete its entries..."); packages/cli/templates/empty/package.json scripts.
- proposedEdit: Add "To stop the checks, delete the hook's entries in `.claude/settings.json` and `.codex/hooks.json`, or delete the hook file." Use `bun run dev`, and list `build` and `preview` in the package.json row.

## Verdict: partly

## Evidence

Hook half holds:
- docs/getting-started/project-structure.md:68-78 explain what the hook runs through, what it refuses and flags, and where its rules come from. No line says how to turn it off.
- packages/cli/templates/empty/AGENTS.md says "The hook is optional: delete its entries in `.claude/settings.json` and `.codex/hooks.json`, or the hook file, to stop the checks." So the fact exists in the template but not on the page. A reader who finds the hook gets in the way has no answer on the page. Low severity is right.

But the "or delete the hook file" part of the edit is poor advice:
- packages/cli/templates/empty/.claude/settings.json runs `node "$CLAUDE_PROJECT_DIR/.agent/agent-hook.mjs" ...` on every Bash and every edit. With the file gone, node fails on every call, so the agent gets a hook error each time instead of a clean stop.
- packages/cli/templates/empty/.codex/hooks.json walks up the folders for the file and then runs node on it anyway, so it fails in the same way.
- The page should give only the clean way: delete the hook's entries in the two settings files.

The `bunx vite` half is refuted:
- `bunx vite` is the command used on every related page: docs/getting-started/install.md:86, docs/getting-started/first-scene.md:119 (with `bunx vite build` and `bunx vite preview` at :122), docs/cli/null3d.md:39, docs/guides/deploying.md:26. Changing only this page to `bun run dev` would make it the odd one out.
- `bunx vite` works in the project: vite is a devDependency, and the scripts are plain `vite`, `vite build` and `vite preview` (all three templates' package.json are the same). Nothing a reader does goes wrong.
- The package.json row at line 59 already says the file holds the project's scripts. Naming them is polish, not missing content.

## Corrected claim

The page does not say how to turn off the agent hook, although the template's AGENTS.md does. The `bunx vite` command is correct and matches the rest of the docs, so it needs no change.

## Corrected edit

After line 72 in "## The agent files", add: "The hook is optional. To stop its checks, delete its entries in `.claude/settings.json` and `.codex/hooks.json`." Do not suggest deleting only the hook file: both settings files still call it, so each command and edit would then end with a hook error. (Also drop "or the hook file" from packages/cli/templates/empty/AGENTS.md, and from the other two templates if they hold the same line, so the page and the template agree.) Keep `bunx vite`.
