# start-substance-02

## Finding as given

- Page: index
- Anchor: ## Where to start (lines 36-43)
- Category: missing-content
- Severity: high
- Claim: The docs home's start list has no link to Install null3D, Your first scene, Project structure or the CDN trial. A newcomer reaches them only through All pages.
- Evidence: index.md:38-43 lists architecture, backends, performance, phones, hosting and porting only; the getting-started pages appear only in pages.md:16-22.
- Proposed edit: Open "Where to start" with: "[Install null3D](getting-started/install.md): the packages and the Vite plugin." "[Your first scene](getting-started/first-scene.md): a turning box in four files." "[Project structure](getting-started/project-structure.md): start from a template with `bunx @null3d/cli create`." Then add the CDN trial and [For AI agents](guides/agents.md).

Verdict: survives

## Evidence

- docs/index.md:36-43: the "Where to start" list has six items: architecture, backends, performance guide, phones, hosting, three.js mapping. The only getting-started page in it is hosting (line 42).
- grep of docs/index.md for "install" and "first-scene" finds nothing. Lines 11-18 (the intro) link to performance, backends and quality presets only. The only route to Install, Your first scene, Project structure and the CDN page is the All pages link (lines 34 and 49).
- docs/pages.md:16-22: the Getting started table lists Install, Your first scene, Hosting, Network use, Third-party notices, Try null3D from a CDN and Project structure.
- The proposed one-line descriptions match the pages: first-scene.md:20-22 says the page builds a turning box and uses four files; project-structure.md:23 and 36 use `bunx @null3d/cli create`; install.md's summary names the packages and the Vite plugin.
- All target files exist: getting-started/install.md, first-scene.md, project-structure.md, cdn.md, guides/agents.md.

## Notes and corrections to the edit

- Severity: the page links All pages twice, and that list opens with the Getting started table, so a newcomer is not fully blocked. Medium is a fairer level than high. The gap is still real: the docs home names six places to start and none is how to install the engine or make a first scene.
- Link labels: the agents page title is "Working with AI agents", not "For AI agents". Use the real titles:
  - [Try null3D from a CDN](getting-started/cdn.md): one HTML file with no bundler.
  - [Working with AI agents](guides/agents.md): install the null3D skills in your agent tool.
- Keep the list short. Put the three new start items (Install, Your first scene, Project structure) first, then the CDN page, then the existing items. Hosting can stay where it is.
