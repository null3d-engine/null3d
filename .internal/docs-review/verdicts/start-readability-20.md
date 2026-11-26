# start-readability-20

## The finding as given

- Page: getting-started/cdn, getting-started/hosting
- Anchor: cdn.md lines 37 to 43 and 163 to 176; hosting.md "The engine's files on a CDN", lines 73 to 102
- Category: duplication. Severity: medium.
- Claim: Both pages give the CORS header, the application/wasm rule, a CSP with blob: and the CDN in worker-src, the same four item reasons and the same three errors. Readers read it twice and a change must reach both.
- Evidence: cdn.md lines 171 to 176 vs hosting.md lines 89 to 100; cdn.md line 43 vs hosting.md line 81.
- Proposed edit: Keep the full list and error table in hosting.md. In cdn.md keep its CSP line and only the items that differ (blob: in script-src, 'unsafe-inline' for the inline script), and link to the hosting section for the rest.

Verdict: partly

## Evidence

- Errors are not repeated. cdn.md line 176 has no table. It names the three codes in one sentence and links to the hosting section "as Hosting lists them". The hosting table (lines 96 to 100) is the only full list. That part of the claim does not hold.
- The four reasons are not the same four. cdn.md lines 171 to 174: blob: in script-src (only on cdn.md, because the no-build page makes its sketch at a blob: address), blob: in worker-src, the CDN in worker-src, and the CDN in script-src and connect-src as one item. hosting.md lines 89 to 92: blob: in worker-src, the CDN in worker-src, the CDN in script-src, the CDN in connect-src. Three cdn.md items repeat hosting.md items. One is unique.
- The two policies differ. cdn.md line 168 adds 'unsafe-inline' and blob: in script-src, and a style-src. hosting.md line 86 has none of these. The two sections cover different setups: a no-build page that imports the CDN build (cdn.md), and a Vite build whose base points at a CDN (hosting.md). So each page needs its own policy line.
- CORS and application/wasm (cdn.md lines 37 to 43 vs hosting.md lines 73 to 81) are one short header block and one sentence each. On cdn.md they are setup steps for the folder that the reader just built, and line 43 adds advice that hosting.md line 81 does not give: a versioned prefix per engine version and the immutable Cache-Control header. Cutting them from cdn.md would make a newcomer jump pages to finish setup. The proposed edit does not cut them either, so this part of the claim adds no action.
- Real cost: three bullet lines (cdn.md 172 to 174) restate hosting.md 89 to 91 in near-identical words. If a reason changes, both pages need the change. That is a small upkeep cost, not a reader block.

## Corrected claim

Only three CSP reason bullets repeat between the pages (cdn.md lines 172 to 174 against hosting.md lines 89 to 91). cdn.md already defers the error list to hosting.md. The CORS and application/wasm lines on cdn.md are needed setup steps, and cdn.md adds caching advice of its own. Severity is low, not medium.

## Corrected edit

The proposed CSP edit is sound; keep the rest of cdn.md as it is. In cdn.md "The Content-Security-Policy", keep the policy line. Keep the bullets that are only true for a no-build page: blob: in script-src for the sketch module, and 'unsafe-inline' in script-src and style-src for the inline script and style. Replace the other bullets with one sentence: "The blob: and CDN items in worker-src, and the CDN in script-src and connect-src, are there for the reasons that [Hosting](hosting.md#the-engines-files-on-a-cdn) gives, with the errors each missing item causes." Leave lines 37 to 43 unchanged.
