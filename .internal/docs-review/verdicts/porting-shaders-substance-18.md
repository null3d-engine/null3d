# porting-shaders-substance-18

## Finding as given

- page: shaders/surface-functions
- anchor: stats lines 6, 31, 93, 143, 161, 583; file line 611 (first Rules bullet)
- category: long-paragraph
- severity: medium
- claim: Six paragraphs run 49 to 97 words. The first Rules bullet lists about 90 reserved names in one chain, so the rule itself is lost.
- evidence: stats.json longParagraphs for shaders/surface-functions; docs/shaders/surface-functions.md:611
- proposedEdit: Rules: keep 'Do not declare a name that the engine declares. The build stops at your line when a name clashes.' Move the list to <details><summary>Technical details: every name the engine declares</summary>, grouped by when it applies (always, with instance or object.id, with a lobe). Split the other paragraphs after their second sentence, and move the cost notes of the second and third normal into one 'Technical details: what each optional field costs' block.

Verdict: partly

## Evidence

Stats line numbers are 7 lower than file lines (the front matter is skipped). Stats 6/31/93/143/161/583 are file lines 13/38/100/150/168/590.

- The Rules bullet (file line 611) holds 73 backticked names. Five of them (`surface`, `vertexOffset`, `lobe`, `unlit`, `coverage`) are the names the reader MAY declare. So the reserved list is about 66 names, not about 90.
- The rule is not lost. It is the first sentence of the bullet. What gets lost is the last sentence, "The names ... are yours to declare", which comes after the whole list. A reader needs that sentence more than the list.
- The list is still good material for a block. The build error names the clash for the reader: packages/vite-plugin/src/wgsl.test.ts:538-541 shows a clash with `shade` reported at the user's line with "redefinition of `shade`". So the list is reference detail, not something a reader must scan before writing code. No other docs page repeats the list.
- File line 38 (49 words, 5 short sentences) is flagged only for its sentence count. It reads well. Splitting it is a matter of taste.
- "Split after the second sentence" is wrong for some paragraphs:
  - File line 150: sentences 1 to 3 define the sky's light together ("It also takes in..."). The natural break is after sentence 3, before "A crown of leaves uses this...".
  - File line 168: a break after sentence 2 leaves a paragraph that starts "That suits an occlusion map", with "That" pointing back across the break. Break after sentence 3 instead: the default first, then the double-darkening problem and its fix.
  - File line 100: this paragraph lists the defaults of `defaultSurface`, field by field. A bullet list of the defaults reads better than a split.
  - File line 590: the middle sentences are examples (`frame.time`, `object.position`, `object.values`). A short list or a break after sentence 1 works.
- The cost notes are each one bullet of one sentence: file line 146 (second normal) and file line 164 (third normal), with a matching third note at file line 181 (occlusion choice). They sit in three different sections. If you put two of them into one block, the block would span two sections and break the page layout. Each sentence also tells the reader something they need ("a material that does not name it pays nothing"). Leave them in place.

## Corrected claim

Five paragraphs run 85 to 97 words. A sixth paragraph, at 49 words, is flagged only for its five short sentences. The first Rules bullet lists about 66 engine names in one chain. The rule comes first in the bullet, but the list buries the closing sentence that tells the reader which names they may declare.

## Corrected edit

- Rules, first bullet: keep "Do not declare a name that the engine declares. The build stops at your line when a name clashes." and "The names `surface`, `vertexOffset`, `lobe`, `unlit` and `coverage` are yours to declare." in the main text. Put the names in a block after the list of rules (not nested in the bullet):
  <details>
  <summary>Technical details: every name the engine declares</summary>
  grouped as: always declared; library items that the standard material imports; added when the WGSL reads `instance`, `object.id` or the object's matrices; added when the material declares a lobe.
  </details>
- File line 100: turn the defaults of `defaultSurface` into a bullet list, and keep the lead-in sentence to the code.
- File line 150: break after the third sentence. File line 168: break after the third sentence. File line 590: break after the first sentence, or list the examples.
- File line 13: an optional break after the second sentence. File line 38: no change.
- Do not move the cost notes at file lines 146, 164 and 181.
