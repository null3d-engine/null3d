# tree-structure-21

## Finding as given

- page: getting-started
- anchor: (missing page)
- category: missing-content
- severity: medium
- claim: No page says the repository's demos and showcase apps exist or how to run them.
- evidence: examples/demos.ts lists over 60 demos, among them showcases creek, island, skyway and showroom. No docs page lists them; index.md does not mention examples.
- proposedEdit: NEW getting-started/examples 'Examples and showcases': how to run the demos, and a list by topic with links to https://github.com/null3d-engine/null3d/tree/main/examples/<code>.
- generatedSource: tools/lib/docs.ts (PAGES)

Verdict: partly

## Evidence

- The "demos exist" half is wrong. docs/cookbook/index.md:664, under "Related pages", links to https://github.com/null3d-engine/null3d/tree/main/examples as "longer demos, each with its own sketch". 31 docs pages hold 43 links into tree/main/examples/..., for example docs/guides/car-paint.md:120 links the Showroom demo.
- The "how to run" half holds. No page in docs/ says how to run the demos. Only README.md:256-276 (Development) does: Bun, the Rust toolchain, Node 24, mkcert, then `bun install`, `bun run build`, `bun run dev-cert`, `bun run dev`, with the demos at https://localhost:5174/examples/.
- No page lists the demos or the showcases. examples/demos.ts holds 72 entries, sorted into groups such as "Showcase", "Building scenes", "Light, materials and effects", and "Testing and tools". Creek, Island and Skyway appear on docs pages only as names in timing tables and figures (docs/guides/start-time.md:67-99, docs/guides/loading-screens.md:147, docs/concepts/lighting.md:162), with no link and no word on what they are.
- docs/index.md does not mention the examples. Its "Where to start" list has no link to them.
- getting-started pages (install, first-scene, project-structure) do not point to the examples.

## Corrected claim

Docs pages link to single demos, and the cookbook links to the examples folder. But no page lists the demos or the showcase scenes, says what each showcase shows, or says how to run them. A reader meets "Skyway", "Island" and "Creek" in timing tables with no explanation.

## Corrected edit

Add a hand-written page getting-started/examples, "Examples and showcases", and register it in PAGES in tools/lib/docs.ts so that pages.md lists it. Then:

- Say that running the demos needs a clone and the engine's build tools (Bun, the Rust toolchain, mkcert). Give the commands from the README's Development section, and the address https://localhost:5174/examples/. Readers who only want to read the code can follow the GitHub links instead.
- Generate the list from examples/demos.ts (name, group, description, code), the way the other generated lists are made. A hand-copied list of 72 demos would soon fall out of step. Use the file's own groups, with the Showcase group first. Link each demo as https://github.com/null3d-engine/null3d/tree/main/examples/<code>.
- Link the new page from docs/index.md "Where to start", from the end of getting-started/first-scene.md, and from the cookbook's "Related pages" entry. Where start-time.md and loading-screens.md first name a showcase, link it to its list entry.
- Optional: one reference picture for each showcase, copied to docs/images/getting-started/examples/<name>.webp from tests/image/references/chrome-real-gpu/<tier>/demo-<name>.png, with alt text.
