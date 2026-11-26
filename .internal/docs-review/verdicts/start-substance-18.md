# start-substance-18

## Finding as given

- page: cli/null3d
- anchor: ## check-addon, lines 412 and 425 "a listing runs it before it publishes the add-on"; "the plugin interface range"
- category: term-before-definition
- severity: medium
- claim: "A listing" is never explained. "The engine's gates" comes before the gate table. "The plugin interface range" is explained only on the add-ons guide, and this page does not link it there.
- evidence: cli/null3d.md:412, :425; docs/guides/add-ons.md:6 and :29 (pluginInterface: { min, max }).
- proposedEdit: "`check-addon` runs the engine's checks for add-ons, called gates, on one add-on package. Run it before you publish an add-on." Change the interface row to "the entry's `pluginInterface` range ([Building an add-on](../guides/add-ons.md))". Drop "a listing", or name the catalog.

Verdict: partly

## Evidence

- "A listing" holds. No page in docs/ says what a listing is. The phrase appears only at cli/null3d.md:412 and guides/add-ons.md:13 ("before a listing publishes it"). Its source is the CLI's own wording: packages/cli/src/cli.js:25 (command summary "as a listing does") and packages/cli/src/check-addon.js:1. A reader cannot tell who or what a listing is. The same fix is needed on guides/add-ons.md:13, so the issue is cross-page.
- "The plugin interface range ... this page does not link it there" is wrong. The same paragraph, cli/null3d.md:412, ends with "[Building an add-on](../guides/add-ons.md) gives the rules that the gates check." That link sits three lines above the table. A second link in the interface row is optional, not a fix for a missing link.
- "The engine's gates comes before the gate table" is weak. The table starts at line 421, with a "Gate | What it checks" header, so the meaning is clear two lines later. A short gloss ("checks, called gates") is cheap and fine, but this part alone is low severity.

## Corrected claim

"A listing" is not defined on any docs page (cli/null3d.md:412 and guides/add-ons.md:13). The word "gate" is used two lines before the table that explains it. The page already links Building an add-on, which explains the plugin interface range, in the same paragraph.

## Corrected edit

cli/null3d.md:412: "`check-addon` runs the engine's checks for add-ons, called gates, on one add-on package. Run it before you release or publish an add-on." Make the same change to guides/add-ons.md:13 ("runs these rules on a folder before you publish it"). Also change the command summary in packages/cli/src/cli.js:25 if the help text should match. Leave the interface row as it is, or change it to "the entry declares its `pluginInterface` range" with no extra link, because line 412 already links the guide.
