# D-396: The live scene inspection channel

Status: decided, and built. Development builds carry a request and response channel between the page and the sketch worker, and the scene lists every live object. The `mcp` command speaks the Model Context Protocol over the channel, and the in-page inspector is a panel of its own. A production build holds none of the channel.

Summary: The in-page inspector and the MCP server share one development-only channel. It carries each inspection call to the thread that runs the sketch, and brings back a JSON-safe answer. The scene lists its live objects through `scene.listObjects()`, so no second copy of the scene exists. The inspector is a separate panel docked at the left edge, not a tab of the stats overlay. The MCP server starts its own headless browser by default, and attaches to a developer's Chrome with `--connect`.

## Question

Two tools look inside a running scene and change it live. The scene's code and its data run in the sketch worker, while the tools and the developer's page live on the page's thread. How do reads and writes cross that boundary, how does a tool list every object, and how does a production build drop all of it?

## Rule

The repository's rules decide it:

- One copy of each piece of data ([hard rule 3](../../AGENTS.md#hard-rules)). The scene's objects, transforms and materials already live in the engine core, and the page holds no mirror of them.
- No per-frame work or allocation in TypeScript ([hard rules 1 and 7](../../AGENTS.md#hard-rules)). The channel runs only between frames, and a frame never calls it.
- Pay only for what you use ([hard rule 8](../../AGENTS.md#hard-rules)). The channel exists only in a development build, and the inspector's code loads only when the page asks for it.
- The issue's own rule: "release builds must leave it out".

## Data

No timing run settled this choice. These are the facts from the code that decide it.

| Measure | Request and response channel | Mirror of the scene in the page |
| --- | --- | --- |
| Copies of the scene's data | None: each call reads the scene's own objects in the sketch worker | One, kept in step in every frame |
| Threads per call | One message to the worker and one reply | A frame-by-frame sync on the critical path |
| Work in a frame | None: calls run between frames | A sync that hard rules 3 and 7 forbid |
| Present in a production build | No; the flag folds the channel and its module out | It would need the same flag |
| Calls the scene had | None for listing: `scene.find` reads names, and nothing listed every object | The listing would come free from the mirror |

How the data was produced: from `packages/engine/src/sketch/runner.ts`, `packages/engine/src/scene/scene.ts`, `packages/engine/src/page/switches.ts` and the dev flag in `packages/engine/src/shared/dev.ts`.

## Look

The two placements of the inspector differ in what a person sees, so the better-looking one wins ([hard rule 40](../../AGENTS.md#hard-rules)).

- **A tab of the stats overlay** keeps one floating surface, but 360 pixels must hold a tree, three-axis fields and material controls. The tree shortens to a few rows, and the overlay hides when collapsed, so inspecting and watching the view cannot share the screen.
- **A separate panel** has room for a tree that stays open, with the selected object's fields under it. It keeps the stats overlay's header free for the frame rate. It costs a strip of the left edge while it is open.

The separate panel looks better for an editing surface. The owner chose it from two mockups, one of each placement.

## Decision

- **One channel, keyed by request id.** The page sends `{ type: 'inspect', id, call, args }` to the sketch worker, or calls the runner directly when the sketch runs on the page's thread. The worker answers `{ type: 'inspect-reply', id, ok, result }` or `{ id, ok: false, error }`. The page keeps a map of waiting calls, so replies in any order reach their own caller. The channel is built on the engine side only inside `if (DEV)`, and `engine.inspect` is absent in a production build.
- **Nine calls, one shape.** `objects`, `object`, `setObject`, `setMaterial`, `stats`, `errors`, `graph`, `setQuality`, `highlight` and `info`. An object is named by its name, `#<slot>`, or `#camera`. A change uses the scene's own setters, so it queues its command like a sketch's call and takes effect on the next frame. `stats` reuses the frame figures that `debug.frameStats` computes. `graph` reuses `render.dumpGraph`.
- **The scene lists its objects.** `scene.listObjects()` walks the slot index and returns each live object. The channel makes each a JSON-safe summary, with its slot, handle, name, kind, static or dynamic flag, layers, parent and child count.
- **Material values are recorded for reads, without a per-frame cost.** A material records the values that the inspector shows into preallocated arrays, as it is created and when `set` runs. The allocation benchmark calls `set` every frame, so the arrays are needed. `values()` builds the inspector's record only when the inspector asks.
- **The inspector is a panel of its own.** A development build publishes `window.__null3dInspector = { inspect, engine }`, and opens the panel when the page has `?inspect`. The panel lists the tree, outlines the selected object with the debug drawing, and edits transform, flags and material values. It polls the frame figures once a second. Its module loads on first use, as a chunk of its own.
- **The MCP server offers both ways in.** `bunx @null3d/cli mcp` speaks the Model Context Protocol over stdio. By default it starts the project's own Vite dev server and a headless Chrome, which suits a cloud agent. `--url` uses a dev server that already runs, but still starts its own browser. `--connect <endpoint>` attaches to a Chrome that the developer runs with a remote debugging port. It then drives the tab that already shows the page, so the agent sees exactly what the developer sees.

Options rejected:

- **Keep a mirror of the scene in the page and let the tools read it.** The mirror is a second copy of data that changes every frame. Keeping it in step is the work that hard rules 3 and 7 remove.
- **Let the tools read the scene from the render worker.** The render worker owns the GPU objects and draws in its own callback (hard rules 2 and 3). The scene's objects and materials belong to the sketch worker.
- **Ship the channel in production builds, hidden behind a flag.** The issue requires it out, and it would carry code and an entry point that a player's page never needs.
- **Poll the scene from the page with `page.evaluate` alone.** The page has no scene data, so it would still need a message to the worker for each read.

## Consequences

- `packages/engine/src/debug/channel.ts` holds the calls, and `packages/engine/src/debug/inspector.ts` holds the panel.
- `Engine.inspect` joins the page API as a development-only method; `Page API: createEngine` documents it.
- The `?inspect` switch joins the development switches, and `docs/guides/debugging.md` describes the panel and the channel.
- `packages/cli/src/mcp.js` holds the server, `@modelcontextprotocol/sdk` and `zod` join the command's dependencies, and `docs/cli/null3d.md` documents the command.
- The develop skill's testing reference and the agents guide show the tools.
