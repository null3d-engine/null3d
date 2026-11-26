# guides-1-readability-12

## Finding as given

- page: guides/debugging, guides/agents
- anchor: debugging ## The MCP server (line 176); agents ## The MCP server (line 63)
- category: duplication
- severity: medium
- claim: Both pages explain the headless default and --connect, the development-build need, the same claude mcp add command, the tools and 'Live changes are for exploring'. The texts can drift. Agents line 67 is also a long paragraph (78 words, 5 sentences).
- evidence: agents line 65 and debugging line 178 both say a production build leaves the inspection channel out; 'claude mcp add null3d -- bunx @null3d/cli mcp' at agents line 72 and debugging line 211.
- proposedEdit: Keep the full description on debugging. On agents keep one paragraph (what the server is for), the claude mcp add line, and a link to debugging.md#the-mcp-server.

Verdict: survives

## Evidence

- docs/guides/agents.md:65 and docs/guides/debugging.md:178 both end with the same reason: "a production build leaves the inspection channel out".
- docs/guides/agents.md:67 repeats the headless default ("as `shot` does. This works on a cloud agent with no window") almost word for word from debugging.md:182, and repeats the `--connect` text ("so the agent sees exactly what the developer sees") from debugging.md:183.
- The `claude mcp add null3d -- bunx @null3d/cli mcp` block is at agents.md:72 and debugging.md:211.
- agents.md:75 sums up the tool list in prose; debugging.md:194-205 gives the same list as a table. agents.md:75 and debugging.md:214 both state "Live changes are for exploring" and the `bunx @null3d/cli test` check.
- stats.json lists the agents paragraph that starts "By default the server starts..." as long: 78 words, 5 sentences. The finding's line 67 is the same paragraph in the file (stats counts lines after the front matter).
- AGENTS.md "Docs and skills stay in sync", rule 1: "One source per fact." Two copies of the same options text break that rule and can drift.
- agents.md:67 already links to debugging.md#the-mcp-server for the options and the tools. That only half-handles the issue, because the same paragraph also restates them.
- The proposed edit breaks no rule. The agents page summary still says it covers "the MCP server", so a short section with a link keeps the page true to its summary.

## Note on the edit

The edit is right. One small refinement: in the paragraph that agents.md keeps, say in one clause that the server works with no window (on a cloud agent) and can also attach to the developer's own Chrome. That choice matters most to an agent reader. Leave the flag names and the steps to the debugging page. The test-loop rule ("Live changes are for exploring") may stay on agents as one sentence, because it belongs to that page's test loop, or move to debugging only. Do not keep it on both.
