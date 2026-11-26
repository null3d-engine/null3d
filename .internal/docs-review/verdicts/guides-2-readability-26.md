# guides-2-readability-26

## Finding as given

- page: guides/physics
- anchor: lines 21-38 and line 115
- category: scan-order
- severity: low
- claim: Before the reader sees which libraries to use, the page explains the single-threaded build (line 23) and deterministic servers (line 25). Each library's download size, which helps the choice, comes after the first example (line 115).
- evidence: line 23 'In the single-threaded build ...'; line 25 'Physics in the sketch only moves what the player sees.'; line 115 'it adds about 1.2 MB after Brotli compression'.
- proposedEdit: Order: intro (line 21), library table with a 'Download size' column (about 1.2 MB for the Rapier -compat package, about 20 KB for cannon-es), install command, examples. Move lines 23 and 25 to a short '## Notes' list before Related pages, or after 'Step the world at a fixed rate'.
- generatedSource: (none; hand-written page)

Verdict: partly

## Evidence

- The page text matches the quotes. Line 23 (2 sentences) and line 25 (3 sentences) sit between the intro and the library table at line 27. The download sizes appear only at line 115, after the Rapier example.
- The size point holds. Download size is a real factor in the choice. The table (lines 29-32) says only "fast with many bodies" and "small and simple to use". A reader must get past an 80-line example to learn that Rapier's -compat package costs about 1.2 MB and the cannon-es example about 20 KB.
- The move of lines 23 and 25 does not hold:
  - Line 23 qualifies line 21. Line 21 ends "The page's main thread does none of this work." That is false in the single-threaded build, and line 23 says so at once. If line 23 moves to the end of the page, line 21 misleads every reader whose page gets the single-threaded build.
  - Line 25 is a scope signpost. It tells a reader with a server-replayed game that sketch physics does not decide results, and links to the right page. That reader must learn this before installing a library and writing the examples, not after.
  - Both paragraphs are short (2 and 3 sentences). They do not hide the table: it starts six lines after the intro.
- Line 115 also carries a point tied to the package choice: the -compat package needs no extra Vite setup. That half belongs with the install command, not after the example.
- Precision: the "about 20 KB" figure on line 115 is for "the example on this page" with cannon-es, not for the whole library. A table cell must keep that scope.

## Corrected claim

The download sizes, which help a reader choose a library, appear only after the first example (line 115). They belong in or next to the library table. Lines 23 and 25 are in the right place: line 23 corrects the last sentence of line 21 for the single-threaded build, and line 25 sends readers with server-replayed games to the right page before they start.

## Corrected edit

Keep lines 21, 23 and 25 where they are. Add a "Download size" column to the table at lines 29-32:

| Library | Package | What it is | Download size |
| --- | --- | --- | --- |
| Rapier | `@dimforge/rapier3d-compat` | A Rust engine compiled to WebAssembly. It is fast with many bodies. | About 1.2 MB after Brotli compression |
| cannon-es | `cannon-es` | A JavaScript engine. It is small and simple to use. | About 20 KB for the example on this page |

Move the first sentence of line 115 to just after the install command: "The `-compat` package holds Rapier's WebAssembly inside its JavaScript, so it needs no extra Vite setup. That is why it is large." Then delete line 115.
