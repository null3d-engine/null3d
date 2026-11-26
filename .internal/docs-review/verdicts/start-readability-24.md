# start-readability-24

## Finding as given

- page: getting-started/network-use
- anchor: ## Turn off the build's download (line 65), line 17, line 63
- category: structure
- severity: low
- claim: A two-sentence H2 repeats the list item above it. Line 17's replay sentence breaks the engine-files section. Line 63 on Vite's hot reload connection is a development fact in the build section. The page has no overview of its three actors.
- evidence: network-use.md lines 17, 55, 63, 65 to 67.
- proposedEdit: Merge the H2 into ## The build's one download. Move line 17 to a bullet in ## What your own code downloads, and line 63 to a short development note. Add a three-row table under the intro: Who | What it contacts | How to stop it (page, build, tool).

Verdict: partly

## Evidence

- Lines 65 to 67 (## Turn off the build's download) say again what line 55 (list item 1) and line 59 already say: the setting names a folder, and then the build makes no request. The only new fact is that the folder must hold `shaders.ts`. No page or skill links to this heading's anchor (grep of docs/ and skills/). The page test (tools/lib/network-use.test.ts:228-232) checks only for the strings "sends nothing to any server" and `NULL3D_ENGINE_SHADERS`, so a merge breaks nothing. This part holds.
- Line 17's last sentence is about a recording file that the page names. ## What your own code downloads (line 38) opens with "The engine downloads only the addresses that you give it", and line 43 already speaks of recordings and replays. The sentence fits there as a bullet. This part holds.
- Line 63 (Vite's hot reload connection) sits in the section about the Vite plugin, so a reader who asks "what does the Vite side contact?" finds it there. Moving it to "a short development note" names no place. This part is taste with almost no cost to a reader.
- The table: the page has four actor sections, not three (engine files, your own code, the build, the command-line tool, lines 15, 36, 51, 69). The intro (line 13) and the H2s already give the overview. A "How to stop it" column does not fit the page row: the engine's own files and the files your code names cannot be stopped; they can only be kept on the page's origin (## Check the claim, line 88). On a 1242-word page the table mostly repeats the section heads. This part is taste, and its column framing would mislead.

## Corrected claim

The ## Turn off the build's download section repeats line 55 and line 59. Line 17's replay sentence belongs with the files that your own code names. The line 63 move and the overview table are matters of taste.

## Corrected edit

Fold lines 65 to 67 into ## The build's one download: extend list item 1 to "The folder that the `NULL3D_ENGINE_SHADERS` setting names. It must hold the engine's generated shader modules, including `shaders.ts`. With it set, the build makes no request." Delete the separate H2. Move line 17's last sentence to a bullet in ## What your own code downloads. Leave line 63 where it is, and add no table.
