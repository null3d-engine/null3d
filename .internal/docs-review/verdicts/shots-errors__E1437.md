# Verdicts: errors/E1437 (Chrome for Testing refused)

Shots proposed: none. No shot is needed. The page is about a command-line install check, and no rendered view shows it.

Demo links proposed: none. Correct. No demo or comparison runs the browser install step.

Concepts said to have no demo:
- The Chrome for Testing hash check: confirmed. It runs in the command-line tool before any browser starts. No demo in examples/demos.ts or examples/compare/comparisons.ts touches it. The only "chrome" hits there are chrome materials in scene descriptions.
- The fallback to the installed Google Chrome: confirmed. It is a setting of the command-line tool's browser launch. No demo shows or switches it.
