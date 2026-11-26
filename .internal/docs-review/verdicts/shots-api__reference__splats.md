# Verdicts: api/reference/splats

## Shots

None proposed. Nothing to check.

## Demo links

### createSplats and streaming -> `splats/` (keep)

- The code is right. The `splats` demo in examples/demos.ts has no `code` field, so the link is `https://github.com/null3d-engine/null3d/tree/main/examples/splats/`. The folder exists and holds `sketch.ts`.
- The demo shows the concept. Its sketch calls `createSplats(ctx, { url: .../bolton-priory-stream/index.json })`, so it draws a splat stream from an index. It calls `splats.update(eye)` each frame, as the doc text asks. It waits on `splats.ready` and `splats.settle()` and reads `splats.loaded` / `splats.chunks` for the loading overlay. That is the whole streaming path that the `createSplats` text describes.
- Source to edit: this page is generated. Put the link in the TSDoc comment of `createSplats` in packages/splats/src/system.ts (the export at about line 189), not in docs/api/reference/splats.md. No other reference page has a demo link yet, so check that the generator keeps a Markdown link in a TSDoc body.

## Concepts said to have no demo

- `decodeSpz`: confirmed. No demo or comparison calls it. The `splats` demo runs it only inside the add-on (system.ts decodes each chunk), so the reader never sees the call.
- `encodeSpz`: confirmed. Only the sample tool tools/samples/splats/bolton-priory.ts calls it, to write the demo's chunk files. That is a build script, not a demo.
- `parseStreamIndex`: confirmed. The `splats` demo reads its index through `createSplats`, which calls it inside the add-on. No demo calls it directly.
- `chunkSplats`: confirmed. Only the sample tool and the add-on itself call it. No demo calls it.

A possible follow-up, not a demo link: the `encodeSpz` text already says how a stream writer uses `chunkSplats` and `encodeSpz`. A short code sample or a link to the sample tool would show it, but the tool is not a demo, so it does not fit the demo-link format.
