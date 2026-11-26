# Shot and demo-link verdicts: guides/agents

## Shot: in-page-inspector (reject on this page)

The source is wrong. The page tests/pages/inspect.html does not leave a panel on screen:
- inspect.ts runs its calls and then stops the engine in its `finally` block. A stopped engine removes the panel (engine.ts registers `inspector.remove()` on stop), so the capture shows no panel.
- Its canvas is 320 x 180 pixels, with a status line under it. The panel would cover most of the view.
- It draws the test "boxes" sketch, not a scene a reader knows.

Placement is also weak. On this page the inspector is one closing sentence that links to Debugging. The picture belongs on guides/debugging, under "The in-page inspector", where the panel's tree, fields and frame figures are described.

Corrected source, for use on guides/debugging: scripted. Run `bun run dev` (Vite serves the repository root). Open `/examples/?demo=objects&inspect`. The gallery passes every switch except `demo` on to the sketch, and the engine reads `?inspect` from the page address. Click "crate 0" in the tree so it is outlined and its fields show. Wait one second for the frame figures. Capture the whole window.

## Demo link: objects/ (reject)

The `objects` demo exists in demos.ts and its sketch names its objects ("table", "crate 0" and up). But it shows parents and `setParent` with `keepWorld`, not the MCP server or the inspector. The link goes to the source on GitHub, where `?inspect` cannot run. Under "The MCP server" it would suggest that the demo shows the agent tools.

## Concepts without a demo

- Installing skills: confirmed. No demo.
- Docs by ID: confirmed. No demo.
- The test loop: confirmed. The "Repeatable frames" demo (`hold-mode/`) shows only the held frame that image tests depend on, not the test, compare and update loop.
- The MCP server: confirmed. No demo or comparison uses the inspection channel.
