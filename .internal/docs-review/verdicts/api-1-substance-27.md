# api-1-substance-27

## Finding as given

- page: api/debug
- anchor: ## The in-page inspector, line 446
- category: unclear
- severity: low
- claim: The page says ?inspect opens a panel over the canvas, but the inspector docks at the left edge of the page. 'the MCP server' is named with no explanation or link.
- evidence: docs/api/debug.md:446; packages/engine/src/debug/inspector.ts:1; docs/guides/debugging.md:176.
- proposedEdit: '?inspect docks a panel at the left edge of the page ...', and link 'the MCP server' to ../guides/debugging.md#the-mcp-server with a short gloss, such as 'which lets an AI agent read the scene'.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- The first half is wrong. The panel's style is `position: fixed; left: 0; top: 0; bottom: 0` with the highest z-index (packages/engine/src/debug/inspector.ts:74-76). The panel is added to the document body (inspector.ts:231) and does not move or resize the canvas. So it does lie over the canvas, and "over the canvas" is true. The guide says the same: "opens a panel at the left edge of the page, over the canvas" (docs/guides/debugging.md:146). The page does not say where on the canvas the panel sits. Adding that is polish, not a fix for a wrong statement.
- The second half holds. docs/api/debug.md:446 is the only place on the page that names "the MCP server". It gives no gloss and no link. The guide has a section for it (docs/guides/debugging.md:176, "## The MCP server", anchor `#the-mcp-server`). That section says the server lets a coding agent list and change the scene's objects, capture a frame and read the frame figures. The page links to the guide's inspector section, but not to the MCP section.
- Severity low is right.

## Corrected claim

The page's "over the canvas" is accurate, because the panel is a fixed overlay on top of the page. It could also say that the panel sits at the left edge. The real gap is that "the MCP server" has no explanation and no link.

## Corrected edit

"`?inspect` opens a panel at the left edge of the page, over the canvas, that lists ..." (keep "over the canvas"). Then: "... and `window.__null3dInspector` holds them for [the MCP server](../guides/debugging.md#the-mcp-server), which lets a coding agent read and change the scene."
