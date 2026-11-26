# Verdict: concepts-2-readability-29

## Finding as given

- page: concepts/render-graph
- anchor: ## Scene inputs, lines 86-93
- category: unclear
- severity: medium
- claim: The table offers four inputs, but two cannot be used: 'normals' (no pass makes them) and 'motionVectors' (the adapters refuse them). The paragraph after the table says in negations who may read what. The reader must cross-read the two to learn what is usable.
- evidence: Line 90 'No pass makes them'. Line 93 'A full-screen effect reads only 'sceneColor' and 'sceneDepth', and a custom material reads only 'sceneDepth'. No pass makes 'normals', and the adapters refuse 'motionVectors'.'
- proposedEdit: Add a 'Who can read it' column: sceneColor, full-screen effects; sceneDepth, full-screen effects and custom materials; normals, nothing (no pass makes them); motionVectors, the motion debug view only. Cut sentences 2-4 of line 93.

Verdict: partly

## Evidence

- The page says what the finding quotes. The table (lines 86-91) lists four inputs. The paragraph at line 93 gives the usable subset only as limits and negations.
- The code agrees with the per-reader limits:
  - Custom materials take only 'sceneDepth'. Every other input throws E1217 ("which custom materials do not read yet") in checkSceneInputs, packages/engine/src/scene/resources.ts:3816-3856.
  - Full-screen effects take only 'sceneColor' and 'sceneDepth', and must read 'sceneColor'. The list is READS at packages/engine/src/scene/feature-effects.ts:82 and the check is at :112-120 (E1223).
  - The compute-pass adapters refuse every scene read: packages/engine/src/scene/render.ts:1300-1303 and :1347-1350.
  - The draw adapter's checkDraw (packages/engine/src/scene/feature-draws.ts:296-328) does not check reads at all. So "the adapters refuse 'motionVectors'" at line 93 is only true of the effect and compute adapters. A draw feature may still declare it, but that only sets the order and binds nothing.
- The column idea holds. It puts who can read each input next to the input, so the reader does not have to merge the table with a paragraph of negations. The proposed column values match the code.
- The cut is wrong. Sentence 2 of line 93, "The render graph then runs it after the passes that write them.", is the ordering rule. That rule is the reason this section is on the render-graph page, and no table cell says it. Only sentences 3 and 4, the who-reads and the normals/motionVectors negations, repeat what the new column would say.
- Severity: medium is generous. The "Made where" column already says "No pass makes them" and that the motion pass runs only for the debug view, so a reader does not get stuck. Low to medium.

## Corrected claim

The table and the paragraph after it split one fact, which inputs each reader may use. A reader must put the two together. A "Who can read it" column fixes this. Only sentences 3 and 4 of line 93 repeat that column. Sentence 2 holds the ordering rule and must stay.

## Corrected edit

Add the column: 'sceneColor', full-screen effects; 'sceneDepth', full-screen effects and custom materials; 'normals', nothing yet (no pass makes them); 'motionVectors', only the motion debug view. Keep sentences 1, 2 and 5 of line 93 ("A feature declares the inputs in its `reads` (...). The render graph then runs it after the passes that write them. A custom material declares `sceneInputs: ['sceneDepth']` ..."). Cut only sentences 3 and 4.
