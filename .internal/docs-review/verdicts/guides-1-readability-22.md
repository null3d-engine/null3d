# guides-1-readability-22

## Finding as given

- page: guides/deterministic-simulation
- anchor: lines 218 and 222
- category: contradiction
- severity: medium
- claim: Two paragraphs report what looks like the same narrowed build with different figures: 300 files, 26 MB and 762 files, 226 MB at line 218; 297 files, 26,057,130 bytes and 759 files, 225,683,678 bytes at line 222. The reader cannot tell whether these are two games.
- evidence: line 218 'A real game recorded this way drew with 5 words, and its folder held 300 files and 26 MB.'; line 222 'A small game scene with three lanes and a ship drew with 5 words. Its folder held 297 files and 26,057,130 bytes'.
- proposedEdit: Keep one report in <details><summary>Technical details: what a narrowed set saves</summary> as a table (words, files, bytes, after Brotli) for the narrowed set, the example list and the full set. Delete the other paragraph.

Verdict: partly

## Evidence

- docs/guides/deterministic-simulation.md:218 ends with "A real game recorded this way drew with 5 words, and its folder held 300 files and 26 MB. The same folder built with the 172-word example list held 762 files and 226 MB."
- docs/guides/deterministic-simulation.md:222 opens with "A small game scene with three lanes and a ship drew with 5 words. Its folder held 297 files and 26,057,130 bytes, 4,737,421 after Brotli. The same folder built with the 172 words of null3D's examples held 759 files and 225,683,678 bytes."
- Both report 5 words and the 172-word list. Both file counts differ by exactly 3. The line 222 figures came in with commit 1be201004 (#557). The line 218 sentence came in two days later with commit bb882f565 (#559), which added the click-to-start recording flow. So the page most likely holds two measurements of the same game, taken before and after that change. The page does not say so.
- The core claim holds: two near-identical size reports sit three lines apart, and a reader cannot tell if they describe one game or two.
- The category "contradiction" is too strong. If these are two games, the figures do not conflict. The real issue is a duplicate report with unexplained small differences.
- The proposed edit has two problems:
  1. "Delete the other paragraph" would cut text that is not a size report. The last two sentences of line 222 are guidance: "Record again after the game gains a feature that turns on a new word. The engine names a word that the set lacks the first time a pipeline needs it." They must stay in the main text. The full-set size (4,117,799,356 bytes) also backs line 220's warning that the full set can exceed the folder's limits.
  2. If every figure moves into a closed block, the main text loses the point that narrowing shrinks the folder about ninefold. The main text must make sense with the block closed, so one plain sentence with the result should stay outside the block.
- The table row for the full set has no file count on the page, and only the narrowed set has an after-Brotli figure. The table must leave those cells empty or drop those columns.

## Corrected claim

Lines 218 and 222 give two size reports for a 5-word game against the 172-word example list. The figures differ by 3 files and a few bytes. The page does not say whether they are one game measured twice or two games, so the second report reads as a confusing duplicate. They do not contradict each other.

## Corrected edit

- At line 218, delete the last two sentences (the 300-file and 762-file figures).
- Rewrite line 222 so that the main text keeps the result and the guidance, and the exact figures go into one block:

  A small game that drew with 5 words built a files folder about a ninth the size of one built with the 172-word example list. Record again after the game gains a feature that turns on a new word. The engine names a word that the set lacks the first time a pipeline needs it.

  <details>
  <summary>Technical details: what a narrowed set saves</summary>

  | Shader set | Words | Files in the folder | Bytes | After Brotli |
  | --- | --- | --- | --- | --- |
  | Recorded from the game | 5 | 297 | 26,057,130 | 4,737,421 |
  | null3D's example list | 172 | 759 | 225,683,678 | |
  | Full set of shader modules | all | | 4,117,799,356 | |

  </details>

- Keep line 220 ("The shader modules in a release asset are the full set ...") in the main text. The full-set row in the block gives the size behind its warning.
