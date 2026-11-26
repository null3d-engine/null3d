# guides-2-substance-24

## Finding as given

- page: guides/start-time
- anchor: ## What the engine does while the core downloads, lines 162-166
- category: unclear
- severity: low
- claim: Line 166 starts 'The sketch module's top-level code therefore runs before the engine has started'. The cause is in lines 156-160, and lines 162 (the Vite import list) and 164 (load.drawingStart) sit in between.
- evidence: start-time.md:156-166.
- proposedEdit: Move line 166 to follow line 160 and start it with 'So'. Move line 164 to 'Measure a start'.

Verdict: partly

## Evidence

- start-time.md:156 gives the cause: the sketch worker imports the sketch module while the core downloads. start-time.md:166 draws the result with "therefore". Two paragraphs sit between them: line 162 (the plugin writes the import list into the sketch module) and line 164 (`load.drawingStart`). Line 162 at least talks about the sketch module. Line 164 is about the drawing thread and has nothing to do with the sketch module. So "therefore" has no clear cause next to it. The claim holds.
- The edit has two faults.
  1. Line 160 already starts with "So" ("So when the core arrives, the setup starts almost at once."). Starting the moved paragraph with "So" too gives two "So" paragraphs in a row, and the second still points back past the first. Name the cause instead.
  2. "Move line 164 to Measure a start" would add nothing. That section's table already has the same fact, in more detail (start-time.md:304, the `load.drawingStart` row: adapter and device, shader file, core and renderer, in milliseconds from navigation). Delete line 164 instead. A reader who wants the figure finds it in the table.

## Corrected claim

The "therefore" in line 166 is cut off from its cause in line 156 by lines 162 and 164. Line 164 also repeats the `load.drawingStart` row of the Measure a start table.

## Corrected edit

Move line 166 so it follows line 160, before the Vite plugin paragraph. Replace "The sketch module's top-level code therefore runs before the engine has started" with "Because the sketch worker imports the sketch module during the download, the module's top-level code runs before the engine has started". Keep the rest of the paragraph. Delete line 164, because the Measure a start table already covers `load.drawingStart`.
