# Verdict: guides-1-readability-11

## Finding as given

- page: guides/debugging
- anchor: ## Common failures (line 216)
- category: scan-order
- severity: medium
- claim: A newcomer with a black canvas opens Debugging for the cause. The table that answers it is the last H2, after the inspector call table and the MCP tools table, and the intro does not point to it.
- evidence: stats.json headings: '## Common failures' is H2 11 of 12; line 22 does not mention it.
- proposedEdit: Move '## Common failures' to right after the intro, or add to line 22: 'When nothing draws or a thing looks wrong, start with [Common failures](#common-failures).'

Verdict: survives

## Evidence

- docs/guides/debugging.md:216 holds "## Common failures". It is the 11th of 12 H2 headings (stats.json outline). It comes after "The in-page inspector" (line 144) and "The MCP server" (line 176).
- docs/guides/debugging.md:22, the only intro text, says "The engine reports a problem in one of four places, as the diagram shows." It does not mention or link to the common failures.
- A grep of the page finds "common failures" only in the front matter summary (line 6) and the heading (line 216). Nothing in the body links to it.
- A grep of docs/ finds no link to debugging.md#common-failures from any other page. Other pages link to #the-mcp-server, #the-in-page-inspector and #development-checks only.
- The early sections do not cover these cases. "Where problems appear" (line 36) lists only failures that raise an error. The rows at line 216 (no active camera, object outside near/far, no light, NaN in a shader) mostly raise no error. So a reader with a black canvas and an empty console finds no answer and no pointer until the end of the page.

## Corrected edit

Prefer the second option: add one sentence after line 22. Moving the section would put a silent-failure table before the error sections that the diagram introduces.

Suggested text: "Some problems raise no error, such as a canvas that shows only the background. [Common failures](#common-failures) lists them with their fixes."
