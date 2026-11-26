# Verdict for start-readability-25

## The finding as given

- page: getting-started/project-structure
- anchor: ## The agent files, lines 74 to 78
- category: long-paragraph
- severity: low
- claim: Lines 74 and 76 each list three hook rules inside a sentence; line 76 (55 words, 5 sentences) and line 78 (61 words, 5 sentences) are long. A reader asking 'will the hook block this?' must parse prose.
- evidence: stats.json lines 69 and 71 (file 76 and 78).
- proposedEdit: Make a table Rule | What the hook does, with the three refused commands and three flagged source rules. Keep 'Each message gives the file, the line and the fix.' Move line 78 into <summary>Technical details: where the hook's rules come from</summary>.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- The page is hand-written. Its file lines 76 and 78 match the two long paragraphs in stats.json, which counts from the end of the front matter (lines 69 and 71). Those counts are facts.
- Line 74 lists the three refused commands and line 76 lists the three flagged source rules. A table that puts all six side by side, with a column that says "refused" or "flagged, the edit goes on", answers "will the hook block this?" faster than two paragraphs. That part of the finding holds.
- The proposed shared line is wrong. The page has no sentence "Each message gives the file, the line and the fix." It says "The message gives the fix" for the refused commands (line 74) and "The message names the file, the line and the fix" for the flagged rules (line 76). The source agrees. In packages/cli/src/agent-rules.js, the refused commands return fixed messages with no file or line (lines 702 to 715). Only the source rules build "file:line" into the message (lines 904 to 907, 935 to 938, 961 to 964). One shared line under the table would tell readers that a refused command names a file and a line. It does not.
- Moving all of line 78 into a collapsed block hides behaviour that a newcomer meets first. A new project has no installed packages until `bun install` runs. Then the hook cannot check a call, tells the agent to install, and lets the call go on. The template hook holds that exact message (packages/cli/templates/empty/.agent/agent-hook.mjs lines 13 to 25). With the block closed, the main text would not say why the hook checks nothing in a fresh project. The block rule says the main text must make sense with every block closed.
- Only the first two sentences of line 78 are implementer detail: the rules come from `@null3d/cli/agent-rules`, and that module holds each rule and its message once, so every null3D tool agrees. Those suit a block.

## Corrected claim

Line 76 (55 words, 5 sentences) and line 78 (61 words, 5 sentences) are long. Lines 74 and 76 list six hook rules in prose, and a table would make "refused or only flagged?" clear at a glance. But the two kinds of message differ: a refused command's message gives only the fix, and a flagged rule's message gives the file, the line and the fix. Line 78 mixes implementer detail (where the rules live) with behaviour every newcomer meets (no checks before `bun install`).

## Corrected edit

Replace lines 74 and 76 with one lead sentence and a table:

The hook refuses some commands so that they do not run. It flags some source rules and lets the edit go on.

| Rule | What the hook does | What the message gives |
| --- | --- | --- |
| A command that waits with `sleep` | Refuses the command | The fix |
| A command that stops a process by name | Refuses the command | The fix |
| A command that follows a log | Refuses the command | The fix |
| An object, array or string made in `onUpdate` | Flags it; the edit goes on | The file, the line and the fix |
| A DOM name in the sketch module | Flags it; the edit goes on | The file, the line and the fix |
| An import of a name that the installed engine does not export | Flags it; the edit goes on | The file, the line and the fix |

Keep the install behaviour in the main text, as a short paragraph:

The hook reads its rules from the installed packages, which `bun install` writes. Before that install, the hook cannot check a call. It tells the agent to install the packages, and the call goes on.

Then add the block:

<details>
<summary>Technical details: where the hook's rules come from</summary>

The hook takes every rule from `@null3d/cli/agent-rules`. That module holds each rule and its message once, so a project and any other null3D tool agree.

</details>
