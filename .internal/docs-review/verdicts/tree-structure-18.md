# tree-structure-18

## Finding as given

```json
{
 "page": "guides/agents,guides/debugging,cli/null3d,api/debug",
 "anchor": "## The MCP server / ## The in-page inspector",
 "category": "duplication",
 "severity": "medium",
 "claim": "The MCP server is explained on three pages and the in-page inspector on two, each with the same detail.",
 "evidence": "'## The MCP server' in guides/agents and guides/debugging, '## mcp' in cli/null3d; each lists the default dev server plus headless Chrome and --connect. '## The in-page inspector' in api/debug and guides/debugging.",
 "proposedEdit": "One home each: cli/mcp for the server, guides/debugging for the inspector; api/debug keeps only engine.inspect. The other pages keep one sentence and a link.",
 "generatedSource": "",
 "id": "tree-structure-18",
 "slice": "tree",
 "role": "structure"
}
```

Verdict: partly

## Evidence

MCP server part holds:
- guides/debugging.md "## The MCP server" (line 176) has a full option list (--connect, --url, --page, --size, --gpu, --timeout), a 10-row tool table, the `claude mcp add` command and the "live changes are for exploring" note.
- cli/null3d.md "## mcp" (line 189) has the same options as a table, the same 10 tools as a table (with more detail), both `claude mcp add` forms, the --connect setup steps and the same closing note.
- guides/agents.md "## The MCP server" (line 63) repeats the default dev server plus headless Chrome, --connect, the development-build need, the register command and the tool list in prose.
- So the option list and the tool table exist twice in full, and the start-up modes three times. AGENTS.md "Docs and skills stay in sync" rule 1 is "One source per fact", so this is a real cost: two tables to keep in step.

Inspector part does not hold:
- api/debug.md "## The in-page inspector" (line 444) is already one short paragraph and a link to guides/debugging#the-in-page-inspector. It does not carry the call table or the panel detail. It already does what the proposed edit asks.
- guides/agents.md mentions the inspector in one sentence with a link. Only guides/debugging.md has the full detail (line 144).

Proposed edit has a wrong target:
- There is no cli/mcp page. docs/cli/ holds only null3d.md. The MCP reference lives at cli/null3d.md#mcp.

## Corrected claim

The MCP server is explained in full on two pages (guides/debugging and cli/null3d), each with its own option list and tool table, and its start-up modes are repeated a third time on guides/agents. The in-page inspector is not duplicated: api/debug and guides/agents already give a short summary and link to guides/debugging.

## Corrected edit

Make cli/null3d.md#mcp the one home for the MCP server's options and tools. In guides/debugging "## The MCP server", keep two or three sentences (what the server does, that it needs a development build, the default headless mode versus --connect for your own Chrome) and link to cli/null3d.md#mcp; remove its option list and tool table. In guides/agents "## The MCP server", keep the one-line purpose, the `claude mcp add` command (that page is the agent set-up guide) and the "live changes are for exploring" note; cut the second paragraph to one sentence and a link. Leave api/debug "## The in-page inspector" as it is.
