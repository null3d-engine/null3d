# guides-1-readability-15

## Finding as given

```json
{
 "page": "guides/add-ons",
 "anchor": "intro (line 13), ## Name a page (line 119)",
 "category": "term-before-definition",
 "severity": "medium",
 "claim": "The intro says check-addon 'runs these rules' but the page never lists them. '## Name a page' speaks of 'the browser gates' before '## Run the check' shows any gate. A reader cannot tell which sections are enforced gates and which are advice.",
 "evidence": "line 121 'The browser gates open a page of the add-on's project.'; the gate names only appear in the sample output at lines 139-146.",
 "proposedEdit": "After the intro add a table 'What the check runs': gate (package, public API, interface, shaders, sizes, page, cost per preset, allocation per preset), what it checks, section link. Mark advice-only sections. Move '## Name a page' under '## Run the check' as an H3.",
 "generatedSource": "",
 "id": "guides-1-readability-15",
 "slice": "guides-1",
 "role": "readability"
}
```

Verdict: partly

## Evidence

- Holds: line 13 says the check "runs these rules", but the intro lists no rules and does not link to a list of gates.
- Holds: line 121 uses "the browser gates" with no definition. The page never says which gates open a browser. Gate names first appear in the sample output at lines 139-146. Lines 149-153 then speak of "the page and allocation gates" and "the cost gate".
- Holds: the Rust section (lines 43-49) and the levels-of-detail section (lines 51-73) are advice. No gate checks them, and the page does not say so.
- Overstated: "a reader cannot tell" is too strong. Three sections say what the check does: line 41 ("The check refuses any other engine entry point"), line 111 ("A shader file that fails to compile stops the build") and line 115 ("The check warns about each file ... does not fail the check").
- Overstated: the gate list exists one link away. docs/cli/null3d.md lines 421-430 hold a "Gate | What it checks" table with all eight gates. Line 432 there says that the page gates take the page from null3d.json. The add-ons page links to it only under Related pages (line 157), not in the intro or near line 121.
- Problem with the proposed edit: a second full table of gates would copy the table in docs/cli/null3d.md#check-addon. The two would drift. The names already differ: the sample output says "cost per preset" and "allocation per preset", and the CLI table says "cost" and "allocation".

## Corrected claim

The intro says the check runs "these rules", but it does not say which sections a gate enforces, and it does not link to the gate table in the command reference. "## Name a page" uses "the browser gates" before the page names them. Three sections say how the check treats them. The Rust and levels-of-detail sections are advice, and the page does not say so.

## Corrected edit

1. Change the last sentence of the intro to link to the existing table, and do not copy it: "`bunx @null3d/cli check-addon` runs gates on a folder before a listing publishes it. [The `null3d` command](../cli/null3d.md#check-addon) lists them. The sections on names, entry points, shaders, file sizes and the preset cost each have a gate. The sections on Rust and levels of detail are advice that no gate checks."
2. Define the term where it is first used, at line 121: "The page, cost and allocation gates open a page of the add-on's project in a browser."
3. Optional: move "## Name a page" below the command block of "## Run the check", as "### Name a page". The sample output then shows the gates before the text speaks of them.
