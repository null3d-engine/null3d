# errors-substance-15

## Finding as given

- page: errors/E1203
- anchor: ## What happened
- category: missing-content
- severity: medium
- claim: Transform setters check for NaN only in development builds. In a release build, NaN reaches the transform with no error. The page does not say so, so a reader who sees an object vanish in production cannot link it to this code.
- evidence: scene/scene.ts:1146-1149 (if (DEV) checkVector). errors/checks.ts:63-66 ('Call it inside `if (DEV)`'). scene/probes.ts:244-245 shows a check that runs in every build.
- proposedEdit: Add: 'Development builds check the transform setters. Release builds leave that check out, so a NaN position reaches the scene, and the object can vanish. Test in a development build to find the call.'
- generatedSource: packages/engine/src/errors/codes.ts

Verdict: partly

## Evidence

- The page (docs/errors/E1203.md) has three short sections: the cause, the fix, an example. It says nothing about development or release builds. That part of the finding holds.
- The code claim holds. scene/scene.ts:1146-1150: setPosition runs checkLive and checkVector only inside `if (DEV)`, then writes the values. errors/checks.ts:17 and :62 tell callers to run checkVector and checkNumber "inside `if (DEV)`".
- The scope is too narrow. Most E1203 checks are development-only, not only the transform setters: animation.ts (setBlend, setWeight, setTimeScale and more), environment.ts:120, background.ts:425/590, resources.ts:1688, and the cameras reference (setRect, screenToRay, worldToScreen all say "Development builds throw E1203"). Some checks run in every build: scene/queries.ts:167-174 says "Every query checks its input in every build". So a note limited to transform setters under-states the rule, and a blanket "release builds never throw E1203" would be wrong.
- The evidence item about probes.ts:244-245 is weak. That check sits in a function that probes.ts:173-175 calls inside `if (DEV)`, so it does not show a check that runs in every build. The queries check does.
- The rule is already in the docs elsewhere. docs/guides/debugging.md:71-77 ("Development checks") says the dev server checks each call, names E1203 with a link, and says a production build "leaves the checks out ... draws a wrong frame, or no frame, and throws nothing". But the E1203 page does not link back to it, so a reader of the error page does not find it.
- The reader story is weak. A release build throws nothing, so a reader who sees an object vanish in production never sees E1203 and never lands on this page. The real value is for the reader who got E1203 in development: the note tells them that a release build will not catch the same bad value, so they must fix it at the source.
- There is a precedent. The E1110 cause in codes.ts:91 ends with "Release builds leave the check out." So a one-line build note fits the style of these pages.
- Error sources hold no Markdown links (codes.ts and fixes.ts have none), and the cause also goes into the front-matter summary and the index table row (tools/lib/docs.ts:436-470). A link to the debugging guide would need a renderer change. A short plain sentence in fixes.ts keeps the summary and the index row short.
- Severity: low to medium. The page is not wrong, and the debugging guide covers the rule.

## Corrected claim

Most calls check for a number that is not finite only in development builds. Scene queries check in every build. A release build that gets NaN through a checked call throws nothing, and the frame draws wrong or not at all. The E1203 page does not say this, and it does not point to the "Development checks" section of the debugging guide, which does.

## Corrected edit

Source: packages/engine/src/errors/fixes.ts, the E1203 entry. Add after the current text:

"Most calls check their numbers only in development builds. A release build leaves the check out, so the bad value reaches the scene, and the frame draws wrong, or not at all, with no error. Scene queries such as raycasts check in every build."
