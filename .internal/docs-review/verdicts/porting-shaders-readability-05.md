# porting-shaders-readability-05

## Finding as given

- page: shaders/library
- anchor: Every module section, e.g. ## `null3d::math` with ### `PI`, ### `TAU`, ### `HALF_PI`, ### `INV_PI`, ### `EPSILON` (lines 62-100)
- category: heading-depth
- severity: medium
- claim: The page has 148 H3 headings, one per constant, struct and function, over 1,374 lines. Five math constants each take a heading, and null3d::lighting alone has 32 H3s. No module lists its items, so a reader must scroll the whole module to find a function.
- evidence: stats.json shaders/library headings; items per module: math 17, noise 21, color 23, lighting 32, fog 15, vertex 12, depth 9, sdf 18, reflection 1. tools/lib/shader-library.ts libraryPage writes ### `name` for every item.
- proposedEdit: In libraryPage, write each module as: its summary; a table of constants (name, value, meaning); a table of functions and structs (name linked to its entry, first sentence of its doc); then an H3 entry for each function and struct only. Constants get no H3.
- generatedSource: tools/lib/shader-library.ts

Verdict: partly

## Evidence

- docs/shaders/library.md has 1,374 lines and 148 H3 headings. The H3 counts per module match the finding exactly (math 17, noise 21, color 23, lighting 32, fog 15, vertex 12, depth 9, sdf 18, reflection 1).
- tools/lib/shader-library.ts, libraryPage (line 226 on): each item becomes "### `name`", a wgsl code block and the doc. Each module section has only its summary before the items. The page has a module table (docs/shaders/library.md:44-56) but no per-module item list. That part of the claim holds.
- 23 of the 148 H3s are constants (lines 65-1073 of the page). No page in docs/ or skills/ links to an item anchor on this page; the only inbound anchor is library.md#null3dfog (docs/api/scene.md:488). Dropping the constant headings breaks no link.
- The proposed edit has two faults:
  1. A "value" column does not work for 4 of the 23 constants. ACES_INPUT, ACES_OUTPUT, AGX_INSET and AGX_OUTSET (page lines 433, 445, 497, 509) are multi-line mat3x3f declarations. A Markdown table cell cannot hold a code block, and a one-line matrix of nine numbers is unreadable.
  2. A function table with "the first sentence of its doc" repeats most entries word for word. Many function docs are one sentence (for example `square`: "Returns x times x."; `max_component`, `min_component`). The table plus the H3 entry would print the same sentence twice for most items.
- "A reader must scroll the whole module" is overstated: the function names are headings, so browser search and any heading-based page outline reach them. The cost is real but moderate: a reader who does not know the name has no overview of a 32-item module.

## Corrected claim

The page has 148 H3s, one per item, 23 of them constants. Modules give no overview of their items, so a reader who does not know a function's name must scan the module. The heading count itself is not a defect: each function and struct is a lookup target and its H3 is right.

## Corrected edit

In libraryPage (tools/lib/shader-library.ts), for each module, after the summary:
1. A table of constants with columns name, type and meaning (the doc). Constants get no H3. For a constant whose declaration spans more than one line (the colour matrices), show its type in the table and put its full declarations in one collapsible block after the table:

   <details>
   <summary>Technical details: matrix values</summary>

   ```wgsl
   const ACES_INPUT = mat3x3f(...);
   ```

   </details>

   Single-line constants can show their value in a type column such as `f32 = 1e-6`.
2. A one-line index of the module's functions and structs, each name linked to its H3 entry. Do not repeat the first sentence of each doc, since most entries are one sentence long.
3. The H3 entries for functions and structs, unchanged.
