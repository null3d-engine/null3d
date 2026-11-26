# start-substance-19

## Finding as given

- page: getting-started/install, cli/null3d
- anchor: install line 15 "The commands on these pages use Bun 1.4.3 or newer"; cli line 23 "The command needs Node 20.19 or later"
- category: contradiction, severity: medium
- claim: The command's entry runs under Node, and Install never names Node. A Bun-only reader cannot tell whether `bunx @null3d/cli` works without Node.
- evidence: packages/cli/bin/null3d.js:1 (#!/usr/bin/env node); packages/cli/package.json:49-50 (engines node ^20.19.0 || >=22.12.0).
- proposedEdit: Say the same on both pages, such as: "`bunx @null3d/cli` runs the tool with Node, so install Node 20.19 or later, or 22.12 or later, beside Bun." Or, if Bun's own Node shim is supported, say that and test it.

Verdict: partly

## Evidence

- Facts that hold: the bin starts with `#!/usr/bin/env node` (packages/cli/bin/null3d.js:1), package.json sets engines node `^20.19.0 || >=22.12.0`, cli/null3d.md:23 says "The command needs Node 20.19 or later, or Node 22.12 or later", and install.md never names Node. The two pages do give a reader two different stories about what runtime the tool needs.
- Fact that fails: "the entry runs under Node" is not the whole story. The tool is built to run under Bun too. packages/cli/src/browser.js:526 branches on `process.versions.bun` and, under Bun, guards the browser with `watchBrowser` (browser.js:446-470) against the pipe fault of Bun before 1.4.3. install.md:15 warns about that same fault for `bunx @null3d/cli test`, which only matters when the tool runs in Bun's runtime. `bunx` follows a `node` shebang when Node is on the path, and with no Node it runs the file with Bun. The repo's fresh-project test installs with Bun and runs the tool's `test` command (.dev/releases.md:114, 120-127).
- So the proposed edit, "install Node ... beside Bun", is wrong: it adds a requirement that the code does not have. If anything is wrong, it is cli/null3d.md:23, which says the command "needs" Node without saying this applies only when it runs with Node.

## Corrected claim

The two pages disagree. cli/null3d.md:23 says the command needs Node, and install.md:15 implies Bun alone is enough. The code supports both runtimes (browser.js:526), so the CLI page overstates the Node need. Severity low to medium.

## Corrected edit

Do not tell Bun users to install Node. Replace cli/null3d.md:23 with: "`bunx` runs the command with Node when Node is installed, and with Bun when it is not. With Node, use 20.19 or later, or 22.12 or later, as Vite 8 does. With Bun, use 1.4.3 or newer ([Install](../getting-started/install.md))." Install needs no change.
