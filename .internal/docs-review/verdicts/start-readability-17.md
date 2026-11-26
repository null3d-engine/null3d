# start-readability-17

## Finding as given

- page: getting-started/install
- anchor: line 59, 'null3D requires Vite with this plugin.'
- category: scan-order
- severity: medium
- claim: Whether the engine works with the reader's bundler is a first question, but the answer sits after the ten-bullet plugin list. Line 13 says no command-line tool is needed, but not that Vite is.
- evidence: install.md line 59; line 13; line 46 implies but does not state it.
- proposedEdit: Move 'null3D requires Vite with the null3D plugin. Other bundlers are not supported or tested.' to the top of ## Add the Vite plugin. Change line 13 to 'null3D installs from npm and builds with Vite.'
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- docs/getting-started/install.md:59 holds the only plain statement that Vite is required and other bundlers are not supported. It comes after the code block (38-44), the sentence at 46 and the ten bullets at 48-57. The claim about scan order holds.
- install.md:13 says "You need no command-line tool to build or run a null3D sketch." It means the optional `null3d` command (95-106), but the page later runs `bunx vite` (86) and `bunx vite build` (89), which are command-line tools. A reader can take line 13 to mean no build tool at all. The claim holds.
- Softening facts: the frontmatter summary (6) names "the Vite plugin, which every Vite build needs", the install command at 21 adds `vite`, and the heading at 36 is "Add the Vite plugin". So Vite is signalled early; only the "other bundlers are not supported" answer is buried. Medium is still fair because line 13 points the wrong way.
- Line 59 has a third sentence: the engine loads its files with `new URL('<file>', import.meta.url)`, "which other bundlers read too". Line 52 also speaks of "another bundler". The proposed edit moves only the first two sentences and leaves this third one stranded after the list, where it reads as an orphan. It must move with them.
- The proposed new line 13 replaces the whole line. That drops the link to [Try null3D from a CDN](cdn.md), the only no-install route for a newcomer, and the "imports like any other library" point. That cut is a loss, not a fix.

## Corrected claim

The plain answer "Vite only, other bundlers unsupported" sits after the plugin's ten-bullet list at line 59, and line 13's "no command-line tool" reads as if no build tool is needed, although the page then runs Vite. The install command and the section heading do signal Vite earlier.

## Corrected edit

1. Line 13: keep the CDN sentence. Change the first two sentences to: "null3D installs from npm and imports like any other library. It builds with Vite and the null3D Vite plugin. You do not need the optional `null3d` command to build or run a sketch."
2. Move all three sentences of line 59 to directly under "## Add the Vite plugin" (before the config block): "null3D requires Vite with this plugin. Other bundlers are not supported or tested. The engine loads its workers, its WebAssembly and its other files in the standard form, `new URL('<file>', import.meta.url)`, which other bundlers read too."
3. Leave line 61 (files on a CDN) after the list.
