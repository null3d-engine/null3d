# Verdict: porting-shaders-substance-29

## Finding as given

```json
{
 "page": "shaders/wgsl-rules",
 "anchor": "## Atomic compare-exchange, line 65 'WebKit has fixed the fault (321006@main), but no Safari release that has the fix is out yet.'",
 "category": "internal-note",
 "severity": "low",
 "claim": "A WebKit commit ID and 'not out yet' are status notes that go wrong at the next Safari release, with no check to catch it.",
 "evidence": "docs/shaders/wgsl-rules.md:65",
 "proposedEdit": "'Safari 27.0 cannot compile such a shader, so it fails to load on Apple devices with that version.' Keep the commit ID in the build warning or a code comment.",
 "generatedSource": "",
 "id": "porting-shaders-substance-29",
 "slice": "porting-shaders",
 "role": "substance"
}
```

Verdict: partly

## Evidence

- docs/shaders/wgsl-rules.md:65 has the sentence as quoted. It is a hand-written page, so there is no generated source.
- The core claim holds. "No Safari release that has the fix is out yet" is a status note that goes stale. The docs style check in AGENTS.md ("Writing docs", line 17 of that section) blocks dates in prose, but nothing blocks "not out yet". The maintainer record .dev/driver-bugs.md:66-68 has the same status ("fixed in WebKit ... not yet in a Safari release"). Nothing ties the page to that record.
- The note may already be stale, or at least it cannot be checked. Safari 27.2 shipped on 26 October 2026 and Safari 27.3 beta came out on 16 November 2026 (Apple release notes). Neither set of notes lists this fix. But release notes do not list every fix, so the page's claim cannot be confirmed or refuted from them.
- The page and the proposed edit both have a scope problem that the finding misses. They name only "Safari 27.0". But the page also says that no release has the fix, which means Safari 27.1 and 27.2 fail too. Safari 27.2 is build 20625.2.8, on the same branch as 27.0. The fix landed on WebKit main after 27.0 shipped (.dev/implementation-notes.md:1143), so 27.2 has it only if Apple carried it over to that branch. The proposed edit, "fails ... on Apple devices with that version", keeps the too-narrow scope and drops the only hint that later 27 releases may fail too.
- Part of the proposed edit is already done. The build warning already includes the WebKit commit ID: packages/vite-plugin/src/wgsl.test.ts:559-575 checks that the warning starts "does not compile on Safari 27.0" and contains '321006@main'. The commit ID is also in .dev/driver-bugs.md:68.
- The category is wrong. A public WebKit commit ID is not an internal process word (milestone, task ID, decision record, plan). The real issue is a time-bound status note. The severity stays low.
- skills/null3d-develop/references/shaders.md:444 names only Safari 27.0 and has no status note. If the page's scope changes, the skill should change the same way, to keep docs and skills in sync.

## Corrected claim

The sentence is a time-bound status note that no check catches, and Safari 27.2 has shipped since it was written, so it may already be wrong. The commit ID is a public WebKit reference, not an internal note, and the build warning already carries it. The page, and the proposed edit, name only Safari 27.0, but the page's own status implies that every Safari 27 release without the fix fails.

## Corrected edit

On docs/shaders/wgsl-rules.md:65, replace "Safari 27.0 cannot compile such a shader, on atomics in any address space, so it fails to load on every Apple device with that version. ... WebKit has fixed the fault (321006@main), but no Safari release that has the fix is out yet." with:

"Safari 27.0 cannot compile such a shader, on atomics in any address space, so it fails to load on every Apple device with that version. Later Safari 27 releases can fail the same way until they include WebKit's fix, so test such a shader on each Safari version you support. The build warning names the WebKit fix."

Keep the rest of the paragraph. The build warning already has the commit ID, so it needs no change. Make the same scope change in skills/null3d-develop/references/shaders.md:444.
