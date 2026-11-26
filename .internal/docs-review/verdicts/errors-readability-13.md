# errors-readability-13

## Finding as given

- Page: errors/E1206
- Anchor: page lines 13 and 17
- Category: wall-of-text, severity medium
- Claim: The cause (129 words, 7 sentences) and the fix (95 words, 7 sentences) cover four calls together, and the counts per attribute are in prose.
- Evidence: stats.json E1206: line 6 (129, 7), line 10 (95, 7). codes.ts line 135; fixes.ts line 38.
- Proposed edit: Use one cause sentence, then a table Call | Refuses | Fix with rows for geometry.fromArrays(), scene.createLines(), scene.createPoints() and mesh.updateVertices(). Then a small table "Numbers per vertex": positions 3, normals 3, uvs and uvs1 2, colors 3 or 4, tangents 4, and indices 3 per triangle.
- Generated source: packages/engine/src/errors/codes.ts (E1206); packages/engine/src/errors/fixes.ts (E1206)

Verdict: partly

## Evidence

- The problem is real. Page lines 13 and 17 are single paragraphs that mix four calls (geometry.fromArrays, scene.createLines, scene.createPoints, mesh.updateVertices). Some sentences apply to one call only. For example, "Normals can also be missing, or both given and computed" applies to fromArrays only. The stats.json counts (129 words and 7 sentences; 95 words and 7 sentences) are facts.
- The cause also breaks the source's own rule. The `cause` field in packages/engine/src/errors/codes.ts:13-14 says "What went wrong, in one or two sentences." E1206 has seven.
- The fix text does not cover lines or points at all (fixes.ts:38). It names no fix for "at least 2 points", "an even number for pairs", or "at least 1 point". A Call | Fix table would show that gap, which is a plus.
- The proposed edit puts the tables in the wrong place. The two strings have other readers besides the page:
  - `fix` in fixes.ts is "the text that ends every EngineError message" (fixes.ts:1-2). engine-error.ts builds the runtime message from it (messageFor, engine-error.ts:53). A Markdown table there would print raw pipes and dashes in the console error of every E1206.
  - `cause` is also the page's front-matter `summary` (tools/lib/docs.ts:442, a YAML string) and a cell in the error index table (docs.ts:466, through tableCell). A multi-line table there breaks or garbles both.
- So tables cannot go into the existing strings. They need a new place that only the page renders.

## Corrected claim

The cause and the fix of E1206 are long walls of prose that mix four calls. The cause breaks the one-or-two-sentence rule for causes. The fix says nothing about lines or points. But the table layout cannot live in the cause or fix strings: the fix is the tail of every runtime E1206 message, and the cause is also the page summary and an index table cell.

## Corrected edit

1. Cut `cause` in codes.ts to one or two plain sentences, for example: "A call that builds or updates a mesh, a line or a set of points received arrays that do not fit: a wrong length, an index past the last vertex, or a NaN or Infinity value."
2. Keep `fix` in fixes.ts short plain prose that still reads well at the end of a console message. Add the missing fixes for lines and points (at least 2 points, an even count for pairs, at least 1 point).
3. Add an optional page-only field to ErrorEntry in codes.ts (for example a Markdown `details` string). Render it in errorPage() in tools/lib/docs.ts after "How to fix it", wrapped in a collapsible block:

   <details>
   <summary>Technical details: what each call checks</summary>

   | Call | Refuses |
   | --- | --- |
   | geometry.fromArrays() | wrong array lengths, indices past the last vertex, NaN or Infinity, missing normals, normals both given and computed, both `targets` and `morphTargets` |
   | scene.createLines() | fewer than 2 points, an odd count for pairs |
   | scene.createPoints() | no points, colors that are not 3 or 4 numbers per point |
   | mesh.updateVertices() | an attribute the mesh lacks or that takes no updates, another array type than the mesh keeps, vertices past the last one, a mesh with joints or morph targets |

   | Array | Numbers per vertex |
   | --- | --- |
   | positions, normals | 3 |
   | uvs, uvs1 | 2 |
   | colors | 3 or 4 |
   | tangents | 4 |
   | indices | 3 per triangle, each below the vertex count |

   </details>

   The main text must still make sense with the block closed. Neither the runtime message nor the index sees the block.
