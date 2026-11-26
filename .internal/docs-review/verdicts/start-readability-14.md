# start-readability-14

## The finding as given

- page: getting-started/cdn
- anchor: ## Production and development entries (lines 45 to 64)
- category: structure
- severity: medium
- claim: Six paragraphs follow a two-row table. The third build for benchmarks (--url-switches) is a row the table lacks, and how to tell entries apart is a debugging detail.
- evidence: cdn.md lines 49 to 52 (table); paragraphs at 54, 56, 58, 60, 62, 64.
- proposedEdit: Add a third table row: Production with switches | lib/index.js from build:cdn --url-switches | Never run | Read | Benchmark pages only, never ship. Keep lines 56 and 60 as the two rules; merge 54 and 58; move 62 into <summary>Technical details: see which entry a page runs</summary>; reduce 64 to its 'never ship it' reason.

Verdict: partly

## Evidence

- cdn.md:47 says "The build holds the engine's entry point twice." The table (49 to 52) lists those two entries. That is accurate: one CDN folder has two entry files.
- tools/build-cdn.ts:5-6, 24-31: `--url-switches` is a flag on the whole CDN build. It does not add a third entry file. The production entry stays `lib/index.js`; that same file then reads the address switches. So "Production with switches" is a different build of the same import path, not a third entry beside the two. A third row with the import `lib/index.js` would sit under a sentence that says "twice", and it would show two rows with the same import. A reader could think the normal folder holds a switch-reading production entry. That misleads more than the current text does.
- stats.json lists no long paragraph in this section. Each paragraph at 54, 56, 58, 60, 62 and 64 has two to four short sentences. The section is not dense; it has some overlap with the table.
- Merge 54 and 58: 54 has four sentences and 58 has three. One merged paragraph of seven sentences goes past the four-sentence limit that the review uses. 58 does repeat the table's "Never run" and "Ignored". Its only new facts are "a link cannot change how it runs" and "its files still hold the checks' code, which a Vite build removes". Trimming 58 to those facts is better than a merge.
- Line 62 (how to tell the entries apart, with `?threads=off` and `engine.mode.build`) is correct and is a debugging aid. The main text reads well without it. A collapsible block fits it.
- Line 64 is the only place that tells a benchmark author how to get switches in a production build. Its command must stay in the main text if the table does not get the row.

## Corrected claim

The section repeats the table in two places (54 and 58 restate the "Development checks" and "Address switches" columns), and line 62 is a debugging detail that can move into a collapsible block. The `--url-switches` build is not a missing table row: it is a variant of the whole build whose production entry is the same `lib/index.js` file, so the two-row table under "holds the engine's entry point twice" is right. Severity: low (polish), not medium.

## Corrected edit

- Keep the two-row table as it is.
- Keep 54 (what the development entry adds) and 56 (time only the production entry).
- Trim 58 to its new facts: "The production entry behaves like a production build from Vite and the plugin, so a link cannot change how it runs. Its files still hold the checks' code, which a Vite build removes from the download."
- Keep 60 (one entry for the whole page).
- Keep 64 in the main text, shortened: "A benchmark page may need the production entry to read switches, such as `?gpu=webgl2`. `bun run build:cdn --url-switches` makes a build whose production entry reads them. Use that build for benchmark pages only, and never ship it, because a link can then change how the page runs."
- Move 62 into a block after 60:

<details>
<summary>Technical details: see which entry a page runs</summary>

Read the address that the page imports. On a page with the [isolation headers](#both-thread-modes), the `?threads=off` switch also tells them apart. With it, `engine.mode.build` is `'single'` from the development entry and `'threaded'` from the production entry.

</details>
