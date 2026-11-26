# guides-1-substance-23

Finding as given:

- page: guides/agents, guides/debugging, cli/null3d
- anchor: ## The MCP server (agents 63-77, debugging 176-214), ## mcp (cli/null3d 189)
- category: duplication
- severity: low
- claim: Three pages repeat the default mode, --connect, the registration command and the tool summary in different words, so a server change must be made three times.
- evidence: docs/guides/agents.md:65-75; docs/guides/debugging.md:178-214; docs/cli/null3d.md:189-196.
- proposedEdit: Keep options and the full tool table on the cli page. Debugging keeps the three ways to reach the scene and links for options. Agents keeps two sentences and the claude mcp add command, with a link to debugging.

Verdict: survives

Evidence:

- docs/guides/agents.md:63-75 states the stdio server, the development-build need, the default mode (own Vite dev server plus headless Chrome, works on a cloud agent), `--connect`, the `claude mcp add` command, a prose tool summary and the "live changes are for exploring" rule. It already links to debugging and to the cli page.
- docs/guides/debugging.md:176-214 repeats all of that, and adds the `--connect` setup steps (`--remote-debugging-port=9222`, the full command, "every development build publishes the bridge", "`?inspect` only opens the panel"), a full options list (`--page`, `--size`, `--gpu`, `--timeout`, `--url`), a full ten-row tool table, the same `claude mcp add` block and the same "live changes" rule.
- docs/cli/null3d.md:189-240 repeats the same facts again: default mode, `--connect`, the same setup steps word for word in meaning, the `claude mcp add` command, an options table, a ten-row tool table with the same tool names and the same "live changes" rule.
- So the two option lists and the two ten-row tool tables on debugging and cli are near copies, and the `--connect` setup text appears twice. AGENTS.md "Docs and skills stay in sync" rule 1 is "One source per fact", which supports the finding.
- I found no contradiction yet. The copies differ only in depth (for example, cli says `--connect` ignores `--gpu` and `--size`, and `set_gpu` reloads your own tab too). That is the start of the drift the finding warns about: the debugging copy already leaves these facts out.
- The proposed edit breaks no writing rule. The cli page is the right home for the options table and the full tool table, because it is the command reference and already holds the most detail. Debugging keeps a short "three ways to reach the scene" list, which stays readable without the options. Agents already links to both pages.

Note on the edit: on the agents page, keep the sentence that says which mode suits a cloud agent (the default) and which suits a local session (`--connect`). That choice is what an agent user needs on that page. The edit's "two sentences" can hold it.
