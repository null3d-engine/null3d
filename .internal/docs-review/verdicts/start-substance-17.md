# start-substance-17

Finding as given:

- page: cli/null3d
- anchor: ## create, line 39 "The command never overwrites an existing `.claude/settings.json` or `.codex/hooks.json`"
- category: contradiction
- severity: medium
- claim: The sentence suggests that create can write into a folder that holds those files. The code refuses any folder that is not empty, and names the two files only to give a clearer message.
- evidence: packages/cli/src/create.js:140-151 (a special message for the two files, then "is not empty, and create needs an empty folder").
- proposedEdit: "The folder must not exist, or it must be empty. A folder that holds `.claude/settings.json` or `.codex/hooks.json` gets its own message, because those files can hold your own hooks."

Verdict: partly

Evidence:

- docs/cli/null3d.md:39 says first "The folder must not exist, or it must be empty." and then "The command never overwrites an existing `.claude/settings.json` or `.codex/hooks.json`, because those files can hold your own hooks."
- packages/cli/src/create.js createProject: if the target exists, it checks for either file first and throws "already has <file>, which can hold your own hooks. create left it as it is: use an empty folder, or move that file first". Then it throws on any non-empty folder (readdirSync counts dotfolders such as .claude, so a folder holding only those files is non-empty anyway). Nothing is ever written into a non-empty folder.
- So the code claim is right. But the page sentence is not false: create never overwrites those files. And the sentence just before it already states the empty-folder rule. The cost is a small redundancy that hints at a case that cannot happen (writing into a folder that has these files). That is polish, not a contradiction that misleads a reader.

Corrected claim: The second sentence is true but redundant after "must be empty". It implies a merge case the command never runs. The code refuses any non-empty folder and only gives the two hook files a clearer error. Severity low, not medium; category clarity, not contradiction.

Corrected edit (keeps the proposed wording, with the error behaviour stated): "The folder must not exist, or it must be empty. If the folder holds `.claude/settings.json` or `.codex/hooks.json`, the command stops with a message that names the file, because those files can hold your own hooks."
