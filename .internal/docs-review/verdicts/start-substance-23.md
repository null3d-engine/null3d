# start-substance-23

## The finding as given

- page: cli/null3d, getting-started/project-structure
- anchor: cli ## create (lines 25-39); project-structure ## Make a project (lines 33-48)
- category: duplication
- severity: low
- claim: Both pages give the --template table, the empty-folder rule and the "installs nothing" note. If one changes, the other can go stale.
- evidence: cli/null3d.md:35-39 vs project-structure.md:42-48.
- proposedEdit: Keep the option table and the folder rule on the command page. On Project structure, keep the template table and the four commands, and link "[create](../cli/null3d.md#create) gives its options".

Verdict: partly

## Evidence

- cli/null3d.md:35-37 has a one-row option table for `--template` (empty, product, game; default `empty`). Line 39 has the folder rule, the "installs nothing" note and "run `bun install`".
- project-structure.md:44-46 has the same one-row option table. Line 42 has the "installs nothing" note. Line 48 has the folder rule. So the duplication is real.
- The project-structure option table also repeats its own page: the template table at lines 25-29 already names the three templates. So dropping it there costs the reader nothing.
- The facts are correct in the code: packages/cli/src/create.test.ts:282-292 refuses a folder with files ("is not empty, and create needs an empty folder"); create.test.ts:339-340 lists the templates empty, game, product.

## What does not hold

- The two folder rules are not the same text. project-structure.md:48 adds a fact the command page lacks: "A folder with files stays as it is, and the command stops." The proposed edit keeps only the command page's version, so this fact would be lost. It must move to cli/null3d.md:39.
- The "installs nothing" note on project-structure.md:42 explains why `bun install` is one of the four commands. A short clause should stay there, or the step looks unexplained. It is one clause, so the risk of drift is small.

## Corrected claim

Both pages repeat the one-row `--template` option table and the empty-folder rule. On Project structure the option table also repeats the page's own template table. The Project structure copy of the folder rule holds one extra fact (a folder with files is left as it is and the command stops) that the command page does not have.

## Corrected edit

- cli/null3d.md:39: add "A folder with files stays as it is, and the command stops." after "The folder must not exist, or it must be empty."
- project-structure.md: delete the option table (lines 44-46) and the folder rule (line 48). Keep the template table and the four commands. Change line 42 to: "`create` writes the template's files and pins every package to its own version. It installs nothing, so run `bun install` in the new folder. [create](../cli/null3d.md#create) gives its options and the folder rule."
