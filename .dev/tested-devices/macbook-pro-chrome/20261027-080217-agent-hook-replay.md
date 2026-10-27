Plans: the template's agent hook protocol, 2026-10-27, at `8c466dbcd` on branch
`fix/m3-r16-refused`. A project was made from that tree's own `create` command, and its hook and
template files are those of this commit. A replay script read the four hook commands from the
project's `.claude/settings.json` and `.codex/hooks.json`. It piped each call to the configured
command as JSON on stdin, with `sh -c`. No live Claude Code or Codex session was involved. The
project's `@null3d/cli` is a link to the fixed checkout, so the run reads the fixed rules module. Its
`@null3d/engine` is the installed 0.0.0 package, which the engine declarations come from.

Result: every Bash call below gives the same result through Claude's command and through Codex's. The
three waiting, kill-by-name and log-following calls exit 2 with the named reason. The build and the
targeted kill exit 0 with no output. The poll `until curl -s localhost:5173; do sleep 1; done` now
exits 2. The same call exited 0 before the loop fix. The edit commands flag the allocation, the DOM
name in the sketch and the unexported engine import. They allow the same DOM use in the page and the
template's own page. A Codex `apply_patch` gets the same result for the DOM name and the allocation.

| Call | Exit | Result |
| --- | --- | --- |
| `sleep 5` | 2 | refused, with the sleep reason |
| `pkill vite` | 2 | refused, with the kill reason |
| `tail -f dev.log` | 2 | refused, with the log reason |
| `bun run build` | 0 | allowed, with no output |
| `kill 12345` | 0 | allowed, with no output |
| `until curl -s localhost:5173; do sleep 1; done` | 2 | refused, with the sleep reason |
| an `Edit` that adds `new Float32Array` in `onUpdate` | 0 | flagged, naming the allocation rule |
| a `Write` of `document` to `src/sketch.ts` | 0 | flagged, naming the DOM rule |
| the same `Write` to `src/page.ts` | 0 | allowed, with no output |
| a `Write` of an import that the installed engine lacks | 0 | flagged, naming the planned-API rule |
| a `Write` of the template's own page | 0 | allowed, with no output |
| a Codex `apply_patch` that adds `document` to a sketch file | 0 | flagged, naming the DOM rule |
| the same Codex patch to a page file | 0 | allowed, with no output |
| a Codex `apply_patch` that adds an allocation in `onUpdate` | 0 | flagged, naming the allocation rule |

The six Bash rows ran through both agents' configured commands, and the table gives each result. The
edit rows ran through the agent named in the row. The replay log holds the same lines, with the
message for each refused call.
