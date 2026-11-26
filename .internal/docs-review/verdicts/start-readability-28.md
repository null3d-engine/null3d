# start-readability-28

## The finding as given

- Page: cli/null3d, getting-started/project-structure
- Anchor: cli/null3d ## create (lines 25 to 39); project-structure ## Make a project (lines 33 to 48)
- Category: duplication. Severity: low.
- Claim: Both pages give the same one-row --template option table, the empty-folder rule and that create installs nothing. A one-row table is heavier than a sentence.
- Evidence: cli/null3d.md lines 35 to 39; project-structure.md lines 42 to 48.
- Proposed edit: Keep the full rules in cli/null3d. In project-structure keep the four commands and one sentence with a link to cli/null3d#create. Replace both one-row tables with a sentence: '--template <name> picks empty (the default), product or game.'

Verdict: partly

## Evidence

- The duplication is real. cli/null3d.md:35-39 and project-structure.md:42-48 both hold a one-row `--template` table with `empty` as the default, the rule that the folder must not exist or must be empty, and the fact that `create` installs nothing.
- project-structure has no link to cli/null3d at all (a search for "cli/null3d" and "null3d.md" finds none). cli/null3d.md:39 already links back to project-structure. So the getting-started page gives the reader no path to the full rules, such as the rule that `create` never overwrites `.claude/settings.json` or `.codex/hooks.json`.
- On project-structure the option table adds nothing. The templates table at lines 25 to 29 already names all three templates, and the code block at line 36 shows `--template game`.
- The edit to cli/null3d is wrong. Every command section of cli/null3d uses the same `| Option | Effect | Without it |` table (lines 35, 58, 212, 270, 353, 434, 452, 480, 494, 506, 519, 533, 562). Some of them have only two or three rows. A reader scanning a command reference expects this same shape for each command. A one-row table there costs nothing and keeps the reference consistent. Swapping it for a sentence would make `create` the only command that does not follow the pattern.
- No check in tools/ or packages/cli tests reads these tables, so either edit is safe for the build. The objection is about consistency only.
- project-structure.md:48 adds one fact that is not on cli/null3d: "A folder with files stays as it is, and the command stops." The command's code confirms this: packages/cli/src/create.js:151 throws "is not empty, and create needs an empty folder". If that line is cut from project-structure, the fact should move to cli/null3d so it is not lost.

## Corrected claim

project-structure repeats the `--template` option table, the empty-folder rule and the fact that `create` installs nothing, which cli/null3d already gives in full. It also has no link to cli/null3d. The one-row table on cli/null3d is consistent with every other command on that page and is not a problem.

## Corrected edit

- cli/null3d ## create: keep the option table. Add the sentence that a folder with files stays as it is and the command stops, after "The folder must not exist, or it must be empty."
- project-structure ## Make a project: keep the four commands. Replace lines 42 to 48 with: "`create` installs nothing, so run `bun install` in the new folder. The folder must be new or empty. [The `null3d` command](../cli/null3d.md#create) gives every option and rule of `create`."
