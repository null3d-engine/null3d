# D-400: Docs structure: areas, groups, stable page IDs and technical details blocks

Status: decided by the owner. Built: the area order, the groups and the inventory of every page in the navigation. Also built: the generated navigation, the moves file, and the rule and check for technical details blocks. Pending: the blocks themselves and the page splits, one area at a time.

Summary: The docs keep every page ID and add a group level to four areas: getting started, concepts, guides and the API. Areas run from learning to reference, and the generator writes the website's navigation from one inventory. Dense detail moves into collapsible technical details blocks before any large page splits.

## Question

How do the docs order their pages, so that a newcomer finds a path and a reader can scan an area? How do they keep implementer detail without walls of text?

## Rule

The owner decides. The website renders the docs from this repository, so the navigation, the moves and the block markup are a fixed contract with it. Pages must stay findable by ID, because coding agents, the skills, engine messages and package READMEs name pages by ID.

## Data

| Measure | Value |
| --- | --- |
| Pages | 227: 103 written, 124 generated |
| Words | about 509,000 |
| Paragraphs over 90 words or 4 sentences | 760, on 129 pages |
| Pages in the four largest areas | concepts 19, guides 25, API 40 written, getting started 7 |
| Links from `skills/` to `api/materials` alone | 73 |
| Review findings that held, of those checked | 677 of 685 |

How the data was produced: a multi-agent review of the docs on the `generated` branch. Two reviewers read each slice of about 50,000 words, one tree-wide reviewer read every outline, and a separate agent tried to disprove each finding.

## Look

The options look the same. The change is text and navigation only.

## Decision

- **Page IDs stay.** No page changes its ID. A group heading gives a reader the same help as a move, at no cost to links. The website's redirects come from `docs/moves.json`, which maps each old ID to its new one. It starts empty. No entry ever leaves it, because old engine builds and package READMEs link to old IDs for good.
- **Area order:** getting started, concepts, guides, cookbook, shaders, porting, the API, the command-line tool, errors. Learning and doing come first, and reference last.
- **Groups.** Getting started has first steps, and hosting and licenses. Concepts follows the frame: how the engine runs, drawing a frame, large scenes, and effects after the scene. Guides has eight groups and the API has eight, with the add-on author pages last. The other areas have nine pages or fewer and no groups.
- **One inventory.** `PAGES` in `tools/lib/docs.ts` lists every page that the navigation shows, in order, with its group. It includes the generated pages that sit among the written ones, marked `generated: true`. So the error index and the preset tables sit beside the pages they serve. A written page's title and summary come from its own front matter alone. A generated page's come from its inventory entry.
- **Navigation.** The generator writes `docs/nav.json` from the inventory, and the page list prints the same areas and groups. The API reference pages and the error code pages stay out of both.
- **Technical details blocks.** A paragraph keeps to about 4 sentences or 90 words. Dense detail for implementers goes into a `<details>` block whose summary starts "Technical details:". The website shows it collapsed. The main text must stay correct with every block closed, so instructions, defaults, limits and errors stay outside. The docs style check refuses a block that breaks its form.
- **Blocks before splits.** The blocks land first, area by area. The splits of the largest pages follow, after a second look at their length. Where `api/materials` splits, the material layers leave it, as the larger topic.

Options rejected:

- **Move pages to new `deploy` and `extend` areas.** Each move costs links, skill edits and engine messages, and a group fixes the same scattering.
- **Read the groups from the page list's headings.** The website would parse prose. A JSON file from the inventory is one source for both.
- **Keep the inventory to written pages.** Generated pages would sort last in their area, after the 80 error pages in the errors area.

## Consequences

- AGENTS.md rule 3 of "Docs and skills stay in sync" and "Writing docs" state the inventory and the block rules.
- `docs:check` refuses a page outside every area or group, and a generated page that the inventory does not place. It also refuses a moves file that loses an entry or leads nowhere. `docs:style` refuses a broken block.
- Two pages take clearer titles: `api/ui` is "Labels that follow objects", and `guides/ui-overlays` is "HTML UI around the scene". The three example add-on guides open their summary with "An example add-on you copy".
