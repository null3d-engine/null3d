# errors-substance-24

Finding as given:

- page: errors/E1208 (data)
- anchor: "Give fromDatafour numbers per texel"
- category: wrong-claim
- severity: low
- claim: 'fromDatafour' is a typo. The fix text is also the runtime message, so users see the typo in the console too.
- evidence: packages/engine/src/errors/fixes.ts:42
- proposedEdit: Write: 'Give textures.fromData() four numbers per texel'.
- generatedSource: packages/engine/src/errors/fixes.ts

Verdict: survives

Evidence:

- packages/engine/src/errors/fixes.ts:42 (E1208) reads "Give fromDatafour numbers per texel". A space is missing, and the call has no namespace.
- docs/errors/E1208.md, "How to fix it" section, shows the same text, so the published page carries the typo.
- fixes.ts:1-2 says this text "ends every EngineError message". engine-error.ts:64-65 loads the table at runtime, and codes.ts:624 feeds it to the docs. So the typo shows in the console message and on the page.
- The page's own example (codes.ts:151) names the call as "textures.fromData()", and fixes.ts:30 and :46 name it "textures.fromData". The proposed edit matches that usage.

Corrected edit: none needed. "Give textures.fromData() four numbers per texel" is right. Edit fixes.ts, not the generated page.
