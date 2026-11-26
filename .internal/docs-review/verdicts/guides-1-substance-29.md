# guides-1-substance-29

Finding as given:

- page: guides/deterministic-simulation
- anchor: "clockwork2's dmath is one" (line 67)
- category: unclear
- severity: low
- claim: The page names @clockwork2/engine/dmath with no link or description, so the reader cannot tell what it is or where to get it.
- evidence: docs/guides/deterministic-simulation.md:67, 73; examples/package.json:6.
- proposedEdit: "@clockwork2/engine/dmath (on npm) is one. The [replay demo](https://github.com/null3d-engine/null3d/tree/main/examples/replay) uses it."

Verdict: survives

Evidence:

- docs/guides/deterministic-simulation.md: "clockwork2" and "dmath" appear only at lines 67, 73 (import line in the code sample) and 90. No line says what clockwork2 is, that it is an npm package, or links to it. The intro (lines 22-25) and the diagram (line 15) say "an exact library" without naming it.
- docs/api/math.md:119 uses the same import with only the comment "an exact math library". No other docs page explains clockwork2.
- examples/package.json:6 pins "@clockwork2/engine": "0.10.0" (not a workspace package), and bun.lock:305 resolves it from the registry, so it is a separate npm package. It is a game engine package (it has peer dependencies on pixi.js and three), which the bare name "clockwork2" does not tell the reader.
- examples/replay/sim.ts:7 imports acos, cos, exp, sin from '@clockwork2/engine/dmath', so the claim that the replay demo uses it is true. demos.ts gives the replay demo the code 'replay/', so the link format matches the website contract.

Notes on the proposed edit:

- The page already links the replay demo at line 138, so the second sentence repeats a link. That is acceptable here, since it ties the library to a working use, but it is optional.
- "(on npm)" with no link is weak. A link to the package page is clearer. Keep the colon, because the code sample follows.

Corrected edit:

"Pass an exact math library's functions, which give the same bits on every JavaScript engine. The `dmath` entry of the [@clockwork2/engine](https://www.npmjs.com/package/@clockwork2/engine) package is one, and the [deterministic simulation demo](https://github.com/null3d-engine/null3d/tree/main/examples/replay) uses it:"
