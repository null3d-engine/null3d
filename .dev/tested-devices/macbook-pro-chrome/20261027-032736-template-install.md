Plans: the starter template's install and agent hook, 2026-10-27. The run is on branch
`feat/m3-r16-agent-hook` at `00873efdc`. The checkout's own `create` command made a project from the
`empty` template. The project was installed, built and drawn in the Mac's Chrome 156.0.8078.48 on
its real GPU. At `0c823fa74`, the hook, rules, settings, sources and create code matched this run's
code.

Result: the created project holds the template's eleven files, installs from local tarballs, and
builds. It draws its cube on WebGPU and WebGL2, and each hook call below gives the result it names.

The project was made in a scratch folder under `/private/tmp`, which is not kept. The checkout's own
`create` command, from `packages/cli/bin/null3d.js`, made it from the `empty` template. The
checkout's version is 0.0.0 and not on npm, so the three packages were packed to local tarballs and
`package.json` was edited to point at them.

| Step | Command | Result |
| --- | --- | --- |
| Make | the checkout's `create` command | eleven files. `AGENTS.md`, `index.html`, `package.json`, `tsconfig.json`, `vite.config.ts`, `gitignore`, `src/page.ts`, `src/sketch.ts`, `.agent/agent-hook.mjs`, `.claude/settings.json` and `.codex/hooks.json` |
| Install | `bun install` | the three 0.0.0 tarballs in `node_modules/@null3d/`. They are `null3d-engine`, `null3d-cli` and `null3d-vite-plugin`, with `bun.lock` |
| Build | `bun run build`, which runs `vite build` | 7.7 s, then 7.3 s clean |

Both timed builds set `NULL3D_ENGINE_SHADERS` to the checkout's generated shader folder. A third
build without that variable compiles the engine's shader set in-process on one core, because a
locally packed engine carries no release shader record. It was stopped at eleven minutes with no
output. A published install takes no such path. The clock and the machine's load were not recorded.
No log of the builds remains, so the two build figures are as the run's account gave them.

`bunx @null3d/cli shot --gpu webgpu` and `bunx @null3d/cli shot --gpu webgl2` drew the project's page
at 1280 by 720 pixels and 1.5 s. Both runs report `ok: true`, frame 91, `errors: []` and
`warnings: []`, and both pictures show the template's blue cube.

The hook ran the way each agent runs it: the configured command from that agent's settings file,
through `sh -c`, with the call as JSON on stdin. Claude's calls set `CLAUDE_PROJECT_DIR` to the
project. Codex's calls ran from `src` without that variable, so the command's folder walk-up was
used.

| Call | Exit | Result |
| --- | --- | --- |
| `sleep 5` | 2 | refused, with the sleep message |
| `pkill vite` | 2 | refused, with the kill message |
| `tail -f dev.log` | 2 | refused, with the log message |
| `bun run build` | 0 | allowed, with no output |
| `cat .vite.pid \| xargs kill` | 0 | allowed, with no output |
| an edit that adds `new Float32Array` in `onUpdate` | 0 | flagged, naming the allocation rule |
| a write of `document` to `src/sketch.ts` | 0 | flagged, naming the DOM rule |
| the same write to `src/page.ts` | 0 | allowed, with no output |

A Codex `apply_patch` that adds the DOM name to a sketch file is flagged, and the same patch to a
page file is allowed.

A replay at `0c823fa74` repeated the three refused calls, the build, a targeted `kill 12345` and the
edit calls through each agent's configured commands, with the same results. It also found a wait
inside a compound command that the rules allowed, `until curl -s localhost:5173; do sleep 1; done`.
The rules module now reads the commands inside a loop, a condition, a subshell, a `{ }` group, `eval`
and a command substitution, and `agent-rules.test.ts` covers each form.
